import { validDateKey } from '../platform/dates';
import {
  DataError,
  type NoteRecord,
  type TaskRecord,
  type DayNoteRecord,
} from './types';
import type {
  EntityKind,
  EntityData,
  CloudEntity,
  CloudChange,
  PendingOperation,
  LocalSyncState,
  PullResult,
  ApplyResult,
  SyncConflict,
} from './sync-types';

export const syncStores = ['outbox', 'syncEntities', 'syncConflicts'];
type SyncMeta = {
  key: 'sync:state';
  owner: string | null;
  cursor: number;
  lastSyncedAt: string | null;
  sequence: number;
  imported?: boolean;
};
type Shadow = { key: string; entity: CloudEntity };
type StoredOperation = PendingOperation & { sequence: number };
type StoredConflict = SyncConflict & { sequence: number };
type EntityMap = Map<string, CloudChange>;
const kinds: EntityKind[] = ['notes', 'tasks', 'dayNotes', 'focus'];
const keyOf = (kind: EntityKind, id: string) => `${kind}:${id}`;
const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const timestamp = () => new Date().toISOString();
const request = <T>(value: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
const storeOf = (kind: EntityKind) => (kind === 'focus' ? 'dayFocus' : kind);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, field]) => key !== 'updatedAt' && field !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, field]) => [key, comparable(field)]),
    );
  return value;
}
export const sameEntityData = (a: EntityData | null, b: EntityData | null) =>
  JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
async function meta(tx: IDBTransaction): Promise<SyncMeta> {
  return (
    (await request<SyncMeta | undefined>(
      tx.objectStore('meta').get('sync:state'),
    )) ?? {
      key: 'sync:state',
      owner: null,
      cursor: 0,
      lastSyncedAt: null,
      sequence: 0,
    }
  );
}
function cleanOperation(value: StoredOperation): PendingOperation {
  const { sequence: _sequence, ...operation } = value;
  return operation;
}
function cleanConflict(value: StoredConflict): SyncConflict {
  const { sequence: _sequence, ...conflict } = value;
  return conflict;
}
async function orderedOutbox(tx: IDBTransaction) {
  return (
    await request<StoredOperation[]>(tx.objectStore('outbox').getAll())
  ).sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}
export async function pendingSyncOperations(tx: IDBTransaction) {
  return (await orderedOutbox(tx)).map(cleanOperation);
}
export async function localSyncState(
  tx: IDBTransaction,
): Promise<LocalSyncState> {
  const current = await meta(tx);
  return {
    owner: current.owner,
    cursor: current.cursor,
    lastSyncedAt: current.lastSyncedAt,
    pending: await request(tx.objectStore('outbox').count()),
    conflicts: (
      await request<StoredConflict[]>(tx.objectStore('syncConflicts').getAll())
    )
      .sort((a, b) => a.sequence - b.sequence)
      .map(cleanConflict),
  };
}

