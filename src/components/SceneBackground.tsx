import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { observatoryPack, type SceneCloudLayer, type ScenePack } from '../scene/pack';
import { useSceneRuntime } from '../scene/useScene';
import type { SceneEventInstance, SceneSettings } from '../scene/types';
import './SceneBackground.css';

function CloudLayer({ layer }: { layer: SceneCloudLayer }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const style = {
    left: layer.left, top: layer.top, width: layer.tileWidth, height: layer.height, opacity: layer.opacity,
    '--cloud-duration': `${layer.tileWidth / layer.speed}s`,
    '--cloud-delay': `${-layer.offset / layer.speed}s`,
  } as CSSProperties;
  return <div className="scene-cloud-layer" data-cloud-layer={layer.id} style={style}>
    <div className="scene-cloud-track">
      {[0, 1].map((tile) => <img key={tile} src={layer.src} alt="" draggable={false} onError={() => setFailed(true)} />)}
    </div>
  </div>;
}

function PassingEvent({ event, pack, paused }: { event: SceneEventInstance; pack: ScenePack; paused: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const route = pack.routes.find((item) => item.id === event.routeId);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    if (!ref.current || !route) return;
    const player = ref.current.animate([
      { transform: `translate3d(${route.from.x}px,${route.from.y}px,0)`, opacity: 0, offset: 0 },
      { opacity: route.opacity, offset: .08 },
      { opacity: route.opacity, offset: .88 },
      { transform: `translate3d(${route.to.x}px,${route.to.y}px,0)`, opacity: 0, offset: 1 },
    ], { duration: event.durationMs, easing: 'linear', fill: 'forwards' });
    player.currentTime = event.elapsedMs;
    if (paused) player.pause();
    animation.current = player;
    return () => { player.cancel(); animation.current = null; };
  }, [event.instanceId, route, event.durationMs, event.elapsedMs]);
  useLayoutEffect(() => { if (paused) animation.current?.pause(); else animation.current?.play(); }, [paused]);
  if (!route || failed) return null;
  return <div ref={ref} className={'scene-passing scene-passing--' + event.type} data-event={event.type} data-depth={route.depth} style={{ width: route.width }}>
    {event.type === 'meteor' ? <i className="scene-meteor" /> : <div className="scene-ship" style={{ transform: route.reverse ? 'scaleX(-1)' : undefined }}>
      <img src={pack.ships[event.type]} alt="" draggable={false} onError={() => setFailed(true)} />
      <i className="scene-engine" />
    </div>}
  </div>;
}

export default function SceneBackground({ settings, reduced, arranging, pack = observatoryPack }: {
  settings: SceneSettings; reduced: boolean; arranging: boolean; pack?: ScenePack;
}) {
  const runtime = useSceneRuntime(pack, settings, reduced, arranging);
  const viewport = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [fit, setFit] = useState({ scale: 1, left: 0, top: 0 });
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setMediaReady(false); setMediaFailed(false); setImageFailed(false); }, [pack]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      const scale = Math.max(width / pack.designWidth, height / pack.designHeight);
      setFit({ scale, left: (width - pack.designWidth * scale) * (width < 800 ? .35 : .5), top: (height - pack.designHeight * scale) * .5 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [pack]);
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    if (!runtime.animated || runtime.paused) player.pause();
    else player.play().catch(() => setMediaFailed(true));
  }, [runtime.animated, runtime.paused, runtime.small, mediaReady, pack.video]);
  const lighting = { brightness: 0, saturation: 0, sepia: 0 };
  for (const phase of ['dawn', 'day', 'dusk', 'night'] as const)
    for (const key of ['brightness', 'saturation', 'sepia'] as const) lighting[key] += pack.lighting[phase][key] * runtime.weights[phase];
  const exteriorStyle = {
    maskImage: `url("${pack.windowMask}")`, WebkitMaskImage: `url("${pack.windowMask}")`,
    filter: `brightness(${lighting.brightness}) saturate(${lighting.saturation}) sepia(${lighting.sepia})`,
  };
  const eventRoute = pack.routes.find((item) => item.id === runtime.event?.routeId);
  const event = runtime.event && <PassingEvent key={pack.id + runtime.event.instanceId} event={runtime.event} pack={pack} paused={runtime.paused} />;
  const frameStyle = {
    width: pack.designWidth, height: pack.designHeight,
    transform: `translate3d(${fit.left}px,${fit.top}px,0) scale(${fit.scale})`,
    '--scene-night': runtime.weights.night, '--scene-dusk': runtime.weights.dusk, '--scene-dawn': runtime.weights.dawn,
  } as CSSProperties;
  return <div ref={viewport} className="scene-background" style={{ '--scene-night': runtime.weights.night } as CSSProperties} aria-hidden="true" data-motion={runtime.animated ? 'on' : 'off'} data-paused={runtime.paused} data-typing={runtime.typing} data-phase={runtime.phase} data-media={mediaFailed ? 'fallback' : mediaReady ? 'ready' : 'procedural'}>
    <div className="scene-frame" style={frameStyle}>
      {!imageFailed && <img className="scene-original" src={pack.backdrop} alt="" draggable={false} onError={() => setImageFailed(true)} />}
      {!imageFailed && <div className="scene-exterior" style={exteriorStyle}>
        <img className="scene-original" src={pack.backdrop} alt="" draggable={false} />
        {pack.video && runtime.animated && !mediaFailed && !runtime.small && <video ref={video} className={'scene-cloud-video ' + (mediaReady ? 'is-ready' : '')} src={pack.video} muted playsInline loop preload="none" onCanPlay={() => setMediaReady(true)} onError={() => setMediaFailed(true)} />}
        {eventRoute?.depth === 'far' && event}
        <img className="scene-original scene-city" src={pack.backdrop} alt="" draggable={false} style={{ maskImage: `url("${pack.cityMask}")`, WebkitMaskImage: `url("${pack.cityMask}")` }} />
        {eventRoute?.depth === 'near' && event}
        <div className="scene-cloud-sea">
          {pack.clouds?.filter((_, index) => !runtime.small || index === 0).map((layer) => <CloudLayer key={pack.id + layer.id} layer={layer} />)}
        </div>
        <div className="scene-sky-dawn" />
        <div className="scene-sky-dusk" />
        <div className="scene-sky-night" />
        <svg className="scene-stars" viewBox={`0 0 ${pack.designWidth} ${pack.designHeight}`}>{pack.decorations.stars.map(([x,y], i) => <circle key={i} cx={x} cy={y} r={i % 3 ? 1.2 : 1.7} />)}</svg>
      </div>}
      <svg className="scene-city-lights" viewBox={`0 0 ${pack.designWidth} ${pack.designHeight}`} style={{ maskImage: `url("${pack.windowMask}")`, WebkitMaskImage: `url("${pack.windowMask}")` }}>
        {pack.decorations.cityLights.map(([x,y], i) => <rect key={i} x={x} y={y} width={i % 3 ? 1.8 : 2.6} height={i % 4 ? 3 : 5} rx=".7" />)}
      </svg>
      <div className="scene-room-evening" />
      <div className="scene-lamp-glow" />
      <div className="scene-dust">{Array.from({ length: runtime.small ? 3 : 6 }, (_, i) => <i key={i} />)}</div>
    </div>
  </div>;
}
