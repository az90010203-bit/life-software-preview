export type WidgetKind = 'notes' | 'calendar' | 'today';
export type WidgetMode = 'icon' | 'card' | 'panel';

export type DeskItem = {
  id: string;
  kind: WidgetKind;
  mode: WidgetMode;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
};

export const WIDGETS: Record<WidgetKind, {
  title: string;
  description: string;
  icon: 'notes' | 'calendar' | 'today';
  sizes: Record<WidgetMode, { width: number; height: number }>;
  minPanel: { width: number; height: number };
}> = {
  notes: {
    title: '随手记',
    description: '接住此刻的一个念头。',
    icon: 'notes',
    sizes: {
      icon: { width: 112, height: 112 },
      card: { width: 340, height: 178 },
      panel: { width: 440, height: 510 },
    },
    minPanel: { width: 360, height: 380 },
  },
  calendar: {
    title: '月历',
    description: '在日期里留下一点记录。',
    icon: 'calendar',
    sizes: {
      icon: { width: 112, height: 112 },
      card: { width: 340, height: 240 },
      panel: { width: 640, height: 520 },
    },
    minPanel: { width: 500, height: 420 },
  },
  today: {
    title: '今天',
    description: '把今天放在眼前。',
    icon: 'today',
    sizes: {
      icon: { width: 112, height: 112 },
      card: { width: 340, height: 156 },
      panel: { width: 350, height: 300 },
    },
    minPanel: { width: 300, height: 220 },
  },
};

const STORAGE_KEY = 'life-preview.workspace.v1';
const MAX_DIMENSION = 8192;
const MODES: readonly WidgetMode[] = ['icon', 'card', 'panel'];

export function defaultItems(): DeskItem[] {
  return [
    { id: '9d1ca4c3-9467-43aa-a2bf-f9dac31ae816', kind: 'notes', mode: 'panel', x: 0.98, y: 0.08, ...WIDGETS.notes.sizes.panel, z: 3 },
    { id: 'b5a560f2-3675-462d-bb9b-96c37fa2f6f3', kind: 'calendar', mode: 'icon', x: 0.45, y: 0.01, ...WIDGETS.calendar.sizes.icon, z: 2 },
    { id: 'c8aab7be-3f08-4878-8ac4-2a1da891d2d3', kind: 'today', mode: 'card', x: 0.02, y: 0.82, ...WIDGETS.today.sizes.card, z: 1 },
  ];
}

