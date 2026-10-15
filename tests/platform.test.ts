import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPluginRegistry,
  type PluginDefinition,
} from '../src/platform/plugins';
import { pluginStorageKey, readPluginState } from '../src/platform/storage';
import { pluginRegistry } from '../src/plugins';
import { stateSpec as notesSpec } from '../src/plugins/notes/plugin';
import { stateSpec as calendarSpec } from '../src/plugins/calendar/plugin';
import { stateSpec as todaySpec } from '../src/plugins/today/plugin';
import {
  loadWorkspace,
  saveWorkspace,
  createItem,
  setItemMode,
} from '../src/workspace';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const legacy = {
  version: 1,
  notes: [
    { id: 'old-note', text: '旧片段', createdAt: '2026-10-14T08:00:00.000Z' },
  ],
  draft: '还未收好的想法',
  calendar: { '2026-10-14': '旧日记' },
  today: { '2026-10-15': '旧重点' },
};

test('a fourth plugin registers without changing host branches or built-in plugins', () => {
  const first = pluginRegistry.list[0];
  const extra: PluginDefinition = {
    manifest: { ...first.manifest, id: 'example.counter', title: '计数器' },
    Provider: ({ children }) => children,
    View: () => null,
  };
  const registry = createPluginRegistry([...pluginRegistry.list, extra]);
  assert.equal(registry.list.length, 4);
  assert.equal(registry.describe('example.counter').title, '计数器');
  assert.equal(registry.find('example.counter')?.View, extra.View);
  assert.throws(() => createPluginRegistry([extra, extra]), /重复/);
  assert.throws(
    () =>
      createPluginRegistry([
        { ...extra, manifest: { ...extra.manifest, apiVersion: 2 as 1 } },
      ]),
    /接口版本/,
  );
  assert.throws(
    () =>
      createPluginRegistry([
        {
          ...extra,
          manifest: {
            ...extra.manifest,
            minPanel: { width: 9000, height: 10 },
          },
        },
      ]),
    /尺寸/,
  );
});

test('legacy data and drafts migrate separately without changing the old content store', () => {
  const storage = new MemoryStorage();
  storage.setItem('life-preview.content.v1', JSON.stringify(legacy));
  const notes = readPluginState(
    { ...notesSpec, readLegacy: () => legacy },
    storage,
  );
  const calendar = readPluginState(
    {
      ...calendarSpec,
      readLegacy: () => ({ version: 1, records: legacy.calendar }),
    },
    storage,
  );
  const today = readPluginState(
    { ...todaySpec, readLegacy: () => ({ version: 1, records: legacy.today }) },
    storage,
  );
  assert.equal(notes.data.draft, legacy.draft);
  assert.deepEqual(notes.data.notes, legacy.notes);
  assert.deepEqual(calendar.data.records, legacy.calendar);
  assert.deepEqual(today.data.records, legacy.today);
  assert.equal(
    notes.blockWrites || calendar.blockWrites || today.blockWrites,
    false,
  );
  assert.equal(
    storage.getItem('life-preview.content.v1'),
    JSON.stringify(legacy),
  );
  assert.equal(
    new Set(
      [notesSpec, calendarSpec, todaySpec].map((s) => pluginStorageKey(s.id)),
    ).size,
    3,
  );
});

test('new plugin state takes precedence; one corrupt namespace does not affect another plugin', () => {
  const storage = new MemoryStorage();
  storage.setItem(pluginStorageKey('notes'), '{broken');
  storage.setItem(
    pluginStorageKey('calendar'),
    JSON.stringify({ version: 1, records: { '2026-10-15': '新记录' } }),
  );
  const notes = readPluginState(
    { ...notesSpec, readLegacy: () => legacy },
    storage,
  );
  const calendar = readPluginState(
    {
      ...calendarSpec,
      readLegacy: () => {
        throw new Error('must not read old data');
      },
    },
    storage,
  );
  assert.equal(notes.blockWrites, true);
  assert.ok(notes.warning);
  assert.equal(storage.getItem(pluginStorageKey('notes')), '{broken');
  assert.deepEqual(calendar.data.records, { '2026-10-15': '新记录' });
  assert.equal(calendar.blockWrites, false);
});

test('partial damage preserves valid data and prevents overwriting the original payload', () => {
  const storage = new MemoryStorage();
  const raw = JSON.stringify({
    ...legacy,
    notes: [...legacy.notes, legacy.notes[0], { id: 'invalid' }],
  });
  storage.setItem(pluginStorageKey('notes'), raw);
  const result = readPluginState(notesSpec, storage);
  assert.equal(result.data.notes.length, 1);
  assert.equal(result.data.draft, legacy.draft);
  assert.equal(result.blockWrites, true);
  assert.equal(storage.getItem(pluginStorageKey('notes')), raw);
  assert.equal(
    readPluginState(
      {
        ...calendarSpec,
        readLegacy: () => ({ version: 1, records: { '2026-02-29': 'bad' } }),
      },
      new MemoryStorage(),
    ).blockWrites,
    true,
  );
});

test('unavailable storage and unknown versions degrade without overwriting data', () => {
  const result = readPluginState(notesSpec, {
    getItem() {
      throw new Error('unavailable');
    },
    setItem() {
      throw new Error('unavailable');
    },
  });
  assert.equal(result.blockWrites, true);
  assert.deepEqual(result.data.notes, []);
  const storage = new MemoryStorage();
  storage.setItem(
    pluginStorageKey('today'),
    JSON.stringify({ version: 2, records: {} }),
  );
  assert.equal(readPluginState(todaySpec, storage).blockWrites, true);
});

test('layout survives pluginization, keeps missing plugin slots and never stores business content', () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });
  try {
    const note = createItem('notes', 'panel', []);
    const missing = {
      ...note,
      id: 'missing-instance',
      kind: 'external.missing',
      mode: 'card' as const,
      width: 250,
      height: 160,
    };
    storage.setItem(
      'life-preview.workspace.v1',
      JSON.stringify({
        version: 1,
        items: [{ ...note, privateText: 'not-layout' }, missing],
      }),
    );
    const loaded = loadWorkspace();
    assert.equal(loaded.items.length, 2);
    assert.equal(loaded.items[0].id, note.id);
    assert.equal(loaded.items[1].width, 250);
    assert.equal(setItemMode(note, 'icon').width, 112);
    assert.equal(saveWorkspace(loaded.items), true);
    assert.ok(
      !storage.getItem('life-preview.workspace.v1')?.includes('privateText'),
    );
    assert.equal(saveWorkspace([]), true);
    assert.deepEqual(loadWorkspace().items, []);
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('resized cards retain per-instance dimensions and position after saving and loading', () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
  try {
    const cards = pluginRegistry.list.map(({ manifest }) => ({
      ...createItem(manifest.id, 'card', []), width: 410, height: 225, x: .27, y: .35,
    }));
    const duplicate = { ...cards[0], id: 'second-note-card', width: 285, height: 145 };
    assert.equal(saveWorkspace([...cards, duplicate]), true);
    assert.deepEqual(loadWorkspace(), { items: [...cards, duplicate], warning: null });
    assert.deepEqual(setItemMode(cards[0], 'card'), cards[0]);
    assert.equal(setItemMode(cards[0], 'icon').width, 112);
    // Corrupt tiny sizes are repaired without removing an otherwise valid card.
    assert.equal(saveWorkspace([{ ...cards[0], width: 1, height: 1 }]), true);
    const repaired = loadWorkspace().items[0];
    assert.equal(repaired.width, 260);
    assert.equal(repaired.height, 120);
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
