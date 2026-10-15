import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { IDBFactory } from 'fake-indexeddb';
import { LocalTaskService } from '../src/data/service';
import { sameEntityData } from '../src/data/sync-local';
import { CloudController } from '../src/cloud/controller';
import type { CloudTransport, CloudUser } from '../src/cloud/transport';
import type {
  ApplyResult,
  CloudEntity,
  CloudOperation,
  PullResult,
} from '../src/data/sync-types';

class MemoryStorage {
  data = new Map<string, string>();
  getItem = (key: string) => this.data.get(key) ?? null;
  setItem = (key: string, value: string) => {
    this.data.set(key, value);
  };
  removeItem = (key: string) => {
    this.data.delete(key);
  };
}
const person: CloudUser = { id: 'person-a', email: 'a@example.test' };
const other: CloudUser = { id: 'person-b', email: 'b@example.test' };
const clone = <T>(value: T): T => structuredClone(value);
const key = (entity: { kind: string; id: string }) =>
  `${entity.kind}:${entity.id}`;
class FakeTransport implements CloudTransport {
  user: CloudUser | null = person;
  offline = false;
  dropResponseOnce = false;
  malformedPullOnce = false;
  pulls = 0;
  applies = 0;
  writes = 0;
  appliedOwners: (string | null)[] = [];
  cursor = 0;
  rows = new Map<string, CloudEntity>();
  receipts = new Map<string, ApplyResult>();
  private listeners = new Set<(value: CloudUser | null) => void>();
  private online() {
    if (this.offline) throw new Error('network unavailable');
  }
  getUser = async () => {
    this.online();
    return this.user;
  };
  signIn = async (email: string, _password: string) => {
    this.online();
    this.user = email === other.email ? other : person;
    return this.user;
  };
  signOut = async () => {
    this.user = null;
    this.emit(null);
  };
  onUserChange = (listener: (value: CloudUser | null) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  emit(value: CloudUser | null) {
    this.user = value;
    for (const listener of this.listeners) listener(value);
  }
  put(entity: Omit<CloudEntity, 'version'>) {
    const row = { ...clone(entity), version: ++this.cursor };
    this.rows.set(key(row), row);
    return row;
  }
  pull = async (cursor: number): Promise<PullResult> => {
    this.online();
    this.pulls++;
    if (this.malformedPullOnce) {
      this.malformedPullOnce = false;
      return {
        cursor: this.cursor,
        entities: [
          {
            kind: 'focus',
            id: '2026-10-15',
            version: 1,
            data: { ids: ['a', 'b', 'c', 'four'] },
          },
        ],
      };
    }
    return {
      cursor: this.cursor,
      entities: clone(
        [...this.rows.values()].filter((entity) => entity.version > cursor),
      ),
    };
  };
  apply = async (operation: CloudOperation): Promise<ApplyResult> => {
    this.online();
    this.applies++;
    this.appliedOwners.push(this.user?.id ?? null);
    const receipt = this.receipts.get(operation.id);
    if (receipt) return clone(receipt);
    const conflict = operation.changes.some(
      (change) =>
        !sameEntityData(this.rows.get(key(change))?.data ?? null, change.base),
    );
    let result: ApplyResult;
    if (conflict)
      result = {
        status: 'conflict',
        cursor: this.cursor,
        entities: operation.changes.map((change) =>
          clone(
            this.rows.get(key(change)) ?? {
              kind: change.kind,
              id: change.id,
              version: 0,
              data: null,
            },
          ),
        ),
        message: 'same field changed remotely',
      };
    else {
      const entities = operation.changes.map((change) =>
        this.put({ kind: change.kind, id: change.id, data: change.next }),
      );
      this.writes++;
      result = {
        status: 'applied',
        cursor: this.cursor,
        entities: clone(entities),
      };
    }
    this.receipts.set(operation.id, clone(result));
    if (this.dropResponseOnce) {
      this.dropResponseOnce = false;
      throw new Error('response lost after server commit');
    }
    return result;
  };
}
function setup(t: TestContext, options: { unavailable?: boolean } = {}) {
  const browserStorage = new MemoryStorage();
  const originalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  );
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator',
  );
  Object.defineProperty(globalThis, 'localStorage', {
    value: browserStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    configurable: true,
  });
  const factory = options.unavailable
    ? ({
        open() {
          throw new Error('unavailable');
        },
      } as unknown as IDBFactory)
    : new IDBFactory();
  const service = new LocalTaskService({
    factory,
    name: 'controller-test',
    storage: browserStorage,
    scope: 'controller-tab',
    broadcast: false,
  });
  const transport = new FakeTransport();
  const controller = new CloudController(service, transport);
  t.after(() => {
    controller.close();
    service.close();
    if (originalStorage)
      Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (originalNavigator)
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });
  return { service, controller, transport, browserStorage };
}
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean, timeout = 1500) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('condition did not become true');
    await delay(10);
  }
}

