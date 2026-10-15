import type { ScenePhase, ScenePhaseWeights } from './types';

const TRANSITIONS: readonly [number, ScenePhase, ScenePhase][] = [
  [5 * 60, 'night', 'dawn'],
  [8 * 60, 'dawn', 'day'],
  [17 * 60, 'day', 'dusk'],
  [19 * 60, 'dusk', 'night'],
];

function localMinutes(date: Date) {
  return date.getHours() * 60 + date.getMinutes()
    + date.getSeconds() / 60 + date.getMilliseconds() / 60000;
}

export function phaseAt(date: Date): ScenePhase {
  const minutes = localMinutes(date);
  if (!Number.isFinite(minutes)) return 'day';
  if (minutes >= 5 * 60 && minutes < 8 * 60) return 'dawn';
  if (minutes >= 8 * 60 && minutes < 17 * 60) return 'day';
  if (minutes >= 17 * 60 && minutes < 19 * 60) return 'dusk';
  return 'night';
}

function onePhase(phase: ScenePhase): ScenePhaseWeights {
  return { dawn: 0, day: 0, dusk: 0, night: 0, [phase]: 1 };
}

/** A twenty-minute transition centered on each local-time phase boundary. */
export function phaseWeights(date: Date, fixedPhase?: ScenePhase): ScenePhaseWeights {
  if (fixedPhase) return onePhase(fixedPhase);
  const minutes = localMinutes(date);
  if (!Number.isFinite(minutes)) return onePhase('day');
  for (const [boundary, previous, next] of TRANSITIONS) {
    if (minutes < boundary - 10 || minutes > boundary + 10) continue;
    const t = (minutes - boundary + 10) / 20;
    const blend = t * t * (3 - 2 * t);
    const weights = onePhase(previous);
    weights[previous] = 1 - blend;
    weights[next] = blend;
    return weights;
  }
  return onePhase(phaseAt(date));
}
