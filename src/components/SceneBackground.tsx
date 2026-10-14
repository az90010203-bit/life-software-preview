import { useEffect, useState } from 'react';
import './SceneBackground.css';

const MOTION_KEY = 'life-preview.scene-motion.v1';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function readMotionPreference(): boolean {
  try {
    return window.localStorage.getItem(MOTION_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function useSceneMotion() {
  const [preferred, setPreferred] = useState(readMotionPreference);
  const [reduced, setReduced] = useState(
    () => window.matchMedia(REDUCED_MOTION).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION);
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(MOTION_KEY, preferred ? 'on' : 'off');
    } catch {
      // A visual preference can remain session-only when storage is unavailable.
    }
  }, [preferred]);

  return {
    animated: preferred && !reduced,
    reduced,
    toggle: () => setPreferred((current) => !current),
  };
}

export default function SceneBackground({
  src,
  animated,
  arranging,
}: {
  src: string;
  animated: boolean;
  arranging: boolean;
}) {
  const [hidden, setHidden] = useState(() => document.hidden);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    let focusFrame = 0;
    const refreshVisibility = () => setHidden(document.hidden);
    function refreshFocus() {
      const active = document.activeElement;
      setTyping(
        Boolean(
          active?.matches('textarea, input:not([type="button"]):not([type="submit"])')
            || active?.closest('[contenteditable="true"]'),
        ),
      );
    }
    function scheduleFocusCheck() {
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(refreshFocus);
    }
    refreshFocus();
    document.addEventListener('visibilitychange', refreshVisibility);
    document.addEventListener('focusin', refreshFocus);
    document.addEventListener('focusout', scheduleFocusCheck);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('visibilitychange', refreshVisibility);
      document.removeEventListener('focusin', refreshFocus);
      document.removeEventListener('focusout', scheduleFocusCheck);
    };
  }, []);

  return (
    <div
      className="scene-background"
      aria-hidden="true"
      data-motion={animated ? 'on' : 'off'}
      data-paused={arranging || hidden || typing ? 'true' : 'false'}
    >
      <img className="scene-backdrop scene-camera" src={src} alt="" draggable={false} />
      <div className="scene-daylight" />
      <div className="scene-dust">
        {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
      </div>
    </div>
  );
}
