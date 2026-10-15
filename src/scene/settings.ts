import { SCENE_PHASES, type ScenePhase, type SceneSettings } from './types';

export const SCENE_SETTINGS_KEY = 'life-preview.scene-settings.v1';
export const LEGACY_SCENE_MOTION_KEY = 'life-preview.scene-motion.v1';
export const DEFAULT_SCENE_SETTINGS: Readonly<SceneSettings> = Object.freeze({
  version: 1,
  motion: true,
  timeMode: 'auto',
  fixedPhase: 'day',
  events: true,
});

export interface SceneStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): SceneStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function isPhase(value: unknown): value is ScenePhase {
  return typeof value === 'string' && SCENE_PHASES.some((phase) => phase === value);
}

export function readSceneSettings(storage: SceneStorage | undefined = browserStorage()): SceneSettings {
  const defaults = { ...DEFAULT_SCENE_SETTINGS };
  if (!storage) return defaults;
  try {
    const current = storage.getItem(SCENE_SETTINGS_KEY);
    if (current !== null) {
      const value: unknown = JSON.parse(current);
      if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return defaults;
      return {
        version: 1,
        motion: 'motion' in value && typeof value.motion === 'boolean' ? value.motion : defaults.motion,
        timeMode: 'timeMode' in value && value.timeMode === 'fixed' ? 'fixed' : 'auto',
        fixedPhase: 'fixedPhase' in value && isPhase(value.fixedPhase) ? value.fixedPhase : defaults.fixedPhase,
        events: 'events' in value && typeof value.events === 'boolean' ? value.events : defaults.events,
      };
    }
    return { ...defaults, motion: storage.getItem(LEGACY_SCENE_MOTION_KEY) !== 'off' };
  } catch {
    return defaults;
  }
}

export function saveSceneSettings(
  settings: SceneSettings,
  storage: SceneStorage | undefined = browserStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SCENE_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
