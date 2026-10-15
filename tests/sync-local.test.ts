import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { LocalTaskService } from '../src/data/service';
import type { CloudEntity, PendingOperation } from '../src/data/sync-types';

const storage = { getItem: () => null };
function setup() {
  const factory = new IDBFactory();
  const create = (scope = 'test-a') =>
    new LocalTaskService({
      name: 'sync-test',
      factory,
      storage,
      scope,
      broadcast: false,
    });
  return { factory, create };
}
const response = (operation: PendingOperation, version = 1): CloudEntity[] =>
  operation.changes.map((change) => ({
    kind: change.kind,
    id: change.id,
    version,
    data: change.next,
  }));
const taskInput = (title: string) => ({ title, date: '2026-10-15' });
const timestamp = '2026-10-15T01:00:00.000Z';
const remoteTask = (id: string): CloudEntity => ({
  kind: 'tasks',
  id,
  version: 1,
  data: {
    title: id,
    date: '2026-10-15',
    completed: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
});

test('upgrading a real version-one database preserves rows and adds synchronization stores', async () => {
  const { factory, create } = setup();
  await new Promise<void>((resolve, reject) => {
    const opening = factory.open('sync-test', 1);
    opening.onupgradeneeded = () => {
      for (const [name, keyPath] of [
        ['notes', 'id'],
        ['tasks', 'id'],
        ['dayFocus', 'day'],
        ['dayNotes', 'date'],
        ['drafts', 'key'],
        ['meta', 'key'],
      ])
        opening.result.createObjectStore(name, { keyPath });
      opening
        .transaction!.objectStore('notes')
        .put({
          id: 'kept',
          text: '原来的片段',
          createdAt: timestamp,
          updatedAt: timestamp,
          revision: 7,
        });
      opening
        .transaction!.objectStore('drafts')
        .put({ key: 'notes:new', text: '未写完', updatedAt: timestamp });
    };
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      opening.result.close();
      resolve();
    };
  });
  const service = create();
  await service.initialize();
  assert.equal(service.getSnapshot().notes[0].id, 'kept');
  assert.equal(service.getSnapshot().notes[0].revision, 7);
  assert.equal(service.getSnapshot().drafts[0].text, '未写完');
  const exported = JSON.parse(await service.exportData());
  assert.deepEqual(exported.data.outbox, []);
  assert.deepEqual(exported.data.syncEntities, []);
  assert.deepEqual(exported.data.syncConflicts, []);
  await service.bindAccount('person');
  assert.equal((await service.getPendingOperations())[0].changes[0].id, 'kept');
  service.close();
});

test('binding imports existing records once in batches of at most 100 and refuses another account', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  for (let index = 0; index < 104; index++)
    await service.createTask({
      ...taskInput(String(index)),
      id: `task-${index}`,
    });
  const note = await service.createNote('没有先登录也能保存');
  await service.saveDayNote('2026-10-15', '当天备注');
  await service.setFocus('2026-10-15', 'task-0');
  assert.deepEqual(await service.getPendingOperations(), []);
  assert.deepEqual(service.getImportCounts(), {
    notes: 1,
    tasks: 104,
    dayNotes: 1,
    focus: 1,
  });
  await service.bindAccount('person');
  const imported = await service.getPendingOperations();
  assert.deepEqual(
    imported.map((operation) => operation.changes.length),
    [100, 7],
  );
  assert.equal(imported[0].owner, 'person');
  const importedNote = imported
    .flatMap((operation) => operation.changes)
    .find((change) => change.id === note.id)!;
  assert.equal(importedNote.base, null);
  assert.ok(!('revision' in importedNote.next!));
  assert.ok(!('id' in importedNote.next!));
  await service.bindAccount('person');
  assert.deepEqual(await service.getPendingOperations(), imported);
  await assert.rejects(service.bindAccount('other'), /其他账号/);
  assert.equal((await service.getSyncState()).owner, 'person');
  service.close();
});

