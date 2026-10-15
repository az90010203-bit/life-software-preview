import test from 'node:test';
import assert from 'node:assert/strict';
import { phaseAt, phaseWeights } from '../src/scene/time';
import { SceneScheduler } from '../src/scene/scheduler';
import { createSceneRegistry, observatoryPack, type ScenePack } from '../src/scene/pack';
import {
  DEFAULT_SCENE_SETTINGS,
  LEGACY_SCENE_MOTION_KEY,
  SCENE_SETTINGS_KEY,
  readSceneSettings,
  saveSceneSettings,
} from '../src/scene/settings';
import type { SceneEventDefinition, SceneSchedulerControls } from '../src/scene/types';

const localDate = (hours: number, minutes = 0, seconds = 0) => new Date(2026, 9, 15, hours, minutes, seconds);
const controls: SceneSchedulerControls = { phase: 'day', enabled: true, paused: false, typing: false };
const shuttle: SceneEventDefinition = {
  id: 'transport', type: 'shuttle', phases: ['dawn', 'day', 'dusk', 'night'],
  weight: 6, cooldownMs: 0, durationMs: 10_000, routeIds: ['left-to-right', 'right-to-left'],
};
const cruiser: SceneEventDefinition = { ...shuttle, id: 'patrol', type: 'cruiser', weight: 2 };
const meteor: SceneEventDefinition = { ...shuttle, id: 'meteor', type: 'meteor', weight: 1, phases: ['night'] };

function simulation(definitions: SceneEventDefinition[] = [shuttle, cruiser, meteor], random = () => 0) {
  let clock = 0;
  const scheduler = new SceneScheduler(definitions, { now: () => clock, random });
  return {
    scheduler,
    step(ms = 0, overrides: Partial<SceneSchedulerControls> = {}) {
      clock += ms;
      return scheduler.tick({ ...controls, ...overrides });
    },
  };
}

test('local phase boundaries are exact and evening/night span midnight', () => {
  assert.equal(phaseAt(localDate(4, 59, 59)), 'night');
  assert.equal(phaseAt(localDate(5)), 'dawn');
  assert.equal(phaseAt(localDate(7, 59, 59)), 'dawn');
  assert.equal(phaseAt(localDate(8)), 'day');
  assert.equal(phaseAt(localDate(17)), 'dusk');
  assert.equal(phaseAt(localDate(19)), 'night');
  assert.equal(phaseAt(localDate(0)), 'night');
});