test('existing local content requires explicit import before binding or uploading', async (t) => {
  const { service, controller, transport } = setup(t);
  await service.initialize();
  const note = await service.createNote('离线建立的片段');
  await controller.start();
  assert.equal(controller.getSnapshot().status, 'import');
  assert.equal(controller.getSnapshot().canUse, false);
  assert.equal((await service.getSyncState()).owner, null);
  assert.equal(transport.applies, 0);
  await controller.confirmImport();
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.equal(controller.getSnapshot().canUse, true);
  assert.equal((await service.getSyncState()).owner, person.id);
  assert.equal((await service.getSyncState()).pending, 0);
  assert.equal(
    transport.rows.get(`notes:${note.id}`)!.data?.text,
    '离线建立的片段',
  );
});

test('an empty installation binds once and finishes an authenticated initial synchronization', async (t) => {
  const { service, controller, transport } = setup(t);
  await controller.start();
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.equal(controller.getSnapshot().user?.id, person.id);
  assert.equal(controller.getSnapshot().canUse, true);
  assert.equal((await service.getSyncState()).owner, person.id);
  assert.ok((await service.getSyncState()).lastSyncedAt);
  assert.equal(transport.applies, 0);
});

test('records found only in recently deleted still require explicit import confirmation', async (t) => {
  const { service, controller, transport } = setup(t);
  await service.initialize();
  const note = await service.createNote('只在最近删除里');
  await service.deleteNote(note.id);
  await controller.start();
  assert.equal(controller.getSnapshot().status, 'import');
  assert.equal(controller.getSnapshot().canUse, false);
  assert.equal((await service.getSyncState()).owner, null);
  assert.equal(transport.applies, 0);
  await controller.confirmImport();
  assert.ok(transport.rows.get(`notes:${note.id}`)!.data?.deletedAt);
});

test('offline local mutations stay queued and upload when retry reconnects', async (t) => {
  const { service, controller, transport } = setup(t);
  await controller.start();
  transport.offline = true;
  const note = await service.createNote('断网也先收好');
  await controller.sync();
  assert.equal(controller.getSnapshot().status, 'offline');
  assert.equal(controller.getSnapshot().canUse, true);
  assert.equal((await service.getSyncState()).pending, 1);
  assert.equal(service.getSnapshot().notes[0].text, '断网也先收好');
  transport.offline = false;
  await controller.retry();
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.equal((await service.getSyncState()).pending, 0);
  assert.equal(
    transport.rows.get(`notes:${note.id}`)!.data?.text,
    '断网也先收好',
  );
});

test('a lost apply response retries the same operation receipt without duplicating server content', async (t) => {
  const { service, controller, transport } = setup(t);
  await controller.start();
  const note = await service.createNote('只保存一次');
  const [pending] = await service.getPendingOperations();
  transport.dropResponseOnce = true;
  await controller.sync();
  assert.equal(controller.getSnapshot().status, 'offline');
  assert.equal((await service.getPendingOperations())[0].id, pending.id);
  assert.equal(transport.writes, 1);
  await controller.retry();
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.equal(transport.applies, 2);
  assert.equal(transport.writes, 1);
  assert.equal(transport.rows.size, 1);
  assert.equal(service.getSnapshot().notes[0].id, note.id);
  assert.equal((await service.getSyncState()).pending, 0);
});