function newId(items: DeskItem[]): string {
  const seed = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `desk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const existing = new Set(items.map((item) => item.id));
  if (!existing.has(seed)) return seed;
  // A finite fallback also covers mocked randomness and persisted ID collisions.
  for (let suffix = 1; suffix <= existing.size + 1; suffix += 1) {
    const candidate = `${seed}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${seed}-${existing.size + 2}`;
}

export function createItem(kind: WidgetKind, mode: WidgetMode, items: DeskItem[]): DeskItem {
  const candidates = [
    { x: 0.16, y: 0.16 }, { x: 0.34, y: 0.24 },
    { x: 0.54, y: 0.36 }, { x: 0.24, y: 0.52 },
    { x: 0.48, y: 0.64 }, { x: 0.72, y: 0.52 },
  ];
  const origin = candidates.find((candidate) => items.every(
    (item) => Math.hypot(item.x - candidate.x, item.y - candidate.y) > 0.06,
  )) ?? {
    x: 0.1 + (items.length * 0.137) % 0.8,
    y: 0.1 + (items.length * 0.211) % 0.8,
  };
  const z = items.reduce((highest, item) => Math.max(highest, item.z), 0) + 1;
  return { id: newId(items), kind, mode, ...origin, ...WIDGETS[kind].sizes[mode], z };
}

export function setItemMode(item: DeskItem, mode: WidgetMode): DeskItem {
  return { ...item, mode, ...WIDGETS[item.kind].sizes[mode] };
}

export type WorkspaceLoad = { items: DeskItem[]; warning: string | null };

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readItem(value: unknown): DeskItem | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('id' in value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value.id)) return null;
  if (!('kind' in value) || typeof value.kind !== 'string' || !Object.hasOwn(WIDGETS, value.kind)) return null;
  if (!('mode' in value) || typeof value.mode !== 'string' || !MODES.some((mode) => mode === value.mode)) return null;
  if (!('x' in value) || !finiteNumber(value.x) || value.x < 0 || value.x > 1) return null;
  if (!('y' in value) || !finiteNumber(value.y) || value.y < 0 || value.y > 1) return null;
  if (!('width' in value) || !finiteNumber(value.width) || value.width <= 0 || value.width > MAX_DIMENSION) return null;
  if (!('height' in value) || !finiteNumber(value.height) || value.height <= 0 || value.height > MAX_DIMENSION) return null;
  if (!('z' in value) || !finiteNumber(value.z) || !Number.isSafeInteger(value.z) || value.z < 0) return null;

  const kind = value.kind as WidgetKind;
  const mode = value.mode as WidgetMode;
  const definition = WIDGETS[kind];
  if (mode === 'panel' && (value.width < definition.minPanel.width || value.height < definition.minPanel.height)) return null;
  const size = mode === 'panel'
    ? { width: value.width, height: value.height }
    : definition.sizes[mode];

  return { id: value.id, kind, mode, x: value.x, y: value.y, ...size, z: value.z };
}

export function loadWorkspace(): WorkspaceLoad {
  let raw: string | null;
  try {
    raw = globalThis.localStorage.getItem(STORAGE_KEY);
  } catch {
    return { items: defaultItems(), warning: '浏览器暂时无法读取布局，已使用默认桌面。' };
  }
  if (raw === null) return { items: defaultItems(), warning: null };

  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return { items: defaultItems(), warning: '保存的布局无法读取，已使用默认桌面。' };
  }
  if (
    typeof saved !== 'object' || saved === null
    || !('version' in saved) || saved.version !== 1
    || !('items' in saved) || !Array.isArray(saved.items)
  ) {
    return { items: defaultItems(), warning: '保存的布局格式不兼容，已使用默认桌面。' };
  }

  const items: DeskItem[] = [];
  const ids = new Set<string>();
  let repaired = false;
  for (const candidate of saved.items) {
    const item = readItem(candidate);
    if (!item || ids.has(item.id)) {
      repaired = true;
      continue;
    }
    if (item.width !== candidate.width || item.height !== candidate.height) repaired = true;
    ids.add(item.id);
    items.push(item);
  }
  return { items, warning: repaired ? '部分布局记录已修复或忽略。' : null };
}

export function saveWorkspace(items: DeskItem[]): boolean {
  try {
    const layout: DeskItem[] = [];
    const ids = new Set<string>();
    for (const candidate of items) {
      const item = readItem(candidate);
      if (!item || ids.has(item.id)) return false;
      ids.add(item.id);
      layout.push(item);
    }
    // readItem copies only layout fields; no notes, calendar records or other payloads are saved here.
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, items: layout }));
    return true;
  } catch {
    return false;
  }
}

/** Pixel coordinates inside the desktop canvas, unlike normalized DeskItem.x/y. */
export type Box = { x: number; y: number; width: number; height: number };
export type SnapResult = { box: Box; guides: { x?: number; y?: number } };

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function snapAxis(position: number, size: number, canvasSize: number, targets: number[], threshold: number): { position: number; guide?: number } {
  const maximum = Math.max(0, canvasSize - size);
  const bounded = Math.min(maximum, Math.max(0, Number.isFinite(position) ? position : 0));
  let nearest = bounded;
  let distance = Infinity;
  let guide: number | undefined;

  for (const target of targets) {
    if (!Number.isFinite(target) || target < 0 || target > canvasSize) continue;
    for (const anchor of [0, size / 2, size]) {
      const candidate = target - anchor;
      if (candidate < 0 || candidate > maximum) continue;
      const delta = Math.abs(candidate - bounded);
      if (delta <= threshold && delta < distance) {
        nearest = candidate;
        distance = delta;
        guide = target;
      }
    }
  }
  return { position: nearest, ...(guide === undefined ? {} : { guide }) };
}

export function snapBox(box: Box, others: Box[], canvas: { width: number; height: number }, threshold = 12): SnapResult {
  const canvasWidth = nonNegative(canvas.width);
  const canvasHeight = nonNegative(canvas.height);
  const width = nonNegative(box.width);
  const height = nonNegative(box.height);
  const xTargets = [0, canvasWidth / 2, canvasWidth];
  const yTargets = [0, canvasHeight / 2, canvasHeight];

  for (const other of others) {
    if (![other.x, other.y, other.width, other.height].every(Number.isFinite) || other.width < 0 || other.height < 0) continue;
    xTargets.push(other.x, other.x + other.width / 2, other.x + other.width);
    yTargets.push(other.y, other.y + other.height / 2, other.y + other.height);
  }
  const x = snapAxis(box.x, width, canvasWidth, xTargets, nonNegative(threshold));
  const y = snapAxis(box.y, height, canvasHeight, yTargets, nonNegative(threshold));
  return {
    box: { x: x.position, y: y.position, width, height },
    guides: {
      ...(x.guide === undefined ? {} : { x: x.guide }),
      ...(y.guide === undefined ? {} : { y: y.guide }),
    },
  };
}
