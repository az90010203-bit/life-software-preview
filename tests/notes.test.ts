import test from 'node:test';
import assert from 'node:assert/strict';
import type { NoteRecord } from '../src/data/types';
import {
  findNotes,
  groupNotesByDay,
  noteDayLabel,
} from '../src/plugins/notes/helpers';

function note(
  id: string,
  text: string,
  createdAt: string,
  deletedAt?: string,
): NoteRecord {
  return { id, text, createdAt, updatedAt: createdAt, revision: 1, deletedAt };
}

test('search reaches the complete text, ignores case, and excludes recycled records', () => {
  const notes = [
    note(
      'long',
      '想法。'.repeat(120) + ' Windows 旅行清单',
      '2026-10-15T01:00:00.000Z',
    ),
    note('other', '只包含 Windows', '2026-10-15T02:00:00.000Z'),
    note(
      'removed',
      'Windows 旅行',
      '2026-10-15T03:00:00.000Z',
      '2026-10-15T04:00:00.000Z',
    ),
  ];
  assert.deepEqual(
    findNotes(notes, '  windows   旅行  ').map((entry) => entry.id),
    ['long'],
  );
  assert.deepEqual(findNotes(notes, '不存在'), []);
  assert.deepEqual(
    findNotes(notes, '  ').map((entry) => entry.id),
    ['other', 'long'],
  );
});

test('recent ordering remains based on creation and never mutates the source snapshot', () => {
  const notes = [
    {
      ...note('old', '刚修改的老片段', '2025-01-01T00:00:00.000Z'),
      updatedAt: '2026-10-15T02:00:00.000Z',
    },
    note('a', '今天的一段', '2026-10-15T01:00:00.000Z'),
    note('b', '同一瞬间的另一段', '2026-10-15T01:00:00.000Z'),
  ];
  assert.deepEqual(
    findNotes(notes).map((entry) => entry.id),
    ['b', 'a', 'old'],
  );
  assert.deepEqual(
    notes.map((entry) => entry.id),
    ['old', 'a', 'b'],
  );
});

test('date groups follow local midnight in both positive and negative time zones', () => {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Tokyo';
    const tokyo = groupNotesByDay(
      findNotes([
        note('before', '午夜前', '2026-10-14T14:59:00.000Z'),
        note('after', '午夜后', '2026-10-14T15:01:00.000Z'),
      ]),
    );
    assert.deepEqual(
      tokyo.map((group) => [group.day, group.entries.map((entry) => entry.id)]),
      [
        ['2026-10-15', ['after']],
        ['2026-10-14', ['before']],
      ],
    );
    process.env.TZ = 'America/Los_Angeles';
    const losAngeles = groupNotesByDay(
      findNotes([
        note('before', '午夜前', '2026-10-15T06:59:00.000Z'),
        note('after', '午夜后', '2026-10-15T07:01:00.000Z'),
      ]),
    );
    assert.deepEqual(
      losAngeles.map((group) => [
        group.day,
        group.entries.map((entry) => entry.id),
      ]),
      [
        ['2026-10-15', ['after']],
        ['2026-10-14', ['before']],
      ],
    );
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test('day labels remain accurate across year boundaries without hiding older years', () => {
  const now = new Date(2026, 0, 1, 10, 0);
  assert.equal(noteDayLabel('2026-01-01', now), '今天');
  assert.equal(noteDayLabel('2025-12-31', now), '昨天');
  assert.equal(noteDayLabel('2025-01-01', now), '2025 年 1 月 1 日');
  assert.equal(noteDayLabel('2026-02-01', now), '2 月 1 日');
});