test('business writes, cleared drafts and their outbox operation commit or roll back together', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  await service.bindAccount('person');
  await service.saveDraft('new-task', '不能丢的草稿');
  const original = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    if (this.name === 'outbox') throw new Error('simulated quota');
    return original.call(this, value, key);
  };
  try {
    await assert.rejects(
      service.createTask(
        { ...taskInput('事务失败'), id: 'rollback' },
        { draftKey: 'new-task' },
      ),
      /尚未保存/,
    );
  } finally {
    IDBObjectStore.prototype.add = original;
  }
  assert.equal(service.getSnapshot().tasks.length, 0);
  const reopened = create('test-b');
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().tasks.length, 0);
  assert.equal((await reopened.getSyncState()).pending, 0);
  assert.ok(
    JSON.parse(await reopened.exportData()).data.drafts.some(
      (draft: { text: string }) => draft.text === '不能丢的草稿',
    ),
  );
  await service.createTask(
    { ...taskInput('成功保存'), id: 'saved' },
    { focusDay: '2026-10-15' },
  );
  assert.deepEqual(
    (await service.getPendingOperations())[0].changes.map(
      (change) => change.kind,
    ),
    ['tasks', 'focus'],
  );
  const count = (await service.getSyncState()).pending;
  await service.toggleTask('saved', false);
  await service.saveDraft('only-draft', '不进入云端队列');
  assert.equal((await service.getSyncState()).pending, count);
  service.close();
  reopened.close();
});

test('pull protects pending edits, acknowledgements preserve later operations and never advance pull cursor', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  await service.bindAccount('person');
  const note = await service.createNote('第一版');
  await service.updateNote(note.id, '第二版', note.revision);
  const [first, second] = await service.getPendingOperations();
  assert.equal(second.changes[0].base?.text, '第一版');
  await service.acceptRemote({
    cursor: 5,
    entities: [
      {
        ...response(first)[0],
        data: { ...first.changes[0].next, text: '云端旧文' },
      },
    ],
  });
  assert.equal(service.getSnapshot().notes[0].text, '第二版');
  await service.acknowledgeOperation(first.id, {
    status: 'applied',
    cursor: 99,
    entities: response(first, 2),
  });
  assert.equal((await service.getSyncState()).cursor, 5);
  assert.equal(service.getSnapshot().notes[0].text, '第二版');
  const revision = service.getSnapshot().notes[0].revision;
  await service.acknowledgeOperation(second.id, {
    status: 'applied',
    cursor: 100,
    entities: response(second, 3),
  });
  assert.equal(service.getSnapshot().notes[0].revision, revision);
  assert.equal((await service.getSyncState()).pending, 0);
  await service.acceptRemote({ cursor: 4, entities: response(first, 1) });
  assert.equal(service.getSnapshot().notes[0].text, '第二版');
  assert.equal((await service.getSyncState()).cursor, 5);
  service.close();
});

test('a conflict isolates dependent operations and later edits, while unrelated tasks continue', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  await service.bindAccount('person');
  const note = await service.createNote('第一版');
  await service.updateNote(note.id, '本地第二版', 1);
  const other = await service.createTask(taskInput('独立事项'));
  const [first] = await service.getPendingOperations();
  const remote: CloudEntity = {
    ...response(first)[0],
    version: 8,
    data: { ...first.changes[0].next, text: '云端第八版' },
  };
  await service.acknowledgeOperation(first.id, {
    status: 'conflict',
    cursor: 90,
    entities: [remote],
  });
  assert.equal((await service.getPendingOperations()).length, 1);
  assert.equal(
    (await service.getPendingOperations())[0].changes[0].id,
    other.id,
  );
  let state = await service.getSyncState();
  assert.equal(state.conflicts.length, 1);
  assert.equal(
    state.conflicts[0].operation.changes[0].next?.text,
    '本地第二版',
  );
  await service.updateNote(
    note.id,
    '冲突后的第三版',
    service.getSnapshot().notes[0].revision,
  );
  state = await service.getSyncState();
  assert.equal(state.conflicts.length, 1);
  assert.equal(state.pending, 1);
  await service.acceptRemote({
    cursor: 12,
    entities: [
      {
        ...remote,
        version: 9,
        data: { ...remote.data, text: '云端最新第九版' },
      },
    ],
  });
  assert.equal(service.getSnapshot().notes[0].text, '冲突后的第三版');
  await service.resolveConflict(state.conflicts[0].id, 'copy');
  assert.equal(
    service.getSnapshot().notes.find((item) => item.id === note.id)!.text,
    '云端最新第九版',
  );
  const copy = service.getSnapshot().notes.find((item) => item.id !== note.id)!;
  assert.equal(copy.text, '冲突后的第三版');
  assert.equal((await service.getSyncState()).conflicts.length, 0);
  assert.ok(
    (await service.getPendingOperations()).some((operation) =>
      operation.changes.some(
        (change) => change.id === copy.id && change.base === null,
      ),
    ),
  );
  service.close();
  const reopened = create();
  await reopened.initialize();
  assert.equal((await reopened.getSyncState()).owner, 'person');
  assert.equal((await reopened.getSyncState()).pending, 2);
  assert.equal(reopened.getSnapshot().notes.length, 2);
  reopened.close();
});