test('a same-field conflict keeps local content and does not block an unrelated operation', async (t) => {
  const { service, controller, transport } = setup(t);
  await controller.start();
  const note = await service.createNote('原文');
  await controller.sync();
  await service.updateNote(
    note.id,
    '本机改过的文字',
    service.getSnapshot().notes[0].revision,
  );
  await service.createTask({
    id: 'unrelated-task',
    title: '独立事项正常上传',
    date: '2026-10-15',
  });
  const current = transport.rows.get(`notes:${note.id}`)!;
  transport.put({
    kind: 'notes',
    id: note.id,
    data: { ...current.data, text: '另一台设备改过的文字' },
  });
  await controller.sync();
  const local = await service.getSyncState();
  assert.equal(local.pending, 0);
  assert.equal(local.conflicts.length, 1);
  assert.equal(
    service.getSnapshot().notes.find((item) => item.id === note.id)!.text,
    '本机改过的文字',
  );
  assert.equal(
    transport.rows.get('tasks:unrelated-task')!.data?.title,
    '独立事项正常上传',
  );
  assert.equal(controller.getSnapshot().status, 'idle');
});

test('changing accounts is refused and explicit logout preserves local data and its unsent queue', async (t) => {
  const { service, controller, transport } = setup(t);
  await controller.start();
  transport.offline = true;
  const note = await service.createNote('原账号待上传');
  await controller.sync();
  transport.offline = false;
  await controller.signIn(other.email, 'password');
  assert.equal(controller.getSnapshot().status, 'error');
  assert.equal(controller.getSnapshot().canUse, false);
  assert.equal((await service.getSyncState()).owner, person.id);
  assert.equal((await service.getSyncState()).pending, 1);
  assert.equal(transport.applies, 0);
  await controller.signOut();
  assert.equal(controller.getSnapshot().status, 'signed-out');
  assert.equal((await service.getSyncState()).pending, 1);
  assert.equal(service.getSnapshot().notes[0].id, note.id);
  await controller.sync();
  assert.equal(transport.applies, 0);
  await controller.signIn(person.email, 'password');
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.equal((await service.getSyncState()).pending, 0);
});

test('local subscriptions synchronize a new write once and do not create a 450ms idle synchronization loop', async (t) => {
  const { service, controller, transport } = setup(t);
  await controller.start();
  const initial = transport.pulls;
  await delay(1050);
  assert.equal(transport.pulls, initial);
  await service.createNote('自动排队');
  await until(
    () => transport.writes === 1 && controller.getSnapshot().status === 'idle',
  );
  const settled = transport.pulls;
  await delay(1050);
  assert.equal(transport.pulls, settled);
  assert.equal(transport.applies, 1);
});

test('a transient post-auth local acceptance failure can recover with retry', async (t) => {
  const { controller, transport } = setup(t);
  transport.malformedPullOnce = true;
  await controller.start();
  assert.equal(controller.getSnapshot().status, 'offline');
  assert.equal(controller.getSnapshot().canUse, false);
  await controller.retry();
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.equal(controller.getSnapshot().canUse, true);
});

test('database startup errors become an explicit controller state instead of an unhandled start rejection', async (t) => {
  const { controller } = setup(t, { unavailable: true });
  await assert.doesNotReject(() => controller.start());
  assert.equal(controller.getSnapshot().status, 'error');
  assert.equal(controller.getSnapshot().canUse, false);
});

test('losing IndexedDB after startup is caught by sync rather than leaking a rejected background promise', async (t) => {
  const { controller, service } = setup(t);
  await controller.start();
  service.close();
  await assert.doesNotReject(() => controller.sync());
  assert.ok(['error', 'offline'].includes(controller.getSnapshot().status));
  assert.ok(controller.getSnapshot().error);
});

