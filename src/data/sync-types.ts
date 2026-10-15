export type EntityKind = 'notes' | 'tasks' | 'focus' | 'dayNotes';
export type EntityData = Record<string, unknown>;
export type CloudEntity = {
  kind: EntityKind;
  id: string;
  version: number;
  data: EntityData | null;
};
export type CloudChange = {
  kind: EntityKind;
  id: string;
  base: EntityData | null;
  next: EntityData | null;
};
export type CloudOperation = {
  id: string;
  changes: CloudChange[];
  owner?: string;
};
export type ApplyResult = {
  status: 'applied' | 'conflict';
  cursor: number;
  entities: CloudEntity[];
  message?: string;
};
export type PullResult = { cursor: number; entities: CloudEntity[] };
export type PendingOperation = CloudOperation & {
  createdAt: string;
  owner: string;
};
export type SyncConflict = {
  id: string;
  operation: PendingOperation;
  remote: CloudEntity[];
  message: string;
};
export type LocalSyncState = {
  owner: string | null;
  pending: number;
  conflicts: SyncConflict[];
  cursor: number;
  lastSyncedAt: string | null;
};
export interface SyncLocalPort {
  bindAccount(owner: string): Promise<void>;
  getSyncState(): Promise<LocalSyncState>;
  getPendingOperations(): Promise<PendingOperation[]>;
  acceptRemote(result: PullResult): Promise<void>;
  acknowledgeOperation(id: string, result: ApplyResult): Promise<void>;
  resolveConflict(id: string, resolution: 'remote' | 'copy'): Promise<void>;
  getImportCounts(): {
    notes: number;
    tasks: number;
    dayNotes: number;
    focus: number;
  };
}
