import { useEffect, useRef, useState } from 'react';
import { readSceneSettings, saveSceneSettings } from './settings';
import { phaseAt, phaseWeights } from './time';
import { SceneScheduler } from './scheduler';
import type { SceneEventInstance, SceneSettings } from './types';
import type { ScenePack } from './pack';

const REDUCED = '(prefers-reduced-motion: reduce)';
export function useScenePreferences() {
  const [settings, setSettings] = useState(readSceneSettings);
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED).matches);
  const [now, setNow] = useState(() => new Date());
  const [stored, setStored] = useState(true);
  useEffect(() => { setStored(saveSceneSettings(settings)); }, [settings]);
  useEffect(() => {
    const query = window.matchMedia(REDUCED);
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    const refresh = () => { if (!document.hidden) setNow(new Date()); };
    const interval = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { query.removeEventListener('change', update); clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return { settings, setSettings, reduced, stored, phase: settings.timeMode === 'fixed' ? settings.fixedPhase : phaseAt(now) };
}

export function useSceneRuntime(pack: ScenePack, settings: SceneSettings, reduced: boolean, arranging: boolean) {
  const [now, setNow] = useState(() => new Date());
  const [hidden, setHidden] = useState(() => document.hidden);
  const [typing, setTyping] = useState(false);
  const [small, setSmall] = useState(() => window.matchMedia('(max-width: 799px)').matches);
  const [event, setEvent] = useState<SceneEventInstance | null>(null);
  const scheduler = useRef<SceneScheduler | null>(null);
  const animated = settings.motion && !reduced;
  const paused = hidden || arranging;
  const phase = settings.timeMode === 'fixed' ? settings.fixedPhase : phaseAt(now);
  const control = useRef({ phase, enabled: animated && settings.events, paused, typing });
  control.current = { phase, enabled: animated && settings.events, paused, typing };
  useEffect(() => {
    let frame = 0;
    const refreshVisibility = () => { setHidden(document.hidden); if (!document.hidden) setNow(new Date()); };
    const refreshFocus = () => {
      const active = document.activeElement;
      setTyping(Boolean(active?.matches('textarea, input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])') || active?.closest('[contenteditable="true"]')));
    };
    const focusOut = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(refreshFocus); };
    const media = window.matchMedia('(max-width: 799px)');
    const resize = () => setSmall(media.matches);
    refreshFocus();
    document.addEventListener('visibilitychange', refreshVisibility);
    document.addEventListener('focusin', refreshFocus);
    document.addEventListener('focusout', focusOut);
    media.addEventListener('change', resize);
    const clock = window.setInterval(() => { if (!document.hidden) setNow(new Date()); }, 30_000);
    return () => {
      cancelAnimationFrame(frame); clearInterval(clock);
      document.removeEventListener('visibilitychange', refreshVisibility);
      document.removeEventListener('focusin', refreshFocus);
      document.removeEventListener('focusout', focusOut);
      media.removeEventListener('change', resize);
    };
  }, []);
  // React updates only on event creation/removal. Browser animations own the frames.
  useEffect(() => {
    scheduler.current = new SceneScheduler(pack.events, { now: () => performance.now() });
    setEvent(null);
    const tick = () => { const next = scheduler.current!.tick(control.current); setEvent((current) => current?.instanceId === next?.instanceId ? current : next); };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [pack]);
  useEffect(() => {
    const next = scheduler.current?.tick(control.current) ?? null;
    setEvent((current) => current?.instanceId === next?.instanceId ? current : next);
  }, [phase, animated, settings.events, paused, typing]);
  return { event, animated, paused, typing, small, phase, weights: phaseWeights(now, settings.timeMode === 'fixed' ? settings.fixedPhase : undefined) };
}
