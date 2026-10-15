import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { LocalTaskService, sortTasks } from '../src/data/service';
import { DataError } from '../src/data/types';
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
function setup(storage = new MemoryStorage()) {
  const factory = new IDBFactory();
  const create = (scope = 'tab-a') =>
    new LocalTaskService({
      factory,
      name: 'test-data',
      storage,
      scope,
      broadcast: false,
    });
  return { create, storage };
}
const input = (title: string, date = '2026-10-15') => ({ title, date });

test('migrates all three legacy plugins once, preserving source bytes and draft', async () => {
  const { create, storage } = setup();
  const legacy = {
    version: 1,
    notes: [
      { id: 'n1', text: '原片段', createdAt: '2026-10-14T01:00:00.000Z' },
    ],
    draft: '未写完',
    calendar: { '2026-10-14': '旧日记' },
    today: { '2026-10-15': '读完一章\n保留详情' },
  };
  const raw = JSON.stringify(legacy);
  storage.setItem('life-preview.content.v1', raw);
  const service = create();
  await service.initialize();
  assert.equal(service.getSnapshot().notes[0].text, '原片段');
  assert.equal(service.getSnapshot().drafts[0].text, '未写完');
  assert.equal(service.getSnapshot().dayNotes[0].text, '旧日记');
  assert.equal(service.getSnapshot().tasks[0].title, '读完一章');
  assert.equal(
    service.getSnapshot().tasks[0].details,
    legacy.today['2026-10-15'],
  );
  const id = service.getSnapshot().tasks[0].id;
  await service.updateTask(id, { title: '新标题' }, 1);
  service.close();
  const reopened = create();
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().tasks.length, 1);
  assert.equal(reopened.getSnapshot().tasks[0].title, '新标题');
  assert.equal(storage.getItem('life-preview.content.v1'), raw);
  reopened.close();
});

test('a damaged namespace recovers valid notes and does not block calendar migration', async () => {
  const { create, storage } = setup();
  storage.setItem(
    'life-preview.plugin.notes.v1',
    JSON.stringify({
      version: 1,
      draft: '保留',
      notes: [
        { id: 'ok', text: '有效', createdAt: '2026-10-14T00:00:00Z' },
        { id: 'broken' },
      ],
    }),
  );
  storage.setItem(
    'life-preview.plugin.calendar.v1',
    JSON.stringify({ version: 1, records: { '2026-10-15': '备注' } }),
  );
  const service = create();
  await service.initialize();
  assert.equal(service.getSnapshot().notes.length, 1);
  assert.equal(service.getSnapshot().dayNotes.length, 1);
  assert.match(service.getSnapshot().warning!, /旧数据/);
  assert.equal(
    JSON.parse(await service.exportData()).originals[
      'life-preview.plugin.notes.v1'
    ],
    storage.getItem('life-preview.plugin.notes.v1'),
  );
  await service.createNote('新内容');
  assert.equal(service.getSnapshot().notes.length, 2);
  service.close();
});

