import { validDateKey } from '../platform/dates';
import type {
  DraftRecord,
  NoteRecord,
  TaskRecord,
  DayNoteRecord,
} from './types';

export type LegacyBatch = {
  id: string;
  status: 'complete' | 'recovered' | 'unreadable';
  notes: NoteRecord[];
  tasks: TaskRecord[];
  dayNotes: DayNoteRecord[];
  drafts: DraftRecord[];
  focus: { day: string; ids: string[] }[];
  warning?: string;
};
const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
export function readLegacyBatches(
  storage: Pick<Storage, 'getItem'>,
): LegacyBatch[] {
  return ['notes', 'calendar', 'today'].map((id) => {
    const batch: LegacyBatch = {
      id,
      status: 'complete',
      notes: [],
      tasks: [],
      dayNotes: [],
      drafts: [],
      focus: [],
    };
    try {
      const raw = storage.getItem(`life-preview.plugin.${id}.v1`);
      let value: unknown;
      if (raw !== null) value = JSON.parse(raw);
      else {
        const sharedRaw = storage.getItem('life-preview.content.v1');
        if (sharedRaw !== null) {
          const shared: unknown = JSON.parse(sharedRaw);
          if (!record(shared) || shared.version !== 1) throw new Error();
          value = id === 'notes' ? shared : { version: 1, records: shared[id] };
        } else if (id === 'calendar') {
          const old = storage.getItem('life-preview.calendar.v1');
          if (old !== null) value = { version: 1, records: JSON.parse(old) };
        }
      }
      if (value === undefined) return batch;
      if (!record(value) || value.version !== 1) throw new Error();
      if (id === 'notes') {
        if (!Array.isArray(value.notes) || typeof value.draft !== 'string')
          batch.status = 'recovered';
        const ids = new Set<string>();
        for (const note of Array.isArray(value.notes) ? value.notes : []) {
          if (
            !record(note) ||
            typeof note.id !== 'string' ||
            !note.id ||
            ids.has(note.id) ||
            typeof note.text !== 'string' ||
            !note.text.trim() ||
            typeof note.createdAt !== 'string' ||
            !Number.isFinite(Date.parse(note.createdAt))
          ) {
            batch.status = 'recovered';
            continue;
          }
          ids.add(note.id);
          batch.notes.push({
            id: note.id,
            text: note.text,
            createdAt: note.createdAt,
            updatedAt: note.createdAt,
            revision: 1,
          });
        }
        if (typeof value.draft === 'string' && value.draft)
          batch.drafts.push({
            key: 'notes:new',
            text: value.draft,
            updatedAt: new Date().toISOString(),
          });
      } else {
        if (!record(value.records)) throw new Error();
        for (const [date, text] of Object.entries(value.records)) {
          if (!validDateKey(date) || typeof text !== 'string') {
            batch.status = 'recovered';
            continue;
          }
          if (!text.trim()) continue;
          if (id === 'calendar')
            batch.dayNotes.push({ date, text, revision: 1 });
          else {
            const taskId = `legacy-today-${date}`;
            const timestamp = new Date(`${date}T12:00:00`).toISOString();
            batch.tasks.push({
              id: taskId,
              title: text
                .trim()
                .split(/\r?\n/)
                .find((line) => line.trim())!
                .trim(),
              details: text,
              date,
              completed: false,
              revision: 1,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            batch.focus.push({ day: date, ids: [taskId] });
          }
        }
      }
    } catch {
      batch.status = 'unreadable';
    }
    if (batch.status !== 'complete')
      batch.warning = `${id === 'notes' ? '随手记' : id === 'calendar' ? '月历' : '今天'}的部分旧数据无法读取，原始数据已保留，可通过导出取回。`;
    return batch;
  });
}