test('switching credentials while the local queue is being read cannot send the old account payload', async (t) => {
  const { controller, service, transport } = setup(t);
  await controller.start();
  await service.createNote('不能发给新账号的私人片段');
  const original = service.getPendingOperations;
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  service.getPendingOperations = async () => {
    const pending = await original();
    if (!held && pending.length) {
      held = true;
      entered();
      await gate;
    }
    return pending;
  };
  const syncing = controller.sync();
  await reached;
  await controller.signIn(other.email, 'password');
  release();
  await syncing;
  assert.equal(transport.applies, 0);
  assert.deepEqual(transport.appliedOwners, []);
  assert.equal((await service.getSyncState()).pending, 1);
  assert.equal(controller.getSnapshot().canUse, false);
});

test('a verified bound account can reopen offline, while explicit logout removes offline trust', async (t) => {
  const { controller, service, transport } = setup(t);
  await controller.start();
  controller.close();
  transport.offline = true;
  const offline = new CloudController(service, transport);
  t.after(() => offline.close());
  await offline.start();
  assert.equal(offline.getSnapshot().status, 'offline');
  assert.equal(offline.getSnapshot().canUse, true);
  assert.equal(offline.getSnapshot().user?.id, person.id);
  await offline.signOut();
  offline.close();
  const signedOut = new CloudController(service, transport);
  t.after(() => signedOut.close());
  await signedOut.start();
  assert.equal(signedOut.getSnapshot().canUse, false);
  assert.equal(signedOut.getSnapshot().user, null);
});

test('changing accounts during import confirmation cannot reopen the old private data under the new account', async (t) => {
  const { controller, service, transport } = setup(t);
  await service.initialize();
  await service.createNote('待确认导入的私人内容');
  await controller.start();
  assert.equal(controller.getSnapshot().status, 'import');
  const original = service.bindAccount;
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  service.bindAccount = async (owner) => {
    await original(owner);
    entered();
    await gate;
  };
  const importing = controller.confirmImport();
  await reached;
  await controller.signIn(other.email, 'password');
  release();
  await importing;
  assert.equal(controller.getSnapshot().user?.id, other.id);
  assert.equal(controller.getSnapshot().canUse, false);
  assert.equal((await service.getSyncState()).owner, person.id);
  assert.equal(transport.applies, 0);
});

test('real PostgreSQL RPCs accept local task/focus operations and merge independent edits across devices', async (t) => {
  const { controller, service, transport } = setup(t);
  const db = new PGlite();
  t.after(async () => {
    await db.close();
  });
  const account = '11111111-1111-4111-8111-111111111111';
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await db.exec(
    await readFile(
      resolve('supabase/migrations/20261015_private_sync.sql'),
      'utf8',
    ),
  );
  await db.exec(`
    insert into auth.users(id,email) values('${account}','private@example.test');
    insert into public.app_owners(user_id) values('${account}');
    set role authenticated;
    select set_config('request.jwt.claim.sub','${account}',false);
  `);
  transport.user = { id: account, email: 'private@example.test' };
  transport.pull = async (cursor, expectedOwner = account) =>
    (
      await db.query<{ result: PullResult }>(
        'select public.pull_changes(after_cursor => $1::bigint, expected_owner => $2::uuid) as result',
        [cursor, expectedOwner],
      )
    ).rows[0].result;
  transport.apply = async (operation) =>
    (
      await db.query<{ result: ApplyResult }>(
        'select public.apply_operation(operation => $1::jsonb) as result',
        [JSON.stringify(operation)],
      )
    ).rows[0].result;
  await controller.start();
  const task = await service.createTask(
    { id: 'shared-task', title: '原来的标题', date: '2026-10-15' },
    { focusDay: '2026-10-15' },
  );
  await controller.sync();
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.equal((await service.getSyncState()).pending, 0);
  assert.deepEqual(service.getSnapshot().focus['2026-10-15'], [task.id]);
  const second = new LocalTaskService({
    name: 'second-device',
    factory: new IDBFactory(),
    storage: { getItem: () => null },
    scope: 'device-b',
    broadcast: false,
  });
  t.after(() => second.close());
  await second.initialize();
  await second.bindAccount(account);
  await second.acceptRemote(await transport.pull(0));
  await service.updateTask(
    task.id,
    { title: '设备 A 修改的标题' },
    service.getSnapshot().tasks[0].revision,
  );
  await second.toggleTask(task.id, true);
  const [operation] = await second.getPendingOperations();
  await second.acknowledgeOperation(
    operation.id,
    await transport.apply(operation),
  );
  await controller.sync();
  assert.equal(service.getSnapshot().tasks[0].title, '设备 A 修改的标题');
  assert.equal(service.getSnapshot().tasks[0].completed, true);
  assert.equal((await service.getSyncState()).pending, 0);
  assert.equal((await service.getSyncState()).conflicts.length, 0);
  await second.acceptRemote(
    await transport.pull((await second.getSyncState()).cursor),
  );
  assert.equal(second.getSnapshot().tasks[0].title, '设备 A 修改的标题');
  assert.equal(second.getSnapshot().tasks[0].completed, true);
});

