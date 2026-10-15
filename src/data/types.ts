import type { SyncLocalPort } from './sync-types';

export type NoteRecord = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  deletedAt?: string;
};
export type TaskRecord = {
  id: string;
  title: string;
  date: string;
  time?: string;
  details?: string;
  sourceNoteId?: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
  deletedAt?: string;
};
export type DayNoteRecord = { date: string; text: string; revision: number };
export type DraftRecord = {
  key: string;
  text: string;
  baseRevision?: number;
  updatedAt: string;
};
export type RecoverableDraft = {
  id: string;
  key: string;
  text: string;
  updatedAt: string;
};
export type DataSnapshot = {
  notes: NoteRecord[];
  tasks: TaskRecord[];
  focus: Record<string, string[]>;
  dayNotes: DayNoteRecord[];
  drafts: DraftRecord[];
  ready: boolean;
  warning: string | null;
};
export type TaskInput = Pick<TaskRecord, 'title' | 'date'> &
  Partial<Pick<TaskRecord, 'id' | 'time' | 'details' | 'sourceNoteId'>>;
export type TaskPatch = Partial<
  Pick<TaskRecord, 'title' | 'date' | 'time' | 'details'>
>;
export type FocusOptions = {
  replaceId?: string;
  moveToDay?: boolean;
  expectedDate?: string;
};
export type CreateTaskOptions = {
  focusDay?: string;
  replaceId?: string;
  draftKey?: string;
};
export class DataError extends Error {
  constructor(
    public code: 'conflict' | 'full' | 'date' | 'storage' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}
export interface TaskService extends SyncLocalPort {
  getSnapshot(): DataSnapshot;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<void>;
  createNote(text: string, draftKey?: string): Promise<NoteRecord>;
  updateNote(
    id: string,
    text: string,
    expectedRevision: number,
    draftKey?: string,
  ): Promise<NoteRecord>;
  deleteNote(id: string): Promise<void>;
  restoreNote(id: string): Promise<void>;
  createTask(
    input: TaskInput,
    options?: CreateTaskOptions,
  ): Promise<TaskRecord>;
  updateTask(
    id: string,
    patch: TaskPatch,
    expectedRevision?: number,
    draftKey?: string,
  ): Promise<TaskRecord>;
  toggleTask(id: string, completed: boolean): Promise<void>;
  deleteTask(id: string): Promise<void>;
  restoreTask(id: string): Promise<void>;
  setFocus(day: string, taskId: string, options?: FocusOptions): Promise<void>;
  removeFocus(day: string, taskId: string): Promise<void>;
  reorderFocus(day: string, ids: string[]): Promise<void>;
  saveDayNote(
    date: string,
    text: string,
    expectedRevision?: number,
    draftKey?: string,
  ): Promise<void>;
  saveDraft(key: string, text: string, baseRevision?: number): Promise<void>;
  clearDraft(key: string): Promise<void>;
  listRecoverableDrafts(): Promise<RecoverableDraft[]>;
  recoverDraft(id: string, expected?: Pick<RecoverableDraft, 'text' | 'updatedAt'>): Promise<NoteRecord>;
  exportData(): Promise<string>;
  flushPendingWrites(): Promise<void>;
}
