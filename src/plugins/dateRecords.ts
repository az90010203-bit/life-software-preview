import { validDateKey } from '../platform/dates';
import { isRecord } from './legacy';
export type DateRecords = Record<string, string>;
export type DateState = { version: 1; records: DateRecords };
export const emptyDateState = (): DateState => ({ version: 1, records: {} });
export function decodeDateState(value: unknown) {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.records))
    throw new Error('记录格式不兼容');
  const data = emptyDateState();
  let damaged = false;
  for (const [key, text] of Object.entries(value.records)) {
    if (!validDateKey(key) || typeof text !== 'string') damaged = true;
    else if (text.trim()) data.records[key] = text;
  }
  return { data, damaged };
}