test('phase lighting blends smoothly for twenty minutes and fixed time ignores wall clock', () => {
  assert.deepEqual(phaseWeights(localDate(7, 50)), { dawn: 1, day: 0, dusk: 0, night: 0 });
  assert.deepEqual(phaseWeights(localDate(8)), { dawn: 0.5, day: 0.5, dusk: 0, night: 0 });
  assert.deepEqual(phaseWeights(localDate(8, 10)), { dawn: 0, day: 1, dusk: 0, night: 0 });
  const before = phaseWeights(localDate(18, 59, 59));
  const after = phaseWeights(localDate(19, 0, 1));
  assert.ok(Math.abs(after.night - before.night) < 0.003);
  assert.ok(Math.abs(Object.values(after).reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
  assert.deepEqual(phaseWeights(localDate(12), 'night'), { dawn: 0, day: 0, dusk: 0, night: 1 });
  assert.equal(phaseWeights(new Date('invalid')).day, 1);
});

test('first event uses 20–40 seconds, later events use 120–240 seconds, and one event is active', () => {
  const low = simulation();
  assert.equal(low.scheduler.snapshot().nextInMs, 20_000);
  assert.equal(low.step(19_999), null);
  assert.equal(low.step(1)?.definitionId, 'transport');
  assert.equal(low.step(5_000)?.instanceId, 1);
  assert.equal(low.step(5_000), null);
  assert.equal(low.scheduler.snapshot().nextInMs, 120_000);
  assert.equal(low.step(119_999), null);
  assert.equal(low.step(1)?.definitionId, 'patrol');
  const high = simulation([shuttle], () => 1);
  assert.ok(high.scheduler.snapshot().nextInMs <= 40_000);
  assert.ok(high.scheduler.snapshot().nextInMs > 39_999);
  high.step(40_000);
  high.step(10_000);
  assert.ok(high.scheduler.snapshot().nextInMs <= 240_000);
  assert.ok(high.scheduler.snapshot().nextInMs > 239_999);
});

test('weighted selection favors common ships and meteor is restricted to night', () => {
  const common = simulation(undefined, () => 0.6);
  assert.equal(common.step(40_000)?.type, 'shuttle');
  const rare = simulation(undefined, () => 0.95);
  assert.equal(rare.step(40_000)?.type, 'cruiser');
  const nighttime = simulation(undefined, () => 0.95);
  assert.equal(nighttime.step(40_000, { phase: 'night' })?.type, 'meteor');
  const onlyMeteor = simulation([meteor]);
  assert.equal(onlyMeteor.step(40_000), null);
  assert.equal(onlyMeteor.step(1_000, { phase: 'night' })?.type, 'meteor');
});

test('repeat avoidance selects another type while a sole eligible type may repeat', () => {
  const mixed = simulation();
  assert.equal(mixed.step(20_000)?.type, 'shuttle');
  mixed.step(10_000);
  assert.equal(mixed.step(120_000)?.type, 'cruiser');
  mixed.step(10_000);
  assert.equal(mixed.step(120_000)?.type, 'shuttle');
  const single = simulation([shuttle]);
  single.step(20_000);
  single.step(10_000);
  assert.equal(single.step(120_000)?.type, 'shuttle');
});

test('cooldown excludes an event until its full cooldown has elapsed', () => {
  const scene = simulation([{ ...shuttle, cooldownMs: 180_000 }]);
  scene.step(20_000);
  scene.step(10_000);
  assert.equal(scene.step(120_000), null);
  assert.equal(scene.step(59_000), null);
  assert.equal(scene.step(1_000)?.type, 'shuttle');
});

test('hiding or arranging freezes an active event and restarts the wait without catch-up', () => {
  const scene = simulation();
  scene.step(20_000);
  assert.equal(scene.step(2_000)?.elapsedMs, 2_000);
  scene.step(0, { paused: true });
  assert.equal(scene.step(600_000, { paused: true })?.elapsedMs, 2_000);
  assert.equal(scene.step()?.elapsedMs, 2_000);
  assert.equal(scene.step(8_000), null);
  assert.equal(scene.scheduler.snapshot().nextInMs, 120_000);
  const pending = simulation();
  pending.step(19_000);
  pending.step(0, { paused: true });
  pending.step(600_000, { paused: true });
  assert.equal(pending.step(), null);
  assert.equal(pending.scheduler.snapshot().nextInMs, 120_000);
  assert.equal(pending.step(119_999), null);
  assert.equal(pending.step(1)?.type, 'shuttle');
});

test('typing allows the existing ship to leave but suppresses new events until a fresh wait', () => {
  const scene = simulation();
  scene.step(20_000);
  assert.equal(scene.step(5_000, { typing: true })?.elapsedMs, 5_000);
  assert.equal(scene.step(5_000, { typing: true }), null);
  assert.equal(scene.step(600_000, { typing: true }), null);
  assert.equal(scene.step(), null);
  assert.equal(scene.scheduler.snapshot().nextInMs, 120_000);
  assert.equal(scene.step(120_000)?.type, 'cruiser');
});

test('disabling motion or events clears active content and enabling schedules a new wait', () => {
  const scene = simulation();
  scene.step(20_000);
  assert.equal(scene.step(0, { enabled: false }), null);
  scene.step(600_000, { enabled: false });
  assert.equal(scene.step(), null);
  assert.equal(scene.scheduler.snapshot().nextInMs, 120_000);
  assert.equal(scene.step(119_999), null);
  assert.ok(scene.step(1));
});

test('scene settings migrate the old switch, preserve it, and prefer the new settings key', () => {
  const values = new Map<string, string>([[LEGACY_SCENE_MOTION_KEY, 'off']]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const migrated = readSceneSettings(storage);
  assert.equal(migrated.motion, false);
  assert.equal(migrated.timeMode, 'auto');
  assert.equal(values.get(LEGACY_SCENE_MOTION_KEY), 'off');
  const updated = { ...migrated, motion: true, timeMode: 'fixed' as const, fixedPhase: 'night' as const, events: false };
  assert.equal(saveSceneSettings(updated, storage), true);
  assert.deepEqual(readSceneSettings(storage), updated);
  assert.equal(values.get(LEGACY_SCENE_MOTION_KEY), 'off');
  values.set(SCENE_SETTINGS_KEY, '{broken');
  assert.deepEqual(readSceneSettings(storage), DEFAULT_SCENE_SETTINGS);
  assert.equal(values.get(SCENE_SETTINGS_KEY), '{broken');
});

test('invalid preference fields and inaccessible storage do not affect the host', () => {
  const storage = {
    getItem: () => JSON.stringify({ version: 1, motion: false, timeMode: 'future', fixedPhase: 'unknown', events: 4 }),
    setItem: () => { throw new Error('QuotaExceededError'); },
  };
  assert.deepEqual(readSceneSettings(storage), { ...DEFAULT_SCENE_SETTINGS, motion: false });
  assert.equal(saveSceneSettings({ ...DEFAULT_SCENE_SETTINGS }, storage), false);
  assert.deepEqual(readSceneSettings({ ...storage, getItem: () => { throw new Error('SecurityError'); } }), DEFAULT_SCENE_SETTINGS);
});

test('a second scene pack registers and schedules its own artwork, routes, and event type', () => {
  const extra: ScenePack = {
    ...observatoryPack,
    id: 'orbital.courtyard',
    ships: { courier: '/art/courier.png' },
    routes: [{ id: 'courier-overhead', depth: 'near', from: { x: -100, y: 20 }, to: { x: 1700, y: 40 }, width: 80, opacity: 0.7 }],
    events: [{ ...shuttle, id: 'courier', type: 'courier', routeIds: ['courier-overhead'] }],
    decorations: { cityLights: [[40, 60]], stars: [] },
  };
  const registry = createSceneRegistry([observatoryPack, extra]);
  assert.equal(registry.list.length, 2);
  assert.equal(registry.get(extra.id), extra);
  assert.equal(registry.get('uninstalled'), undefined);
  const first = simulation(registry.get(observatoryPack.id)!.events);
  const second = simulation(registry.get(extra.id)!.events);
  assert.equal(first.step(20_000)?.type, 'shuttle');
  const active = second.step(20_000);
  assert.equal(active?.type, 'courier');
  assert.equal(active?.routeId, 'courier-overhead');
  assert.equal(extra.ships[active!.type], '/art/courier.png');
  assert.deepEqual(extra.decorations.cityLights, [[40, 60]]);
});

test('scene registration rejects broken route references, duplicate IDs, and invalid geometry', () => {
  assert.throws(() => createSceneRegistry([observatoryPack, observatoryPack]), /duplicate scene pack/);
  assert.throws(() => createSceneRegistry([{ ...observatoryPack, designWidth: 0 }]), /dimensions/);
  assert.throws(() => createSceneRegistry([{ ...observatoryPack, routes: [observatoryPack.routes[0], observatoryPack.routes[0]] }]), /duplicate scene route/);
  assert.throws(() => createSceneRegistry([{ ...observatoryPack, routes: [{ ...observatoryPack.routes[0], opacity: 1.1 }] }]), /geometry/);
  assert.throws(() => createSceneRegistry([{ ...observatoryPack, events: [{ ...shuttle, routeIds: ['missing-route'] }] }]), /Unknown scene route/);
  assert.throws(() => createSceneRegistry([{ ...observatoryPack, ships: {} }]), /Missing ship artwork/);
  assert.throws(() => createSceneRegistry([{ ...observatoryPack, events: [{ ...shuttle, weight: -1 }] }]), /Invalid scene event/);
});