function serialize(
  kind: EntityKind,
  row: Record<string, unknown>,
): CloudChange {
  const id = String(
    kind === 'focus' ? row.day : kind === 'dayNotes' ? row.date : row.id,
  );
  let data: EntityData;
  if (kind === 'focus') data = { ids: row.ids };
  else if (kind === 'dayNotes') data = { text: row.text };
  else
    data = Object.fromEntries(
      Object.entries(row).filter(
        ([key, value]) =>
          key !== 'id' && key !== 'revision' && value !== undefined,
      ),
    );
  return { kind, id, base: null, next: clone(data) };
}
async function entities(tx: IDBTransaction): Promise<EntityMap> {
  const result: EntityMap = new Map();
  for (const kind of kinds)
    for (const row of await request<Record<string, unknown>[]>(
      tx.objectStore(storeOf(kind)).getAll(),
    )) {
      const entity = serialize(kind, row);
      result.set(keyOf(kind, entity.id), entity);
    }
  return result;
}
export async function captureSyncEntities(
  tx: IDBTransaction,
): Promise<EntityMap | null> {
  return (await meta(tx)).owner ? entities(tx) : null;
}
function diff(before: EntityMap, after: EntityMap): CloudChange[] {
  const changes: CloudChange[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(key),
      next = after.get(key);
    if (sameEntityData(old?.next ?? null, next?.next ?? null)) continue;
    const identity = next ?? old!;
    changes.push({
      kind: identity.kind,
      id: identity.id,
      base: old?.next ?? null,
      next: next?.next ?? null,
    });
  }
  return changes;
}
async function createOperation(
  tx: IDBTransaction,
  changes: CloudChange[],
): Promise<StoredOperation> {
  const current = await meta(tx);
  if (!current.owner) throw new DataError('storage', '请先绑定同步账号。');
  current.sequence += 1;
  tx.objectStore('meta').put(current);
  return {
    id: uid(),
    owner: current.owner,
    changes,
    createdAt: timestamp(),
    sequence: current.sequence,
  };
}
function operationKeys(operation: PendingOperation) {
  return operation.changes.map((change) => keyOf(change.kind, change.id));
}
function shares(operation: PendingOperation, keys: Set<string>) {
  return operationKeys(operation).some((key) => keys.has(key));
}
function combine(operations: StoredOperation[]): CloudChange[] {
  const combined = new Map<string, CloudChange>();
  for (const operation of operations.sort((a, b) => a.sequence - b.sequence))
    for (const change of operation.changes) {
      const key = keyOf(change.kind, change.id),
        old = combined.get(key);
      combined.set(key, old ? { ...change, base: old.base } : clone(change));
    }
  return [...combined.values()];
}
async function latestShadows(tx: IDBTransaction, changes: CloudChange[]) {
  return Promise.all(
    changes.map(
      async (change) =>
        (
          await request<Shadow | undefined>(
            tx.objectStore('syncEntities').get(keyOf(change.kind, change.id)),
          )
        )?.entity ?? {
          kind: change.kind,
          id: change.id,
          version: 0,
          data: null,
        },
    ),
  );
}
/** One conflict owns its complete dependency component, including later edits. */
async function quarantine(
  tx: IDBTransaction,
  initial: StoredOperation[],
  message: string,
  initialConflicts: StoredConflict[] = [],
) {
  const selected = new Map(
    initial.map((operation) => [operation.id, operation]),
  );
  const conflicts = new Map(
    initialConflicts.map((conflict) => [conflict.id, conflict]),
  );
  const pending = await orderedOutbox(tx);
  const allConflicts = await request<StoredConflict[]>(
    tx.objectStore('syncConflicts').getAll(),
  );
  const keys = new Set(initial.flatMap(operationKeys));
  for (const conflict of initialConflicts)
    for (const key of operationKeys(conflict.operation)) keys.add(key);
  let changed = true;
  while (changed) {
    changed = false;
    for (const operation of pending)
      if (!selected.has(operation.id) && shares(operation, keys)) {
        selected.set(operation.id, operation);
        for (const key of operationKeys(operation)) keys.add(key);
        changed = true;
      }
    for (const conflict of allConflicts)
      if (!conflicts.has(conflict.id) && shares(conflict.operation, keys)) {
        conflicts.set(conflict.id, conflict);
        for (const key of operationKeys(conflict.operation)) keys.add(key);
        changed = true;
      }
  }
  const operations = [
    ...selected.values(),
    ...[...conflicts.values()].map((conflict) => ({
      ...conflict.operation,
      sequence: conflict.sequence,
    })),
  ].sort((a, b) => a.sequence - b.sequence);
  const first = operations[0];
  if (!first) return;
  const changes = combine(operations);
  for (const operation of selected.values())
    tx.objectStore('outbox').delete(operation.id);
  for (const conflict of conflicts.values())
    tx.objectStore('syncConflicts').delete(conflict.id);
  const conflict: StoredConflict = {
    id: first.id,
    sequence: first.sequence,
    operation: { ...cleanOperation(first), changes },
    remote: await latestShadows(tx, changes),
    message,
  };
  tx.objectStore('syncConflicts').put(conflict);
}
async function enqueue(tx: IDBTransaction, operation: StoredOperation) {
  const conflicts = (
    await request<StoredConflict[]>(tx.objectStore('syncConflicts').getAll())
  ).filter((conflict) =>
    shares(operation, new Set(operationKeys(conflict.operation))),
  );
  if (conflicts.length)
    await quarantine(
      tx,
      [operation],
      '这些修改关联到尚未处理的同步冲突，已一起保留。',
      conflicts,
    );
  else tx.objectStore('outbox').add(operation);
}
export async function queueSyncDiff(tx: IDBTransaction, before: EntityMap) {
  const changes = diff(before, await entities(tx));
  if (changes.length) await enqueue(tx, await createOperation(tx, changes));
}
export async function bindSyncAccount(tx: IDBTransaction, owner: string) {
  if (!owner.trim()) throw new DataError('invalid', '同步账号无效。');
  const current = await meta(tx);
  if (current.owner && current.owner !== owner)
    throw new DataError(
      'conflict',
      '这台设备的数据已绑定其他账号，请先导出，不能混入新账号。',
    );
  if (current.owner === owner && current.imported) return;
  tx.objectStore('meta').put({ ...current, owner, imported: true });
  const initial = [...(await entities(tx)).values()];
  for (let offset = 0; offset < initial.length; offset += 100)
    await enqueue(
      tx,
      await createOperation(tx, initial.slice(offset, offset + 100)),
    );
}

