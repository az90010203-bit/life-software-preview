import { SceneScheduler } from './scheduler';
import type { SceneEventDefinition, ScenePhase, SceneRoute as BaseSceneRoute } from './types';

export type SceneRoute = BaseSceneRoute & {
  opacity: number;
  reverse?: boolean;
};
export type ScenePack = {
  id: string;
  version: 1;
  designWidth: number;
  designHeight: number;
  backdrop: string;
  windowMask: string;
  cityMask: string;
  video?: string;
  ships: Record<string, string>;
  routes: SceneRoute[];
  events: SceneEventDefinition[];
  decorations: {
    cityLights: readonly (readonly [number, number])[];
    stars: readonly (readonly [number, number])[];
  };
  lighting: Record<ScenePhase, { brightness: number; saturation: number; sepia: number }>;
};

const art = import.meta.env.BASE_URL + 'art/';
export const observatoryPack: ScenePack = {
  id: 'observatory.cloud-city',
  version: 1,
  designWidth: 1672,
  designHeight: 940,
  backdrop: art + 'observatory.png',
  windowMask: art + 'scene-v1/window-mask.svg',
  cityMask: art + 'scene-v1/city-mask.svg',
  ships: { shuttle: art + 'scene-v1/shuttle.png', cruiser: art + 'scene-v1/cruiser.png' },
  routes: [
    { id: 'shuttle-east', depth: 'far', from: { x: -170, y: 280 }, to: { x: 1160, y: 245 }, width: 116, opacity: .65 },
    { id: 'shuttle-west', depth: 'far', from: { x: 1190, y: 325 }, to: { x: -190, y: 295 }, width: 145, opacity: .72, reverse: true },
    { id: 'cruiser-east', depth: 'near', from: { x: -360, y: 207 }, to: { x: 1200, y: 222 }, width: 310, opacity: .84 },
    { id: 'cruiser-high', depth: 'far', from: { x: 1210, y: 165 }, to: { x: -310, y: 184 }, width: 225, opacity: .66, reverse: true },
    { id: 'meteor', depth: 'far', from: { x: 730, y: 45 }, to: { x: 345, y: 223 }, width: 110, opacity: .72 },
  ],
  events: [
    { id: 'shuttle', type: 'shuttle', weight: 7, cooldownMs: 150_000, durationMs: 32_000, phases: ['dawn', 'day', 'dusk', 'night'], routeIds: ['shuttle-east', 'shuttle-west'] },
    { id: 'cruiser', type: 'cruiser', weight: 3, cooldownMs: 420_000, durationMs: 52_000, phases: ['dawn', 'day', 'dusk', 'night'], routeIds: ['cruiser-east', 'cruiser-high'] },
    { id: 'meteor', type: 'meteor', weight: .7, cooldownMs: 900_000, durationMs: 3_200, phases: ['night'], routeIds: ['meteor'] },
  ],
  decorations: {
    cityLights: [
      [620,273],[626,287],[633,302],[641,287],[647,315],[622,321],[636,338],
      [468,353],[481,360],[498,350],[520,357],[553,350],[575,349],[598,356],
      [675,352],[696,350],[718,354],[744,360],[770,371],[792,379],
      [430,400],[453,404],[477,408],[503,410],[531,417],[560,418],[588,424],
      [616,428],[642,429],[671,426],[699,420],[729,417],[756,410],[781,405],
      [923,420],[931,391],[940,370],[947,402],[955,434],[901,460],[930,473],[972,476],
    ],
    stars: [[102,35],[181,87],[305,28],[411,70],[514,38],[702,102],[799,91],[879,157],[953,203],[383,197],[141,157],[552,139],[753,196],[302,117]],
  },
  lighting: {
    dawn: { brightness: .94, saturation: .83, sepia: .18 },
    day: { brightness: 1, saturation: 1, sepia: 0 },
    dusk: { brightness: .78, saturation: .86, sepia: .34 },
    night: { brightness: .39, saturation: .65, sepia: 0 },
  },
};

export function createSceneRegistry(packs: readonly ScenePack[]) {
  const byId = new Map<string, ScenePack>();
  for (const pack of packs) {
    if (!pack.id.trim() || byId.has(pack.id)) throw new Error(`Invalid or duplicate scene pack id: ${pack.id}`);
    if (pack.version !== 1) throw new Error(`Unsupported scene pack version: ${pack.id}`);
    if (![pack.designWidth, pack.designHeight].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error(`Invalid scene artwork dimensions: ${pack.id}`);
    }
    const routeIds = new Set<string>();
    for (const route of pack.routes) {
      if (!route.id.trim() || routeIds.has(route.id)) throw new Error(`Invalid or duplicate scene route: ${route.id}`);
      if (![route.from.x, route.from.y, route.to.x, route.to.y].every(Number.isFinite)
        || !Number.isFinite(route.width) || route.width <= 0
        || !Number.isFinite(route.opacity) || route.opacity < 0 || route.opacity > 1) {
        throw new Error(`Invalid scene route geometry: ${route.id}`);
      }
      routeIds.add(route.id);
    }
    new SceneScheduler(pack.events, { now: () => 0, random: () => 0 });
    const eventIds = new Set<string>();
    for (const event of pack.events) {
      if (eventIds.has(event.id)) throw new Error(`Duplicate scene event: ${event.id}`);
      if (event.routeIds.some((id) => !routeIds.has(id))) throw new Error(`Unknown scene route in event: ${event.id}`);
      if (event.type !== 'meteor' && !pack.ships[event.type]?.trim()) throw new Error(`Missing ship artwork for scene event: ${event.id}`);
      eventIds.add(event.id);
    }
    byId.set(pack.id, pack);
  }
  return Object.freeze({
    list: Object.freeze([...packs]),
    get: (id: string) => byId.get(id),
  });
}

// Content registration is separate from the desktop's business-plugin registry.
export const scenePacks = createSceneRegistry([observatoryPack]);
