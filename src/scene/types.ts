export const SCENE_PHASES = ['dawn', 'day', 'dusk', 'night'] as const;

export type ScenePhase = (typeof SCENE_PHASES)[number];
export type ScenePhaseWeights = Record<ScenePhase, number>;

export interface SceneSettings {
  version: 1;
  motion: boolean;
  timeMode: 'auto' | 'fixed';
  fixedPhase: ScenePhase;
  events: boolean;
}

export interface ScenePoint {
  x: number;
  y: number;
}

/** Coordinates use the scene pack's original artwork dimensions. */
export interface SceneRoute {
  id: string;
  depth: 'far' | 'near';
  from: ScenePoint;
  to: ScenePoint;
  width: number;
  opacity?: number;
}

export interface SceneEventDefinition {
  id: string;
  type: string;
  weight: number;
  cooldownMs: number;
  durationMs: number;
  phases: readonly ScenePhase[];
  routeIds: readonly string[];
}

export interface SceneEventInstance {
  instanceId: number;
  definitionId: string;
  type: string;
  routeId: string;
  durationMs: number;
  elapsedMs: number;
}

export interface SceneSchedulerControls {
  phase: ScenePhase;
  enabled: boolean;
  paused: boolean;
  typing: boolean;
}
