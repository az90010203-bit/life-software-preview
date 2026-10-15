import type { PluginStateSpec } from '../../platform/storage';
import { readLegacyContent, isRecord } from '../legacy';
import { manifest } from './manifest';

type LegacyNote = { id: string; text: string; createdAt: string };
type NotesState = { version: 1; notes: LegacyNote[]; draft: string };

// Kept as a read-only migration contract for the original preview stores.
export const stateSpec: PluginStateSpec<NotesState> = {
  id: manifest.id,
  createDefault: () => ({ version: 1, notes: [], draft: '' }),
  readLegacy: readLegacyContent,
  decode(value) {
    if (!isRecord(value) || value.version !== 1)
      throw new Error('记录格式不兼容');
    const data: NotesState = {
      version: 1,
      notes: [],
      draft: typeof value.draft === 'string' ? value.draft : '',
    };
    let damaged =
      typeof value.draft !== 'string' || !Array.isArray(value.notes);
    const ids = new Set<string>();
    if (Array.isArray(value.notes))
      for (const note of value.notes) {
        if (
          isRecord(note) &&
          typeof note.id === 'string' &&
          note.id &&
          !ids.has(note.id) &&
          typeof note.text === 'string' &&
          note.text.trim() &&
          typeof note.createdAt === 'string' &&
          Number.isFinite(Date.parse(note.createdAt))
        ) {
          ids.add(note.id);
          data.notes.push({
            id: note.id,
            text: note.text,
            createdAt: note.createdAt,
          });
        } else damaged = true;
      }
    return { data, damaged };
  },
};