test('focus conflicts retain a newly-created candidate as a dated task without silently adding a fourth priority', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  await service.bindAccount('person');
  const candidate = await service.createTask(
    { ...taskInput('留在月历里'), id: 'candidate' },
    { focusDay: '2026-10-15' },
  );
  const [operation] = await service.getPendingOperations();
  const focus: CloudEntity = {
    kind: 'focus',
    id: '2026-10-15',
    version: 6,
    data: { ids: ['a', 'b', 'c'] },
  };
  await service.acknowledgeOperation(operation.id, {
    status: 'conflict',
    cursor: 88,
    entities: [
      focus,
      { kind: 'tasks', id: candidate.id, version: 0, data: null },
    ],
  });
  await service.acceptRemote({
    cursor: 8,
    entities: [remoteTask('a'), remoteTask('b'), remoteTask('c'), focus],
  });
  const conflict = (await service.getSyncState()).conflicts[0];
  await service.resolveConflict(conflict.id, 'remote');
  assert.deepEqual(service.getSnapshot().focus['2026-10-15'], ['a', 'b', 'c']);
  assert.ok(
    service
      .getSnapshot()
      .tasks.some(
        (task) => task.id === 'candidate' && task.date === '2026-10-15',
      ),
  );
  const pending = await service.getPendingOperations();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].changes.length, 1);
  assert.equal(pending[0].changes[0].kind, 'tasks');
  service.close();
});

test('concurrent local connections allocate ordered independent operations and enforce one owner', async () => {
  const { create } = setup();
  const a = create(),
    b = create('test-b');
  await Promise.all([a.initialize(), b.initialize()]);
  const bindings = await Promise.allSettled([
    a.bindAccount('person'),
    b.bindAccount('other'),
  ]);
  assert.equal(
    bindings.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  await Promise.all([
    a.createTask({ ...taskInput('a'), id: 'a' }),
    b.createTask({ ...taskInput('b'), id: 'b' }),
  ]);
  const operations = await a.getPendingOperations();
  assert.equal(operations.length, 2);
  assert.equal(new Set(operations.map((operation) => operation.id)).size, 2);
  assert.equal(new Set(operations.map((operation) => operation.owner)).size, 1);
  a.close();
  b.close();
});

test('update barriers wait for draft commits without requiring network acknowledgement', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  await service.bindAccount('person');
  await service.createNote('尚未上传');
  const saving = service.saveDraft('notes:new', '更新前的草稿');
  await service.flushPendingWrites();
  await saving;
  assert.equal((await service.getSyncState()).pending, 1);
  assert.ok(
    JSON.parse(await service.exportData()).data.drafts.some(
      (draft: { text: string }) => draft.text === '更新前的草稿',
    ),
  );
  service.close();
  const unavailable = new LocalTaskService({
    factory: {
      open() {
        throw new Error('unavailable');
      },
    } as unknown as IDBFactory,
    storage,
    scope: 'unavailable',
    broadcast: false,
  });
  await assert.rejects(unavailable.saveDraft('notes:new', '当前页仍保留'));
  await assert.rejects(unavailable.flushPendingWrites(), /暂不可用/);
  assert.equal(
    JSON.parse(await unavailable.exportData()).unsavedDrafts[0].text,
    '当前页仍保留',
  );
  unavailable.close();
});

test('failed account import rolls back its owner marker and can be retried without duplicate imports', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  await service.createNote('绑定前的内容');
  const original = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    if (this.name === 'outbox') throw new Error('simulated import failure');
    return original.call(this, value, key);
  };
  try {
    await assert.rejects(service.bindAccount('person'));
  } finally {
    IDBObjectStore.prototype.add = original;
  }
  assert.equal((await service.getSyncState()).owner, null);
  assert.equal((await service.getSyncState()).pending, 0);
  await service.bindAccount('person');
  assert.equal((await service.getSyncState()).pending, 1);
  assert.equal(service.getSnapshot().notes.length, 1);
  service.close();
});