function validEntity(entity: CloudEntity) {
  if (
    !kinds.includes(entity.kind) ||
    typeof entity.id !== 'string' ||
    !entity.id ||
    !Number.isSafeInteger(entity.version) ||
    entity.version < 0 ||
    (entity.data !== null &&
      (typeof entity.data !== 'object' || Array.isArray(entity.data)))
  )
    throw new DataError('storage', '云端记录格式不兼容，尚未覆盖本机内容。');
  if (entity.data === null) return;
  const value = entity.data;
  if (entity.kind === 'focus') {
    if (
      !validDateKey(entity.id) ||
      !Array.isArray(value.ids) ||
      value.ids.length > 3 ||
      value.ids.some((id) => typeof id !== 'string' || !id) ||
      new Set(value.ids).size !== value.ids.length
    )
      throw new DataError('storage', '云端重点格式不兼容。');
  } else if (entity.kind === 'dayNotes') {
    if (!validDateKey(entity.id) || typeof value.text !== 'string')
      throw new DataError('storage', '云端备注格式不兼容。');
  } else {
    if (
      typeof value.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.updatedAt)) ||
      (value.deletedAt !== undefined &&
        (typeof value.deletedAt !== 'string' ||
          !Number.isFinite(Date.parse(value.deletedAt))))
    )
      throw new DataError('storage', '云端记录日期不兼容。');
    if (entity.kind === 'notes' && typeof value.text !== 'string')
      throw new DataError('storage', '云端片段格式不兼容。');
    if (
      entity.kind === 'tasks' &&
      (typeof value.title !== 'string' ||
        typeof value.date !== 'string' ||
        !validDateKey(value.date) ||
        typeof value.completed !== 'boolean' ||
        (value.time !== undefined &&
          (typeof value.time !== 'string' ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time))))
    )
      throw new DataError('storage', '云端事项格式不兼容。');
  }
}
async function updateShadow(tx: IDBTransaction, incoming: CloudEntity) {
  validEntity(incoming);
  const key = keyOf(incoming.kind, incoming.id);
  const previous = await request<Shadow | undefined>(
    tx.objectStore('syncEntities').get(key),
  );
  if (previous && previous.entity.version >= incoming.version)
    return previous.entity;
  tx.objectStore('syncEntities').put({
    key,
    entity: clone(incoming),
  } satisfies Shadow);
  return incoming;
}
async function applyEntity(tx: IDBTransaction, entity: CloudEntity) {
  const store = tx.objectStore(storeOf(entity.kind));
  const old = await request<Record<string, unknown> | undefined>(
    store.get(entity.id),
  );
  if (
    sameEntityData(old ? serialize(entity.kind, old).next : null, entity.data)
  )
    return;
  if (entity.data === null) {
    store.delete(entity.id);
    return;
  }
  const data = clone(entity.data);
  if (entity.kind === 'focus') store.put({ day: entity.id, ids: data.ids });
  else if (entity.kind === 'dayNotes')
    store.put({
      date: entity.id,
      text: String(data.text),
      revision: Number(old?.revision ?? 0) + 1,
    } satisfies DayNoteRecord);
  else
    store.put({
      ...data,
      id: entity.id,
      revision: Number(old?.revision ?? 0) + 1,
    });
}
async function protectedKeys(tx: IDBTransaction) {
  const operations = await request<StoredOperation[]>(
    tx.objectStore('outbox').getAll(),
  );
  const conflicts = await request<StoredConflict[]>(
    tx.objectStore('syncConflicts').getAll(),
  );
  return new Set(
    [...operations, ...conflicts.map((conflict) => conflict.operation)].flatMap(
      operationKeys,
    ),
  );
}
async function advance(tx: IDBTransaction, cursor: number) {
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    throw new DataError('storage', '同步游标无效。');
  const current = await meta(tx);
  tx.objectStore('meta').put({
    ...current,
    cursor: Math.max(current.cursor, cursor),
    lastSyncedAt: timestamp(),
  });
}
export async function acceptSyncRemote(
  tx: IDBTransaction,
  result: PullResult,
  advanceCursor = true,
) {
  if (!(await meta(tx)).owner)
    throw new DataError('storage', '请先绑定同步账号。');
  const blocked = await protectedKeys(tx);
  for (const entity of result.entities) {
    const latest = await updateShadow(tx, entity);
    if (!blocked.has(keyOf(latest.kind, latest.id)))
      await applyEntity(tx, latest);
  }
  const changedKeys = new Set(
    result.entities.map((entity) => keyOf(entity.kind, entity.id)),
  );
  for (const conflict of await request<StoredConflict[]>(
    tx.objectStore('syncConflicts').getAll(),
  ))
    if (shares(conflict.operation, changedKeys)) {
      tx.objectStore('syncConflicts').put({
        ...conflict,
        remote: await latestShadows(tx, conflict.operation.changes),
      });
    }
  if (advanceCursor) await advance(tx, result.cursor);
  else {
    const current = await meta(tx);
    tx.objectStore('meta').put({ ...current, lastSyncedAt: timestamp() });
  }
}
export async function acknowledgeSyncOperation(
  tx: IDBTransaction,
  id: string,
  result: ApplyResult,
) {
  const operation = await request<StoredOperation | undefined>(
    tx.objectStore('outbox').get(id),
  );
  if (!operation) {
    await acceptSyncRemote(tx, result, false);
    return;
  }
  for (const entity of result.entities) await updateShadow(tx, entity);
  if (result.status === 'applied') tx.objectStore('outbox').delete(id);
  else
    await quarantine(
      tx,
      [operation],
      result.message ?? '相同内容在另一台设备有修改，两份内容都已保留。',
    );
  await acceptSyncRemote(tx, result, false);
}
export async function resolveSyncConflict(
  tx: IDBTransaction,
  id: string,
  resolution: 'remote' | 'copy',
) {
  const conflict = await request<StoredConflict | undefined>(
    tx.objectStore('syncConflicts').get(id),
  );
  if (!conflict) return;
  const before = await entities(tx);
  const shadows = await latestShadows(tx, conflict.operation.changes);
  // An atomic import may fail because of one collision. Independent new rows
  // absent from the cloud must survive choosing the cloud's conflicting row.
  const preservedCandidates = conflict.operation.changes.filter(
    (change) =>
      change.kind !== 'focus' &&
      change.base === null &&
      change.next &&
      shadows.some(
        (shadow) =>
          shadow.kind === change.kind &&
          shadow.id === change.id &&
          shadow.data === null,
      ),
  );
  const copies: { kind: 'notes' | 'tasks'; data: EntityData; id: string }[] =
    [];
  if (resolution === 'copy')
    for (const change of conflict.operation.changes)
      if (change.kind === 'notes' || change.kind === 'tasks') {
        if (
          preservedCandidates.some(
            (candidate) =>
              candidate.kind === change.kind && candidate.id === change.id,
          )
        )
          continue;
        const data =
          before.get(keyOf(change.kind, change.id))?.next ?? change.next;
        if (data)
          copies.push({
            kind: change.kind,
            id: uid(),
            data: { ...data, createdAt: timestamp(), updatedAt: timestamp() },
          });
      }
  if (resolution === 'copy')
    for (const change of conflict.operation.changes)
      if (change.kind === 'dayNotes' && change.next) {
        if (
          preservedCandidates.some(
            (candidate) =>
              candidate.kind === change.kind && candidate.id === change.id,
          )
        )
          continue;
        const text =
          before.get(keyOf(change.kind, change.id))?.next?.text ??
          change.next.text;
        if (typeof text === 'string' && text.trim())
          copies.push({
            kind: 'notes',
            id: uid(),
            data: {
              text: `${change.id} 的备注副本\n${text}`,
              createdAt: timestamp(),
              updatedAt: timestamp(),
            },
          });
      }
  tx.objectStore('syncConflicts').delete(id);
  for (const shadow of shadows) await applyEntity(tx, shadow);
  const base = await entities(tx);
  for (const candidate of preservedCandidates) {
    const data =
      before.get(keyOf(candidate.kind, candidate.id))?.next ?? candidate.next;
    if (candidate.kind === 'dayNotes')
      tx.objectStore('dayNotes').put({
        date: candidate.id,
        text: data!.text,
        revision: 1,
      });
    else
      tx.objectStore(candidate.kind).put({
        ...data,
        id: candidate.id,
        revision: 1,
      });
  }
  for (const copy of copies) {
    delete copy.data.deletedAt;
    tx.objectStore(copy.kind).put({ ...copy.data, id: copy.id, revision: 1 } as
      NoteRecord | TaskRecord);
  }
  // A focus-only conflict leaves candidate tasks in their calendar dates. The
  // cloud's three slots win; the person can explicitly choose candidates again.
  const changes = diff(base, await entities(tx));
  if (changes.length) await enqueue(tx, await createOperation(tx, changes));
}
