import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { IDBFactory } from 'fake-indexeddb';
import { LocalTaskService } from '../src/data/service';
import { CloudController } from '../src/cloud/controller';
import { parsePull, type CloudTransport, type CloudUser } from '../src/cloud/transport';
import type { ApplyResult, CloudOperation, PullResult } from '../src/data/sync-types';

const person: CloudUser = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.invalid' };
const day = '2026-10-15';
const bootstrap = `
  create role anon; create role authenticated; create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

// Only the network/auth boundary is simulated. Every merge, receipt, domain
// invariant and cursor is produced by the actual migrated PostgreSQL functions.
class PostgresTransport implements CloudTransport {
  offline = false;
  dropResponseOnce = false;
  appliedIds: string[] = [];
  private user: CloudUser | null = person;
  private listeners = new Set<(user: CloudUser | null) => void>();
  constructor(private readonly db: PGlite) {}
  private connected() { if (this.offline) throw new Error('device is offline'); }
  async getUser() { this.connected(); return this.user; }
  async signIn(_email: string, _password: string) { this.connected(); this.user = person; return person; }
  async signOut() { this.user = null; for (const listener of this.listeners) listener(null); }
  onUserChange(listener: (user: CloudUser | null) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async pull(cursor: number, owner?: string): Promise<PullResult> {
    this.connected();
    const { rows } = await this.db.query<{ result: unknown }>('select public.pull_changes(after_cursor => $1::bigint, expected_owner => $2::uuid) as result', [cursor, owner ?? null]);
    return parsePull(rows[0].result);
  }
  async apply(operation: CloudOperation): Promise<ApplyResult> {
    this.connected();
    this.appliedIds.push(operation.id);
    const { rows } = await this.db.query<{ result: ApplyResult }>('select public.apply_operation(operation => $1::jsonb) as result', [JSON.stringify(operation)]);
    const response = rows[0].result;
    const parsed = parsePull(response);
    assert.ok(response.status === 'applied' || response.status === 'conflict');
    if (this.dropResponseOnce) { this.dropResponseOnce = false; throw new Error('response lost after PostgreSQL commit'); }
    return { ...parsed, status: response.status, message: response.message };
  }
}

async function setup(context: TestContext) {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  const db = new PGlite();
  const controllers: CloudController[] = [];
  const services: LocalTaskService[] = [];
  context.after(async () => {
    for (const controller of controllers) controller.close();
    for (const service of services) service.close();
    await db.close();
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
  });
  await db.exec(bootstrap);
  await db.exec(await readFile(resolve('supabase/migrations/20261015_private_sync.sql'), 'utf8'));
  await db.exec(`
    insert into auth.users(id,email) values ('${person.id}','${person.email}');
    insert into public.app_owners(user_id) values ('${person.id}');
    set role authenticated;
    select set_config('request.jwt.claim.sub','${person.id}',false);
  `);
  function device(name: string) {
    const service = new LocalTaskService({ name, factory: new IDBFactory(), storage: new MemoryStorage(), scope: name, broadcast: false });
    const transport = new PostgresTransport(db);
    const controller = new CloudController(service, transport);
    services.push(service); controllers.push(controller);
    return { service, transport, controller };
  }
  const a = device('device-a');
  const b = device('device-b');
  await a.controller.start(); await b.controller.start();
  assert.equal(a.controller.getSnapshot().status, 'idle');
  assert.equal(b.controller.getSnapshot().status, 'idle');
  return { a, b, db };
}

test('real PostgreSQL RPC synchronizes notes and tasks between two isolated local databases', async (context) => {
  const { a, b } = await setup(context);
  const note = await a.service.createNote('来自电脑的一段想法');
  const task = await a.service.createTask({ title: '手机上接着处理', date: day, time: '16:30', details: '保留完整详情' });
  await a.controller.sync(); await b.controller.sync();
  assert.equal(b.service.getSnapshot().notes.find((item) => item.id === note.id)?.text, note.text);
  assert.equal(b.service.getSnapshot().tasks.find((item) => item.id === task.id)?.details, '保留完整详情');
  assert.equal((await a.service.getSyncState()).pending, 0);
  assert.equal((await b.service.getSyncState()).owner, person.id);
  assert.deepEqual((await a.service.getSyncState()).conflicts, []);
  assert.deepEqual((await b.service.getSyncState()).conflicts, []);
});

test('offline same-field conflict preserves both versions and uploads the local copy through real SQL', async (context) => {
  const { a, b } = await setup(context);
  const note = await a.service.createNote('最初的一段');
  await a.controller.sync(); await b.controller.sync();
  a.transport.offline = b.transport.offline = true;
  await a.service.updateNote(note.id, '电脑上的新版本', a.service.getSnapshot().notes[0].revision);
  await b.service.updateNote(note.id, '手机离线写下的版本', b.service.getSnapshot().notes[0].revision);
  a.transport.offline = false; await a.controller.sync();
  b.transport.offline = false; await b.controller.sync();
  const state = await b.service.getSyncState();
  assert.equal(state.conflicts.length, 1);
  assert.equal(b.service.getSnapshot().notes.find((item) => item.id === note.id)?.text, '手机离线写下的版本');
  await b.controller.resolve(state.conflicts[0].id, 'copy');
  await a.controller.sync();
  assert.equal((await b.service.getSyncState()).conflicts.length, 0);
  assert.equal((await b.service.getSyncState()).pending, 0);
  assert.deepEqual(a.service.getSnapshot().notes.filter((item) => !item.deletedAt).map((item) => item.text).sort(), ['手机离线写下的版本', '电脑上的新版本'].sort());
  assert.equal(a.service.getSnapshot().notes.find((item) => item.id === note.id)?.text, '电脑上的新版本');
});

test('PostgreSQL field merge combines offline task title and completion changes', async (context) => {
  const { a, b } = await setup(context);
  const task = await a.service.createTask({ title: '原来的标题', date: day });
  await a.controller.sync(); await b.controller.sync();
  a.transport.offline = b.transport.offline = true;
  await a.service.updateTask(task.id, { title: '修改后的标题' }, a.service.getSnapshot().tasks[0].revision);
  await b.service.toggleTask(task.id, true);
  a.transport.offline = false; await a.controller.sync();
  b.transport.offline = false; await b.controller.sync();
  await a.controller.sync();
  for (const device of [a, b]) {
    assert.equal((await device.service.getSyncState()).conflicts.length, 0);
    const merged = device.service.getSnapshot().tasks.find((item) => item.id === task.id)!;
    assert.equal(merged.title, '修改后的标题'); assert.equal(merged.completed, true);
    assert.equal((await device.service.getSyncState()).pending, 0);
  }
});

test('competing third priorities keep the rejected task as a calendar candidate after conflict resolution', async (context) => {
  const { a, b } = await setup(context);
  await a.service.createTask({ title: '第一件', date: day }, { focusDay: day });
  await a.service.createTask({ title: '第二件', date: day }, { focusDay: day });
  await a.controller.sync(); await b.controller.sync();
  a.transport.offline = b.transport.offline = true;
  const candidateA = await a.service.createTask({ title: '电脑选择的第三件', date: day }, { focusDay: day });
  const candidateB = await b.service.createTask({ title: '手机选择的第三件', date: day }, { focusDay: day });
  a.transport.offline = b.transport.offline = false;
  await Promise.all([a.controller.sync(), b.controller.sync()]);
  const stateA = await a.service.getSyncState(), stateB = await b.service.getSyncState();
  assert.equal(stateA.conflicts.length + stateB.conflicts.length, 1);
  const loser = stateA.conflicts.length ? a : b;
  const winner = loser === a ? b : a;
  const accepted = winner === a ? candidateA : candidateB;
  const candidate = loser === a ? candidateA : candidateB;
  const local = await loser.service.getSyncState();
  assert.equal(local.conflicts.length, 1);
  assert.ok(loser.service.getSnapshot().tasks.some((item) => item.id === candidate.id && !item.deletedAt));
  const beforeResolution = await loser.transport.pull(0);
  assert.equal(beforeResolution.entities.find((entity) => entity.kind === 'focus' && entity.id === day)?.data?.ids instanceof Array, true);
  assert.ok(!beforeResolution.entities.some((entity) => entity.kind === 'tasks' && entity.id === candidate.id));
  await loser.controller.resolve(local.conflicts[0].id, 'remote');
  await winner.controller.sync();
  assert.equal((await loser.service.getSyncState()).conflicts.length, 0);
  for (const device of [a, b]) {
    const focus = device.service.getSnapshot().focus[day];
    assert.equal(focus.length, 3); assert.ok(focus.includes(accepted.id)); assert.ok(!focus.includes(candidate.id));
    assert.ok(device.service.getSnapshot().tasks.some((item) => item.id === candidate.id && !item.deletedAt));
    assert.equal((await device.service.getSyncState()).pending, 0);
  }
});

test('a stale offline edit cannot resurrect a remotely soft-deleted note', async (context) => {
  const { a, b } = await setup(context);
  const note = await a.service.createNote('将被移到回收站的片段');
  await a.controller.sync(); await b.controller.sync();
  b.transport.offline = true;
  await b.service.updateNote(note.id, '离线设备仍在编辑的内容', b.service.getSnapshot().notes[0].revision);
  await a.service.deleteNote(note.id); await a.controller.sync();
  b.transport.offline = false; await b.controller.sync();
  const state = await b.service.getSyncState();
  assert.equal(state.conflicts.length, 1);
  const remote = (await b.transport.pull(0)).entities.find((entity) => entity.kind === 'notes' && entity.id === note.id)!;
  assert.ok(remote.data?.deletedAt);
  assert.equal(remote.data?.text, '将被移到回收站的片段');
  assert.equal(b.service.getSnapshot().notes.find((item) => item.id === note.id)?.text, '离线设备仍在编辑的内容');
  await b.controller.resolve(state.conflicts[0].id, 'copy'); await a.controller.sync();
  assert.ok(a.service.getSnapshot().notes.find((item) => item.id === note.id)?.deletedAt);
  assert.ok(a.service.getSnapshot().notes.some((item) => item.id !== note.id && !item.deletedAt && item.text === '离线设备仍在编辑的内容'));
});

test('lost response after a PostgreSQL commit retries the same receipt without a second version', async (context) => {
  const { a, b } = await setup(context);
  const note = await a.service.createNote('网络丢响应也只保存一次');
  const pending = (await a.service.getPendingOperations())[0];
  a.transport.dropResponseOnce = true;
  await a.controller.sync();
  assert.equal(a.controller.getSnapshot().status, 'offline');
  assert.equal((await a.service.getPendingOperations())[0].id, pending.id);
  const committed = await b.transport.pull(0);
  assert.equal(committed.cursor, 1);
  assert.equal(committed.entities.length, 1); assert.equal(committed.entities[0].version, 1);
  await a.controller.retry(); await b.controller.sync();
  assert.deepEqual(a.transport.appliedIds, [pending.id, pending.id]);
  assert.equal((await a.service.getSyncState()).pending, 0);
  assert.equal((await a.service.getSyncState()).conflicts.length, 0);
  const retried = await b.transport.pull(0);
  assert.equal(retried.cursor, 1); assert.equal(retried.entities[0].version, 1);
  assert.equal(b.service.getSnapshot().notes.filter((item) => item.id === note.id).length, 1);
});

test('RPC owner binding rejects a session switched after the controller captured its account', async (context) => {
  const { a, db } = await setup(context);
  a.transport.offline = true;
  const note = await a.service.createNote('只能属于原账号的私密片段');
  const pending = (await a.service.getPendingOperations())[0];
  const other = '22222222-2222-4222-8222-222222222222';
  await db.exec(`
    reset role;
    insert into auth.users(id,email) values ('${other}','other@example.invalid');
    delete from public.app_owners;
    insert into public.app_owners(user_id) values ('${other}');
    set role authenticated;
    select set_config('request.jwt.claim.sub','${other}',false);
  `);
  a.transport.offline = false;
  await a.controller.sync();
  assert.equal(a.controller.getSnapshot().status, 'offline');
  assert.match(a.controller.getSnapshot().error, /账号已经变化/);
  assert.equal((await a.service.getPendingOperations())[0].id, pending.id);
  assert.equal(a.service.getSnapshot().notes.find((item) => item.id === note.id)?.text, '只能属于原账号的私密片段');
  const leaked = await db.query<{ count: number }>("select count(*)::int as count from public.sync_entities where id = $1", [note.id]);
  assert.equal(leaked.rows[0].count, 0);
  // Test the apply guard independently of the controller's initial guarded pull.
  await assert.rejects(a.transport.apply({ id: pending.id, owner: person.id, changes: pending.changes }), /账号已经变化/);
  await db.exec(`
    reset role;
    delete from public.app_owners;
    insert into public.app_owners(user_id) values ('${person.id}');
    set role authenticated;
    select set_config('request.jwt.claim.sub','${person.id}',false);
  `);
  await a.controller.retry();
  assert.equal(a.controller.getSnapshot().status, 'idle');
  assert.equal((await a.service.getSyncState()).pending, 0);
  assert.ok((await a.transport.pull(0, person.id)).entities.some((entity) => entity.id === note.id));
});
