import type { PluginStateSpec } from '../../platform/storage';
import { readLegacyContent } from '../legacy';
import {
  emptyDateState,
  decodeDateState,
  type DateState,
} from '../dateRecords';

// Kept for read-only import compatibility with the first plugin data format.
export const stateSpec: PluginStateSpec<DateState> = {
  id: 'calendar',
  createDefault: emptyDateState,
  decode: decodeDateState,
  readLegacy() {
    const old = readLegacyContent();
    if (old) return { version: 1, records: old.calendar };
    const raw = globalThis.localStorage.getItem('life-preview.calendar.v1');
    return raw === null ? undefined : { version: 1, records: JSON.parse(raw) };
  },
};