test('simultaneous tabs cannot exceed three priorities; rejected create rolls back its task', async () => {
  const { create } = setup();
  const a = create(),
    b = create('tab-b');
  await Promise.all([a.initialize(), b.initialize()]);
  const tasks = await Promise.all(
    ['a', 'b', 'c', 'd'].map((title) => a.createTask(input(title))),
  );
  const results = await Promise.allSettled(
    tasks.map((task, index) =>
      (index % 2 ? b : a).setFocus('2026-10-15', task.id),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    3,
  );
  assert.equal(
    results.filter(
      (result) =>
        result.status === 'rejected' &&
        result.reason instanceof DataError &&
        result.reason.code === 'full',
    ).length,
    1,
  );
  await assert.rejects(
    a.createTask(
      { ...input('不应留下'), id: 'rollback' },
      { focusDay: '2026-10-15' },
    ),
    /三件/,
  );
  assert.ok(!a.getSnapshot().tasks.some((task) => task.id === 'rollback'));
  const c = create('tab-c');
  await c.initialize();
  assert.equal(c.getSnapshot().focus['2026-10-15'].length, 3);
  a.close();
  b.close();
  c.close();
});

test('task title and completion share one record, focus removal and restore never delete or auto-pin', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  const task = await service.createTask(input('原标题'), {
    focusDay: '2026-10-15',
  });
  await service.updateTask(task.id, { title: '新标题' }, task.revision);
  await service.toggleTask(task.id, true);
  assert.equal(service.getSnapshot().tasks[0].title, '新标题');
  assert.equal(service.getSnapshot().tasks[0].completed, true);
  assert.deepEqual(service.getSnapshot().focus['2026-10-15'], [task.id]);
  await service.removeFocus('2026-10-15', task.id);
  assert.equal(service.getSnapshot().tasks.length, 1);
  await service.setFocus('2026-10-15', task.id);
  await service.deleteTask(task.id);
  assert.deepEqual(service.getSnapshot().focus['2026-10-15'], []);
  await service.restoreTask(task.id);
  assert.equal(service.getSnapshot().tasks[0].deletedAt, undefined);
  assert.deepEqual(service.getSnapshot().focus['2026-10-15'], []);
  service.close();
});

test('explicit carry moves date and preserves history; ordinary reschedule removes current focus', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  const task = await service.createTask(input('旧重点', '2026-10-14'), {
    focusDay: '2026-10-14',
  });
  await assert.rejects(service.setFocus('2026-10-15', task.id), /确认/);
  assert.equal(service.getSnapshot().tasks[0].date, '2026-10-14');
  await service.setFocus('2026-10-15', task.id, { moveToDay: true });
  assert.deepEqual(service.getSnapshot().focus['2026-10-14'], [task.id]);
  assert.equal(service.getSnapshot().tasks[0].date, '2026-10-15');
  await service.updateTask(task.id, { date: '2026-10-16' });
  assert.deepEqual(service.getSnapshot().focus['2026-10-15'], []);
  service.close();
});

test('cross-tab record conflicts preserve draft; independent mutations do not overwrite each other', async () => {
  const { create } = setup();
  const a = create(),
    b = create('tab-b');
  await Promise.all([a.initialize(), b.initialize()]);
  const note = await a.createNote('原文');
  await b.saveDraft(`notes:edit:${note.id}`, '另一个修改', note.revision);
  await a.updateNote(note.id, '先保存的修改', 1);
  await assert.rejects(
    b.updateNote(note.id, '另一个修改', 1, `notes:edit:${note.id}`),
    /已在其他位置修改/,
  );
  assert.equal(
    b
      .getSnapshot()
      .drafts.find((draft) => draft.key === `notes:edit:${note.id}`)?.text,
    '另一个修改',
  );
  const first = await a.createTask(input('第一件'));
  const second = await b.createTask(input('第二件'));
  await Promise.all([
    a.toggleTask(first.id, true),
    b.updateTask(second.id, { title: '第二件修改' }),
  ]);
  const c = create('tab-c');
  await c.initialize();
  assert.equal(
    c.getSnapshot().tasks.find((task) => task.id === first.id)?.completed,
    true,
  );
  assert.equal(
    c.getSnapshot().tasks.find((task) => task.id === second.id)?.title,
    '第二件修改',
  );
  a.close();
  b.close();
  c.close();
});

