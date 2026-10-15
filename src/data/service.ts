import { validDateKey } from '../platform/dates';
import { readLegacyBatches } from './migration';
import {
  DataError,
  type DataSnapshot,
  type NoteRecord,
  type TaskRecord,
  type TaskInput,
  type TaskPatch,
  type CreateTaskOptions,
  type FocusOptions,
  type TaskService,
  type DraftRecord,
  type DayNoteRecord,
} from './types';

const stores = ['notes', 'tasks', 'dayFocus', 'dayNotes', 'drafts', 'meta'];
type FocusRow = { day: string; ids: string[] };
type MetaRow = { key: string; warning?: string; status?: string };
const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const now = () => new Date().toISOString();
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
function finished(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(
        tx.error ??
          new DataError('storage', '本次修改尚未保存，输入仍然保留。'),
      );
  });
}
function validateTask(
  input: TaskInput | (TaskPatch & { date: string; title: string }),
) {
  if (
    !input.title.trim() ||
    !validDateKey(input.date) ||
    (input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))
  )
    throw new DataError('invalid', '请填写事项，并选择有效的日期和时间。');
}
export function sortTasks(tasks: TaskRecord[]) {
  return [...tasks].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      a.date.localeCompare(b.date) ||
      (a.time || '99:99').localeCompare(b.time || '99:99') ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
export type ServiceOptions = {
  name?: string;
  factory?: IDBFactory;
  storage?: Pick<Storage, 'getItem'>;
  scope?: string;
  broadcast?: boolean;
};
export class LocalTaskService implements TaskService {
  private db?: IDBDatabase;
  private loading?: Promise<void>;
  private listeners = new Set<() => void>();
  private channel?: BroadcastChannel;
  private volatile = new Map<string, DraftRecord>();
  private draftVersions = new Map<string, number>();
  private snapshot: DataSnapshot = {
    notes: [],
    tasks: [],
    focus: {},
    dayNotes: [],
    drafts: [],
    ready: false,
    warning: null,
  };
  private scope: string;
  private migrationWarning: string | null = null;
  private releaseScope?: () => void;
  constructor(private options: ServiceOptions = {}) {
    this.scope = options.scope ?? uid();
    if (!options.scope && typeof window !== 'undefined') {
      try {
        this.scope =
          sessionStorage.getItem('life-preview.draft-session') || this.scope;
        sessionStorage.setItem('life-preview.draft-session', this.scope);
      } catch {
        /* In-memory drafts remain available. */
      }
    }
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<DataSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private draftKey(key: string) {
    return `${key}::${this.scope}`;
  }
  private async dropDraft(tx: IDBTransaction, key?: string) {
    if (!key) return;
    tx.objectStore('drafts').delete(this.draftKey(key));
    tx.objectStore('drafts').delete(key);
  }
  initialize = () => {
    if (this.loading) return this.loading;
    this.loading = this.start().catch(() => {
      this.publish({
        ready: true,
        warning:
          '浏览器本地数据库暂不可用。输入保留在当前页面，请复制或导出后再刷新。',
      });
    });
    return this.loading;
  };
  private async start() {
    // A duplicated browser tab inherits sessionStorage. Lease the draft scope so
    // its unfinished text cannot overwrite the source tab's draft on refresh.
    await this.claimScope();
    const factory = this.options.factory ?? globalThis.indexedDB;
    if (!factory) throw new Error('IndexedDB unavailable');
    const opening = factory.open(this.options.name ?? 'life-preview-data', 1);
    opening.onupgradeneeded = () => {
      for (const name of stores)
        opening.result.createObjectStore(name, {
          keyPath:
            name === 'dayFocus'
              ? 'day'
              : name === 'dayNotes'
                ? 'date'
                : name === 'drafts' || name === 'meta'
                  ? 'key'
                  : 'id',
        });
    };
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
      opening.onblocked = () => reject(new Error('database blocked'));
    });
    this.db.onversionchange = () => {
      this.db?.close();
      this.db = undefined;
      this.publish({ warning: '数据版本已更新，请导出当前草稿后刷新页面。' });
    };
    let legacyStorage = this.options.storage;
    try {
      legacyStorage ??= globalThis.localStorage;
    } catch {
      /* Missing source is reported below. */
    }
    const batches = readLegacyBatches(
      legacyStorage ?? {
        getItem() {
          throw new Error('localStorage unavailable');
        },
      },
    );
    for (const batch of batches) {
      await this.transaction(async (tx) => {
        const meta = tx.objectStore('meta');
        if (await request(meta.get(`migration:${batch.id}`))) return;
        for (const note of batch.notes)
          if (!(await request(tx.objectStore('notes').get(note.id))))
            tx.objectStore('notes').put(note);
        for (const task of batch.tasks)
          if (!(await request(tx.objectStore('tasks').get(task.id))))
            tx.objectStore('tasks').put(task);
        for (const note of batch.dayNotes)
          if (!(await request(tx.objectStore('dayNotes').get(note.date))))
            tx.objectStore('dayNotes').put(note);
        for (const draft of batch.drafts)
          if (!(await request(tx.objectStore('drafts').get(draft.key))))
            tx.objectStore('drafts').put(draft);
        for (const focus of batch.focus)
          if (!(await request(tx.objectStore('dayFocus').get(focus.day))))
            tx.objectStore('dayFocus').put(focus);
        meta.put({
          key: `migration:${batch.id}`,
          status: batch.status,
          warning: batch.warning,
        });
      });
    }
    if (this.options.broadcast !== false && typeof window !== 'undefined') {
      if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel('life-preview-data');
        this.channel.onmessage = () => {
          void this.refresh();
        };
      } else window.addEventListener('storage', this.onStorage);
      window.addEventListener('focus', this.onFocus);
    }
    await this.refresh();
  }
  private async claimScope(): Promise<void> {
    if (
      this.options.scope ||
      typeof navigator === 'undefined' ||
      !navigator.locks
    )
      return;
    await new Promise<void>((resolve) => {
      void navigator.locks
        .request(
          `life-preview-draft:${this.scope}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) {
              this.scope = uid();
              try {
                sessionStorage.setItem(
                  'life-preview.draft-session',
                  this.scope,
                );
              } catch {
                /* The new scope still protects this tab. */
              }
              await this.claimScope();
              resolve();
              return;
            }
            resolve();
            await new Promise<void>((release) => {
              this.releaseScope = release;
            });
          },
        )
        .catch(() => resolve());
    });
  }
  private onStorage = (e: StorageEvent) => {
    if (e.key === 'life-preview.data-pulse') void this.refresh();
  };
  private onFocus = () => {
    void this.refresh();
  };
  private async transaction<T>(
    work: (tx: IDBTransaction) => Promise<T>,
    mode: IDBTransactionMode = 'readwrite',
  ): Promise<T> {
    if (!this.db)
      throw new DataError(
        'storage',
        '本地保存暂不可用，输入仍保留。请复制或导出后再刷新。',
      );
    const tx = this.db.transaction(stores, mode);
    const done = finished(tx);
    try {
      const value = await work(tx);
      await done;
      return value;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already aborted. */
      }
      await done.catch(() => undefined);
      throw error;
    }
  }
  private async refresh() {
    if (!this.db) return;
    const result = await this.transaction(async (tx) => {
      const [notes, tasks, focus, dayNotes, drafts, meta] = await Promise.all([
        request<NoteRecord[]>(tx.objectStore('notes').getAll()),
        request<TaskRecord[]>(tx.objectStore('tasks').getAll()),
        request<FocusRow[]>(tx.objectStore('dayFocus').getAll()),
        request<DayNoteRecord[]>(tx.objectStore('dayNotes').getAll()),
        request<DraftRecord[]>(tx.objectStore('drafts').getAll()),
        request<MetaRow[]>(tx.objectStore('meta').getAll()),
      ]);
      return {
        notes,
        tasks,
        focus: Object.fromEntries(focus.map((row) => [row.day, row.ids])),
        dayNotes,
        drafts,
        meta,
      };
    }, 'readonly');
    this.migrationWarning =
      result.meta
        .map((row) => row.warning)
        .filter(Boolean)
        .join(' ') || null;
    const drafts = new Map<string, DraftRecord>();
    for (const draft of [...result.drafts, ...this.volatile.values()]) {
      if (!draft.key.includes('::')) {
        if (!drafts.has(draft.key)) drafts.set(draft.key, draft);
      } else if (draft.key.endsWith(`::${this.scope}`)) {
        const key = draft.key.slice(0, -this.scope.length - 2);
        drafts.set(key, { ...draft, key });
      }
    }
    this.publish({
      notes: result.notes.sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
      tasks: result.tasks,
      focus: result.focus,
      dayNotes: result.dayNotes,
      drafts: [...drafts.values()],
      ready: true,
      warning: this.migrationWarning,
    });
  }
  private async mutate<T>(
    work: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    await this.initialize();
    try {
      const result = await this.transaction(work);
      // The transaction has committed. A read/notification failure must never
      // turn a successful save into a retry that could create a second record.
      try {
        await this.refresh();
      } catch {
        this.publish({
          warning: '内容已保存，暂时无法刷新显示，请稍后重新打开。',
        });
      }
      try {
        this.channel?.postMessage('changed');
      } catch {
        /* Data is already committed. */
      }
      if (!this.channel && typeof window !== 'undefined')
        try {
          localStorage.setItem('life-preview.data-pulse', uid());
        } catch {
          /* Broadcast fallback is optional. */
        }
      return result;
    } catch (error) {
      if (error instanceof DataError) throw error;
      this.publish({
        warning: '本次修改尚未保存，输入仍保留。可复制或导出后重试。',
      });
      throw new DataError(
        'storage',
        '本次修改尚未保存，输入仍保留。可复制或导出后重试。',
      );
    }
  }
  private async task(tx: IDBTransaction, id: string) {
    const task = await request<TaskRecord | undefined>(
      tx.objectStore('tasks').get(id),
    );
    if (!task || task.deletedAt)
      throw new DataError(
        'conflict',
        '这件事项已被删除，请保留输入并查看最新内容。',
      );
    return task;
  }
  private async unpin(tx: IDBTransaction, id: string, fromDay?: string) {
    for (const row of await request<FocusRow[]>(
      tx.objectStore('dayFocus').getAll(),
    ))
      if ((!fromDay || row.day === fromDay) && row.ids.includes(id))
        tx.objectStore('dayFocus').put({
          ...row,
          ids: row.ids.filter((item) => item !== id),
        });
  }
  private async pin(
    tx: IDBTransaction,
    day: string,
    task: TaskRecord,
    options: FocusOptions = {},
  ) {
    if (!validDateKey(day)) throw new DataError('invalid', '日期无效。');
    if (
      options.expectedDate !== undefined &&
      task.date !== options.expectedDate
    )
      throw new DataError(
        'conflict',
        '事项日期已在其他位置修改，请重新确认后加入重点。',
      );
    const row: FocusRow = (await request(
      tx.objectStore('dayFocus').get(day),
    )) ?? { day, ids: [] };
    if (task.date !== day && !options.moveToDay)
      throw new DataError('date', '加入重点会将事项日期改为今天，请先确认。');
    if (row.ids.includes(task.id)) return;
    let ids = [...row.ids];
    if (options.replaceId) {
      if (!ids.includes(options.replaceId))
        throw new DataError('conflict', '重点列表已变化，请重新选择替换项。');
      ids = ids.map((id) => (id === options.replaceId ? task.id : id));
    } else {
      if (ids.length >= 3)
        throw new DataError('full', '今天已有三件重点，请选择替换其中一件。');
      ids.push(task.id);
    }
    if (task.date !== day)
      tx.objectStore('tasks').put({
        ...task,
        date: day,
        updatedAt: now(),
        revision: task.revision + 1,
      });
    tx.objectStore('dayFocus').put({ day, ids });
  }
  createNote = (text: string, draftKey?: string) =>
    this.mutate(async (tx) => {
      if (!text.trim()) throw new DataError('invalid', '先写下一点想法。');
      if (draftKey) {
        const draft: DraftRecord | undefined =
          (await request(
            tx.objectStore('drafts').get(this.draftKey(draftKey)),
          )) ?? (await request(tx.objectStore('drafts').get(draftKey)));
        if (!draft || draft.text.trim() !== text.trim())
          throw new DataError(
            'conflict',
            '草稿已在其他位置变更或收好，请确认当前内容后再保存。',
          );
      }
      const timestamp = now();
      const note: NoteRecord = {
        id: uid(),
        text: text.trim(),
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
      };
      tx.objectStore('notes').add(note);
      await this.dropDraft(tx, draftKey);
      return note;
    });
  updateNote = (
    id: string,
    text: string,
    expectedRevision: number,
    draftKey?: string,
  ) =>
    this.mutate(async (tx) => {
      const old: NoteRecord | undefined = await request(
        tx.objectStore('notes').get(id),
      );
      if (!old || old.deletedAt || old.revision !== expectedRevision)
        throw new DataError(
          'conflict',
          '这段记录已在其他位置修改，当前草稿已保留。',
        );
      if (!text.trim())
        throw new DataError('invalid', '内容不能留空，可以使用删除。');
      const note = {
        ...old,
        text: text.trim(),
        updatedAt: now(),
        revision: old.revision + 1,
      };
      tx.objectStore('notes').put(note);
      await this.dropDraft(tx, draftKey);
      return note;
    });
  deleteNote = (id: string) =>
    this.mutate(async (tx) => {
      const note: NoteRecord | undefined = await request(
        tx.objectStore('notes').get(id),
      );
      if (note)
        tx.objectStore('notes').put({
          ...note,
          deletedAt: now(),
          revision: note.revision + 1,
        });
    });
  restoreNote = (id: string) =>
    this.mutate(async (tx) => {
      const note: NoteRecord | undefined = await request(
        tx.objectStore('notes').get(id),
      );
      if (note)
        tx.objectStore('notes').put({
          ...note,
          deletedAt: undefined,
          revision: note.revision + 1,
        });
    });
  createTask = (input: TaskInput, options: CreateTaskOptions = {}) =>
    this.mutate(async (tx) => {
      validateTask(input);
      const id = input.id || uid();
      const existing: TaskRecord | undefined = await request(
        tx.objectStore('tasks').get(id),
      );
      if (existing) {
        if (
          existing.deletedAt ||
          existing.title !== input.title.trim() ||
          existing.date !== (options.focusDay ?? input.date) ||
          (existing.time || '') !== (input.time || '') ||
          (existing.details || '') !== (input.details || '')
        )
          throw new DataError(
            'conflict',
            '这份事项已经保存过，当前新修改仍作为草稿保留。可以保存为副本。',
          );
        await this.dropDraft(tx, options.draftKey);
        return existing;
      }
      const timestamp = now();
      const task: TaskRecord = {
        ...input,
        id,
        title: input.title.trim(),
        completed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
      };
      tx.objectStore('tasks').add(task);
      if (options.focusDay)
        await this.pin(tx, options.focusDay, task, {
          replaceId: options.replaceId,
          moveToDay: true,
        });
      await this.dropDraft(tx, options.draftKey);
      return task;
    });
  updateTask = (
    id: string,
    patch: TaskPatch,
    expectedRevision?: number,
    draftKey?: string,
  ) =>
    this.mutate(async (tx) => {
      const old = await this.task(tx, id);
      if (expectedRevision !== undefined && expectedRevision !== old.revision)
        throw new DataError(
          'conflict',
          '事项已在其他位置修改，当前草稿已保留。',
        );
      const task = {
        ...old,
        ...patch,
        updatedAt: now(),
        revision: old.revision + 1,
      };
      validateTask(task);
      if (task.date !== old.date) await this.unpin(tx, id, old.date);
      tx.objectStore('tasks').put(task);
      await this.dropDraft(tx, draftKey);
      return task;
    });
  toggleTask = (id: string, completed: boolean) =>
    this.mutate(async (tx) => {
      const task = await this.task(tx, id);
      tx.objectStore('tasks').put({
        ...task,
        completed,
        updatedAt: now(),
        revision: task.revision + 1,
      });
    });
  deleteTask = (id: string) =>
    this.mutate(async (tx) => {
      const task = await this.task(tx, id);
      tx.objectStore('tasks').put({
        ...task,
        deletedAt: now(),
        revision: task.revision + 1,
      });
      await this.unpin(tx, id);
    });
  restoreTask = (id: string) =>
    this.mutate(async (tx) => {
      const task: TaskRecord | undefined = await request(
        tx.objectStore('tasks').get(id),
      );
      if (task)
        tx.objectStore('tasks').put({
          ...task,
          deletedAt: undefined,
          updatedAt: now(),
          revision: task.revision + 1,
        });
    });
  setFocus = (day: string, taskId: string, options?: FocusOptions) =>
    this.mutate(async (tx) => {
      await this.pin(tx, day, await this.task(tx, taskId), options);
    });
  removeFocus = (day: string, taskId: string) =>
    this.mutate(async (tx) => {
      await this.unpin(tx, taskId, day);
    });
  reorderFocus = (day: string, ids: string[]) =>
    this.mutate(async (tx) => {
      const old: FocusRow = (await request(
        tx.objectStore('dayFocus').get(day),
      )) ?? { day, ids: [] };
      if (
        ids.length !== old.ids.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !old.ids.includes(id))
      )
        throw new DataError('conflict', '重点列表已变化，请重新排序。');
      tx.objectStore('dayFocus').put({ day, ids });
    });
  saveDayNote = (
    date: string,
    text: string,
    expectedRevision?: number,
    draftKey?: string,
  ) =>
    this.mutate(async (tx) => {
      if (!validDateKey(date)) throw new DataError('invalid', '日期无效。');
      const old: DayNoteRecord | undefined = await request(
        tx.objectStore('dayNotes').get(date),
      );
      if (
        expectedRevision !== undefined &&
        (old?.revision ?? 0) !== expectedRevision
      )
        throw new DataError(
          'conflict',
          '当天备注已在其他位置修改，当前草稿已保留。',
        );
      tx.objectStore('dayNotes').put({
        date,
        text,
        revision: (old?.revision ?? 0) + 1,
      });
      await this.dropDraft(tx, draftKey);
    });
  saveDraft = async (key: string, text: string, baseRevision?: number) => {
    if (!text) return this.clearDraft(key);
    this.draftVersions.set(key, (this.draftVersions.get(key) ?? 0) + 1);
    const draft = {
      key: this.draftKey(key),
      text,
      baseRevision,
      updatedAt: now(),
    };
    this.volatile.set(draft.key, draft);
    // Keep a recoverable copy available to export even when the database is blocked.
    this.publish({
      drafts: [
        ...this.snapshot.drafts.filter((item) => item.key !== key),
        { ...draft, key },
      ],
    });
    await this.initialize();
    try {
      await this.transaction(async (tx) => {
        tx.objectStore('drafts').put(draft);
        tx.objectStore('drafts').delete(key);
      });
      if (this.volatile.get(draft.key) === draft) {
        this.volatile.delete(draft.key);
        this.publish({ warning: this.migrationWarning });
      }
    } catch (error) {
      this.publish({
        warning: '有草稿尚未保存，输入保留在当前页面，可复制或导出。',
      });
      throw error instanceof DataError
        ? error
        : new DataError('storage', '草稿尚未保存，请保留页面或导出后再刷新。');
    }
  };
  clearDraft = async (key: string) => {
    const version = (this.draftVersions.get(key) ?? 0) + 1;
    this.draftVersions.set(key, version);
    await this.initialize();
    await this.transaction(async (tx) => {
      await this.dropDraft(tx, key);
    });
    if (this.draftVersions.get(key) !== version) return;
    this.volatile.delete(this.draftKey(key));
    this.publish({
      drafts: this.snapshot.drafts.filter((draft) => draft.key !== key),
    });
  };
  exportData = async () => {
    await this.initialize();
    let data: Record<string, unknown> = { ...this.snapshot };
    if (this.db)
      try {
        data = await this.transaction(
          async (tx) =>
            Object.fromEntries(
              await Promise.all(
                stores.map(async (name) => [
                  name,
                  await request(tx.objectStore(name).getAll()),
                ]),
              ),
            ),
          'readonly',
        );
      } catch {
        /* The last readable snapshot and volatile drafts remain exportable. */
      }
    const originals: Record<string, string> = {};
    try {
      const storage = this.options.storage ?? globalThis.localStorage;
      for (const key of [
        'life-preview.plugin.notes.v1',
        'life-preview.plugin.calendar.v1',
        'life-preview.plugin.today.v1',
        'life-preview.content.v1',
        'life-preview.calendar.v1',
      ]) {
        const raw = storage.getItem(key);
        if (raw !== null) originals[key] = raw;
      }
    } catch {
      /* Export current contents even if legacy storage is inaccessible. */
    }
    return JSON.stringify(
      {
        format: 'life-preview-plugins',
        version: 2,
        exportedAt: now(),
        data,
        unsavedDrafts: [...this.volatile.values()],
        originals,
      },
      null,
      2,
    );
  };
  close() {
    this.channel?.close();
    this.db?.close();
    this.db = undefined;
    this.releaseScope?.();
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.onStorage);
      window.removeEventListener('focus', this.onFocus);
    }
  }
}