for (const lateResult of ['reject', 'person', 'signed-out'] as const)
  test(`late startup authentication (${lateResult}) cannot replace a newer refused account login`, async (t) => {
    const { controller, service, transport, browserStorage } = setup(t);
    await service.initialize();
    await service.bindAccount(person.id);
    browserStorage.setItem(
      'life-preview.trusted-cloud-account',
      JSON.stringify(person),
    );
    let entered!: () => void,
      finish!: (value: CloudUser | null) => void,
      fail!: (error: Error) => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const result = new Promise<CloudUser | null>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    transport.getUser = () => {
      entered();
      return result;
    };
    const starting = controller.start();
    await reached;
    await controller.signIn(other.email, 'password');
    assert.equal(controller.getSnapshot().user?.id, other.id);
    assert.equal(controller.getSnapshot().canUse, false);
    if (lateResult === 'reject') fail(new Error('old startup request failed'));
    else finish(lateResult === 'person' ? person : null);
    await starting;
    assert.equal(controller.getSnapshot().user?.id, other.id);
    assert.equal(controller.getSnapshot().canUse, false);
    assert.equal(controller.getSnapshot().status, 'error');
    assert.equal(transport.pulls, 0);
  });

test('conflict resolution is refused while signed out or authenticated as a different account', async (t) => {
  const { controller, service, transport } = setup(t);
  await controller.start();
  const note = await service.createNote('原片段');
  await controller.sync();
  await service.updateNote(
    note.id,
    'A 的未同步修改',
    service.getSnapshot().notes[0].revision,
  );
  const remote = transport.rows.get(`notes:${note.id}`)!;
  transport.put({
    kind: 'notes',
    id: note.id,
    data: { ...remote.data, text: '另一台设备的修改' },
  });
  await controller.sync();
  const conflict = (await service.getSyncState()).conflicts[0];
  assert.ok(conflict);
  await controller.signIn(other.email, 'password');
  await assert.rejects(controller.resolve(conflict.id, 'remote'), /账号|登录/);
  assert.equal((await service.getSyncState()).conflicts.length, 1);
  assert.equal(
    service.getSnapshot().notes.find((item) => item.id === note.id)!.text,
    'A 的未同步修改',
  );
  await controller.signOut();
  await assert.rejects(controller.resolve(conflict.id, 'copy'), /账号|登录/);
  assert.equal(service.getSnapshot().notes.length, 1);
  assert.equal((await service.getSyncState()).conflicts.length, 1);
});