test('a consumed note draft creates only once and tab-specific drafts survive independently', async () => {
  const { create } = setup();
  const a = create(),
    b = create('tab-b');
  await Promise.all([a.initialize(), b.initialize()]);
  await a.saveDraft('notes:new', 'A的草稿');
  await b.saveDraft('notes:new', 'B的草稿');
  const results = await Promise.allSettled([
    a.createNote('A的草稿', 'notes:new'),
    a.createNote('A的草稿', 'notes:new'),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const b2 = create('tab-b');
  await b2.initialize();
  assert.equal(
    b2.getSnapshot().drafts.find((draft) => draft.key === 'notes:new')?.text,
    'B的草稿',
  );
  assert.ok(!a.getSnapshot().drafts.some((draft) => draft.key === 'notes:new'));
  a.close();
  b.close();
  b2.close();
});

test('unavailable database never reports success and exports the in-memory draft', async () => {
  class BrokenFactory extends IDBFactory {
    override open(): IDBOpenDBRequest {
      throw new Error('blocked');
    }
  }
  const service = new LocalTaskService({
    factory: new BrokenFactory(),
    storage: new MemoryStorage(),
    broadcast: false,
  });
  await service.initialize();
  assert.match(service.getSnapshot().warning!, /暂不可用/);
  await assert.rejects(
    service.saveDraft('notes:new', '不能丢的文字'),
    /保存暂不可用/,
  );
  await assert.rejects(service.createNote('不能丢的文字'), /保存暂不可用/);
  assert.match(await service.exportData(), /不能丢的文字/);
  assert.equal(service.getSnapshot().notes.length, 0);
  service.close();
});

test('dated items sort unfinished timed, unfinished all-day, then completed', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  const allDay = await service.createTask(input('全天'));
  const late = await service.createTask({ ...input('下午'), time: '15:00' });
  const early = await service.createTask({ ...input('早上'), time: '08:00' });
  const done = await service.createTask({ ...input('已完成'), time: '06:00' });
  await service.toggleTask(done.id, true);
  assert.deepEqual(
    sortTasks(service.getSnapshot().tasks).map((task) => task.id),
    [early.id, late.id, allDay.id, done.id],
  );
  service.close();
});

test('changed retry payload never silently discards a draft under an existing task ID', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  await service.createTask({ ...input('已提交'), id: 'retry-id' });
  await service.saveDraft('task:new:retry', '修改后的草稿');
  await assert.rejects(
    service.createTask(
      { ...input('重试时的新修改'), id: 'retry-id' },
      { draftKey: 'task:new:retry' },
    ),
    /当前新修改/,
  );
  assert.equal(service.getSnapshot().tasks[0].title, '已提交');
  assert.equal(
    service.getSnapshot().drafts.find((draft) => draft.key === 'task:new:retry')
      ?.text,
    '修改后的草稿',
  );
  service.close();
});

test('focus date confirmation is checked against the latest committed task', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  const task = await service.createTask(input('未来安排', '2026-10-20'));
  await service.updateTask(task.id, { date: '2026-10-21' });
  await assert.rejects(
    service.setFocus('2026-10-15', task.id, {
      moveToDay: true,
      expectedDate: '2026-10-20',
    }),
    /重新确认/,
  );
  assert.equal(service.getSnapshot().tasks[0].date, '2026-10-21');
  assert.equal(service.getSnapshot().focus['2026-10-15'], undefined);
  service.close();
});

test('losing database access still allows exporting readable content and a failed draft', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  await service.createNote('之前保存的内容');
  service.close();
  await assert.rejects(
    service.saveDraft('notes:new', '后来未存的内容'),
    /保存暂不可用/,
  );
  const backup = await service.exportData();
  assert.match(backup, /之前保存的内容/);
  assert.match(backup, /后来未存的内容/);
});

test('clearing then immediately rewriting a draft preserves the newer snapshot and durable text', async () => {
  const { create } = setup();
  const service = create();
  await service.initialize();
  await service.saveDraft('notes:new', 'old');
  await Promise.all([
    service.clearDraft('notes:new'),
    service.saveDraft('notes:new', 'new text'),
  ]);
  assert.equal(
    service.getSnapshot().drafts.find((draft) => draft.key === 'notes:new')
      ?.text,
    'new text',
  );
  const reopened = create();
  await reopened.initialize();
  assert.equal(
    reopened.getSnapshot().drafts.find((draft) => draft.key === 'notes:new')
      ?.text,
    'new text',
  );
  service.close();
  reopened.close();
});