test('one import collision does not discard other new rows when resolving in favor of the cloud', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  const collision = await service.createNote('本机冲突片段');
  const independent = await service.createNote('另一条无冲突片段');
  const task = await service.createTask({
    ...taskInput('无冲突的事项'),
    id: 'new-import-task',
  });
  await service.saveDayNote('2026-10-15', '无冲突的备注');
  await service.bindAccount('person');
  const [operation] = await service.getPendingOperations();
  const remote = operation.changes.map((change) => ({
    kind: change.kind,
    id: change.id,
    version: change.id === collision.id ? 2 : 0,
    data:
      change.id === collision.id ? { ...change.next, text: '云端片段' } : null,
  }));
  await service.acknowledgeOperation(operation.id, {
    status: 'conflict',
    cursor: 4,
    entities: remote,
  });
  await service.resolveConflict(
    (await service.getSyncState()).conflicts[0].id,
    'remote',
  );
  assert.equal(
    service.getSnapshot().notes.find((note) => note.id === collision.id)!.text,
    '云端片段',
  );
  assert.equal(
    service.getSnapshot().notes.find((note) => note.id === independent.id)!
      .text,
    '另一条无冲突片段',
  );
  assert.ok(service.getSnapshot().tasks.some((item) => item.id === task.id));
  assert.equal(service.getSnapshot().dayNotes[0].text, '无冲突的备注');
  const remaining = (await service.getPendingOperations()).flatMap(
    (item) => item.changes,
  );
  assert.equal(remaining.length, 3);
  assert.ok(remaining.every((change) => change.base === null));
  service.close();
});

test('conflict previews track the newest shadow, duplicate acknowledgements and readonly sync checks are harmless', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  await service.bindAccount('person');
  const note = await service.createNote('本机');
  const [operation] = await service.getPendingOperations();
  const remote: CloudEntity = {
    ...response(operation)[0],
    version: 2,
    data: { ...operation.changes[0].next, text: '云端二' },
  };
  await service.acknowledgeOperation(operation.id, {
    status: 'conflict',
    cursor: 44,
    entities: [remote],
  });
  await service.acceptRemote({
    cursor: 10,
    entities: [
      { ...remote, version: 3, data: { ...remote.data, text: '云端三' } },
    ],
  });
  assert.equal(
    (await service.getSyncState()).conflicts[0].remote[0].data?.text,
    '云端三',
  );
  await service.acknowledgeOperation(operation.id, {
    status: 'conflict',
    cursor: 44,
    entities: [remote],
  });
  assert.equal(
    (await service.getSyncState()).conflicts[0].remote[0].data?.text,
    '云端三',
  );
  assert.equal((await service.getSyncState()).cursor, 10);
  let notifications = 0;
  const unsubscribe = service.subscribe(() => notifications++);
  await service.getSyncState();
  await service.getPendingOperations();
  await service.getSyncState();
  assert.equal(notifications, 0);
  unsubscribe();
  await service.resolveConflict(
    (await service.getSyncState()).conflicts[0].id,
    'remote',
  );
  assert.equal(
    service.getSnapshot().notes.find((item) => item.id === note.id)!.text,
    '云端三',
  );
  service.close();
});

test('invalid remote payloads roll back shadow, local changes and cursor together', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  await service.bindAccount('person');
  await assert.rejects(
    service.acceptRemote({
      cursor: 2,
      entities: [
        remoteTask('valid'),
        {
          kind: 'focus',
          id: '2026-10-15',
          version: 1,
          data: { ids: ['a', 'b', 'c', 'four'] },
        },
      ],
    }),
    /重点格式/,
  );
  assert.equal(service.getSnapshot().tasks.length, 0);
  assert.equal((await service.getSyncState()).cursor, 0);
  assert.equal(
    JSON.parse(await service.exportData()).data.syncEntities.length,
    0,
  );
  service.close();
});