test('a failed SDK sign-out remains signed out after reopening even when the SDK still returns its cached user', async (t) => {
  const { controller, service, transport, browserStorage } = setup(t);
  await controller.start();
  await service.createNote('退出前的待同步内容');
  transport.signOut = async () => {
    throw new Error('expired JWT and offline');
  };
  await assert.rejects(controller.signOut(), /expired JWT/);
  assert.equal(browserStorage.getItem('life-preview.cloud-signed-out'), '1');
  assert.equal(controller.getSnapshot().canUse, false);
  assert.equal((await service.getSyncState()).pending, 1);
  controller.close();
  let getUserCalls = 0;
  transport.getUser = async () => {
    getUserCalls++;
    return person;
  };
  const reopened = new CloudController(service, transport);
  t.after(() => reopened.close());
  const pulls = transport.pulls;
  await reopened.start();
  transport.emit(person);
  await Promise.resolve();
  await reopened.retry();
  assert.equal(reopened.getSnapshot().status, 'signed-out');
  assert.equal(reopened.getSnapshot().canUse, false);
  assert.equal(reopened.getSnapshot().user, null);
  assert.equal(getUserCalls, 0);
  assert.equal(transport.pulls, pulls);
  assert.equal((await service.getSyncState()).pending, 1);
});

test('only a successful explicit sign-in clears the persistent sign-out gate', async (t) => {
  const { controller, service, transport, browserStorage } = setup(t);
  await controller.start();
  await controller.signOut();
  const pulls = transport.pulls;
  transport.offline = true;
  await assert.rejects(controller.signIn(person.email, 'password'), /network/);
  assert.equal(browserStorage.getItem('life-preview.cloud-signed-out'), '1');
  assert.equal(controller.getSnapshot().status, 'signed-out');
  assert.equal(controller.getSnapshot().canUse, false);
  transport.emit(person);
  await controller.retry();
  assert.equal(transport.pulls, pulls);
  transport.offline = false;
  await controller.signIn(person.email, 'password');
  assert.equal(browserStorage.getItem('life-preview.cloud-signed-out'), null);
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.equal(controller.getSnapshot().canUse, true);
  assert.equal((await service.getSyncState()).owner, person.id);
});

test('a sign-in response started before sign-out cannot clear the persistent gate when it finally arrives', async (t) => {
  const { controller, service, transport, browserStorage } = setup(t);
  await controller.start();
  await service.createNote('迟到登录不能自动上传');
  let entered!: () => void, finish!: (user: CloudUser) => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const result = new Promise<CloudUser>((resolve) => {
    finish = resolve;
  });
  transport.signIn = async () => {
    entered();
    return result;
  };
  const signingIn = controller.signIn(person.email, 'password');
  await reached;
  await controller.signOut();
  finish(person);
  await signingIn;
  assert.equal(browserStorage.getItem('life-preview.cloud-signed-out'), '1');
  assert.equal(controller.getSnapshot().status, 'signed-out');
  assert.equal(controller.getSnapshot().user, null);
  assert.equal(controller.getSnapshot().canUse, false);
  assert.equal((await service.getSyncState()).pending, 1);
});

test('a sign-out storage event immediately locks another active page and SDK user events cannot reopen it', async (t) => {
  const { controller, transport, browserStorage } = setup(t);
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const pageWindow = new EventTarget();
  const pageDocument = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
  });
  Object.defineProperty(globalThis, 'window', {
    value: pageWindow,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: pageDocument,
    configurable: true,
  });
  t.after(() => {
    controller.close();
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalDocument)
      Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  await controller.start();
  assert.equal(controller.getSnapshot().canUse, true);
  browserStorage.setItem('life-preview.cloud-signed-out', '1');
  const event = new Event('storage');
  Object.defineProperties(event, {
    key: { value: 'life-preview.cloud-signed-out' },
    newValue: { value: '1' },
  });
  pageWindow.dispatchEvent(event);
  transport.emit(person);
  await Promise.resolve();
  assert.equal(controller.getSnapshot().status, 'signed-out');
  assert.equal(controller.getSnapshot().canUse, false);
  assert.equal(controller.getSnapshot().user, null);
});
