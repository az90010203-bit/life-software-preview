import type {
  SceneEventDefinition,
  SceneEventInstance,
  SceneSchedulerControls,
} from './types';

export const FIRST_EVENT_WAIT_MS = [20_000, 40_000] as const;
export const EVENT_WAIT_MS = [120_000, 240_000] as const;

interface SchedulerOptions {
  now?: () => number;
  random?: () => number;
}

/** The scene clock advances only while visible and unpaused; no missed event is queued. */
export class SceneScheduler {
  private readonly now: () => number;
  private readonly random: () => number;
  private lastTick: number;
  private sceneTime = 0;
  private waitMs: number;
  private active: SceneEventInstance | null = null;
  private lastType: string | undefined;
  private lastPaused = false;
  private lastTyping = false;
  private lastDisabled = false;
  private sequence = 0;
  private readonly coolingUntil = new Map<string, number>();

  constructor(private readonly definitions: readonly SceneEventDefinition[], options: SchedulerOptions = {}) {
    for (const definition of definitions) {
      if (!definition.id || !definition.type || !Number.isFinite(definition.weight) || definition.weight <= 0
        || !Number.isFinite(definition.durationMs) || definition.durationMs <= 0
        || !Number.isFinite(definition.cooldownMs) || definition.cooldownMs < 0
        || !definition.routeIds.length) {
        throw new Error(`Invalid scene event: ${definition.id}`);
      }
    }
    this.now = options.now ?? (() => performance.now());
    this.random = options.random ?? Math.random;
    this.lastTick = this.now();
    this.waitMs = this.between(FIRST_EVENT_WAIT_MS);
  }

  private sample() {
    const value = this.random();
    return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1 - Number.EPSILON) : 0;
  }

  private between([minimum, maximum]: readonly [number, number]) {
    return minimum + (maximum - minimum) * this.sample();
  }

  private current() {
    return this.active ? { ...this.active } : null;
  }

  snapshot() {
    return { active: this.current(), nextInMs: Math.max(0, this.waitMs) };
  }

  tick(controls: SceneSchedulerControls): SceneEventInstance | null {
    const clock = this.now();
    let delta = Math.max(0, clock - this.lastTick);
    this.lastTick = clock;
    const resumed = this.lastPaused || this.lastDisabled;
    const stoppedTyping = this.lastTyping && !controls.typing;
    this.lastPaused = controls.paused;
    this.lastTyping = controls.typing;
    this.lastDisabled = !controls.enabled;

    if (!controls.enabled) {
      this.active = null;
      return null;
    }
    if (controls.paused) return this.current();
    if (resumed) delta = 0;
    this.sceneTime += delta;
    if (resumed || stoppedTyping) this.waitMs = this.between(EVENT_WAIT_MS);

    if (this.active) {
      this.active.elapsedMs = Math.min(this.active.durationMs, this.active.elapsedMs + delta);
      if (this.active.elapsedMs < this.active.durationMs) return this.current();
      const definition = this.definitions.find((item) => item.id === this.active?.definitionId);
      this.lastType = this.active.type;
      if (definition) this.coolingUntil.set(definition.id, this.sceneTime + definition.cooldownMs);
      this.active = null;
      this.waitMs = this.between(EVENT_WAIT_MS);
      return null;
    }

    if (controls.typing || resumed || stoppedTyping) return null;
    this.waitMs -= delta;
    if (this.waitMs > 0) return null;
    let candidates = this.definitions.filter((definition) => definition.phases.includes(controls.phase)
      && (this.coolingUntil.get(definition.id) ?? 0) <= this.sceneTime);
    const alternatives = candidates.filter((definition) => definition.type !== this.lastType);
    if (alternatives.length) candidates = alternatives;
    if (!candidates.length) {
      // Re-check eligibility without drawing new random delays on every animation frame.
      this.waitMs = 1_000;
      return null;
    }
    const totalWeight = candidates.reduce((sum, definition) => sum + definition.weight, 0);
    let choice = this.sample() * totalWeight;
    const definition = candidates.find((candidate) => {
      choice -= candidate.weight;
      return choice < 0;
    }) ?? candidates[candidates.length - 1];
    this.active = {
      instanceId: ++this.sequence,
      definitionId: definition.id,
      type: definition.type,
      routeId: definition.routeIds[Math.floor(this.sample() * definition.routeIds.length)],
      durationMs: definition.durationMs,
      elapsedMs: 0,
    };
    return this.current();
  }
}