test('a new process scope can recover older drafts without replacing the current input or the source', async () => {
  const { create } = setup();
  const original = create('old-process');
  await original.initialize();
  await original.saveDraft('notes:new', '旧进程还没有收好的想法');
  await original.saveDraft(
    'task:new:2026-10-15:',
    JSON.stringify({
      title: '读完一章',
      date: '2026-10-15',
      time: '09:30',
      details: '把手机放远一点',
    }),
  );
  original.close();
  const current = create('new-process');
  await current.initialize();
  await current.saveDraft('notes:new', '当前窗口的输入');
  const available = await current.listRecoverableDrafts();
  assert.equal(available.length, 2);
  assert.ok(
    available.some(
      (draft) =>
        draft.key === 'notes:new' && draft.text === '旧进程还没有收好的想法',
    ),
  );
  assert.ok(!available.some((draft) => draft.text === '当前窗口的输入'));
  const oldNote = available.find((draft) => draft.key === 'notes:new')!;
  await current.recoverDraft(oldNote.id, oldNote);
  assert.equal(
    current.getSnapshot().drafts.find((draft) => draft.key === 'notes:new')!
      .text,
    '当前窗口的输入',
  );
  const task = available.find((draft) => draft.key.startsWith('task:'))!;
  const recoveredTask = await current.recoverDraft(task.id, task);
  assert.match(recoveredTask.text, /读完一章/);
  assert.match(recoveredTask.text, /09:30/);
  assert.match(recoveredTask.text, /把手机放远一点/);
  assert.equal((await current.listRecoverableDrafts()).length, 0);
  const exported = JSON.parse(await current.exportData());
  assert.ok(
    exported.data.drafts.some(
      (draft: { key: string; text: string }) =>
        draft.key === oldNote.id && draft.text === oldNote.text,
    ),
  );
  current.close();
});

test('simultaneous recovery clicks create one note and one cloud operation, and a revised source can be recovered again', async () => {
  const { create } = setup();
  const old = create('old');
  const current = create('current');
  await old.initialize();
  await old.saveDraft('notes:new', '第一版旧草稿');
  await current.initialize();
  await current.bindAccount('person');
  const draft = (await current.listRecoverableDrafts())[0];
  const [a, b] = await Promise.all([
    current.recoverDraft(draft.id, draft),
    current.recoverDraft(draft.id, draft),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(current.getSnapshot().notes.length, 1);
  assert.equal((await current.getSyncState()).pending, 1);
  await old.saveDraft('notes:new', '原窗口继续写下第二版');
  const updated = (await current.listRecoverableDrafts())[0];
  await assert.rejects(current.recoverDraft(draft.id, draft), /刚刚修改/);
  const second = await current.recoverDraft(updated.id, updated);
  assert.notEqual(second.id, a.id);
  assert.equal(second.text, '原窗口继续写下第二版');
  assert.equal(old.getSnapshot().drafts[0].text, '原窗口继续写下第二版');
  old.close();
  current.close();
});

test('recovery failure preserves the source and does not mark it recovered or leave a partial note', async () => {
  const { create } = setup();
  const old = create('old');
  const current = create('current');
  await old.initialize();
  await old.saveDraft('notes:new', '失败后仍要保留');
  await current.initialize();
  await current.bindAccount('person');
  const draft = (await current.listRecoverableDrafts())[0];
  const original = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    if (this.name === 'outbox') throw new Error('quota');
    return original.call(this, value, key);
  };
  try {
    await assert.rejects(current.recoverDraft(draft.id, draft));
  } finally {
    IDBObjectStore.prototype.add = original;
  }
  assert.equal(current.getSnapshot().notes.length, 0);
  assert.equal((await current.listRecoverableDrafts()).length, 1);
  assert.equal((await current.getSyncState()).pending, 0);
  await current.recoverDraft(draft.id, draft);
  assert.equal(current.getSnapshot().notes.length, 1);
  old.close();
  current.close();
});

test('recovery omits blank opened forms and unchanged editor safety drafts', async () => {
  const { create } = setup();
  const old = create('old');
  await old.initialize();
  const note = await old.createNote('已经收好的内容');
  const task = await old.createTask({
    ...taskInput('已经安排的事'),
    id: 'saved-task',
  });
  await old.saveDraft(
    'task:new:2026-10-15:',
    JSON.stringify({ title: '', date: '2026-10-15', time: '', details: '' }),
  );
  await old.saveDraft('notes:edit:' + note.id, note.text, note.revision);
  await old.saveDraft(
    'task:edit:' + task.id,
    JSON.stringify({
      title: task.title,
      date: task.date,
      time: '',
      details: '',
    }),
    task.revision,
  );
  const current = create('new');
  await current.initialize();
  assert.equal((await current.listRecoverableDrafts()).length, 0);
  await old.saveDraft(
    'notes:edit:' + note.id,
    '这个改动还没有保存',
    note.revision,
  );
  assert.equal((await current.listRecoverableDrafts()).length, 1);
  old.close();
  current.close();
});
