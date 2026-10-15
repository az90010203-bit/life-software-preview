import type { NoteRecord } from '../../data/types';
import { localDateKey } from '../../platform/dates';

export function findNotes(notes: readonly NoteRecord[], query = '') {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return notes
    .filter(
      (note) =>
        !note.deletedAt &&
        words.every((word) => note.text.toLocaleLowerCase().includes(word)),
    )
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
}

export function groupNotesByDay(notes: readonly NoteRecord[]) {
  const groups = new Map<string, NoteRecord[]>();
  for (const note of notes) {
    const day = localDateKey(new Date(note.createdAt));
    const entries = groups.get(day) ?? [];
    entries.push(note);
    groups.set(day, entries);
  }
  return [...groups].map(([day, entries]) => ({ day, entries }));
}

export function noteDayLabel(day: string, now = new Date()) {
  if (day === localDateKey(now)) return '今天';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === localDateKey(yesterday)) return '昨天';
  const [year, month, date] = day.split('-').map(Number);
  return (
    (year === now.getFullYear() ? '' : `${year} 年 `) + `${month} 月 ${date} 日`
  );
}
