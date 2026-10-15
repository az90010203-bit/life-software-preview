import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Icon from '../components/Icons';
import SceneBackground from '../components/SceneBackground';
import SceneControls from '../scene/SceneControls';
import { useScenePreferences } from '../scene/useScene';
import { PluginView } from '../platform/PluginHost';
import { PluginNavigationProvider, type PluginDestination, type PluginTarget } from '../platform/navigation';
import { useLocalDay } from '../platform/useLocalDay';
import './mobile.css';

const modules = [
  { id: 'today', title: '今天', subtitle: '重要的事，轻轻放在眼前', icon: 'today' },
  { id: 'notes', title: '随手记', subtitle: '先记下来，让脑海轻一点', icon: 'notes' },
  { id: 'calendar', title: '月历', subtitle: '给未来的事情，留一个位置', icon: 'calendar' },
] as const;
type ModuleId = typeof modules[number]['id'];
export const MOBILE_MODULE_KEY = 'life-preview.mobile-module.v1';
function rememberedModule(): ModuleId {
  try { const value = localStorage.getItem(MOBILE_MODULE_KEY); if (modules.some(item => item.id === value)) return value as ModuleId; } catch { /* The current tab still works without preferences. */ }
  return 'today';
}

export default function MobileWorkspace({ settings, syncStatus }: { settings: ReactNode; syncStatus?: string }) {
  const [active, setActive] = useState<ModuleId>(rememberedModule);
  const [target, setTarget] = useState<PluginTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [viewport, setViewport] = useState({ height: window.visualViewport?.height ?? window.innerHeight, top: 0, keyboard: false });
  const root = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const focusRequest = useRef(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const sceneButton = useRef<HTMLButtonElement>(null);
  const scene = useScenePreferences();
  const day = useLocalDay();
  const current = modules.find(item => item.id === active)!;
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(day + 'T12:00:00'));
  const openPlugin = useCallback((id: string, destination?: PluginDestination) => {
    if (!modules.some(item => item.id === id)) return;
    setSettingsOpen(false); setSceneOpen(false); setActive(id as ModuleId);
    setTarget({ ...destination, pluginId: id, requestId: ++request.current });
    focusRequest.current = Boolean(destination?.action === 'add' || destination?.taskId);
  }, []);
  useEffect(() => {
    try { localStorage.setItem(MOBILE_MODULE_KEY, active); } catch { /* Remember only when storage is available. */ }
    if (!focusRequest.current) return;
    focusRequest.current = false;
    const frame = requestAnimationFrame(() => {
      root.current?.querySelector<HTMLElement>(`[data-mobile-module="${active}"] [data-plugin-focus]`)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, target]);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const vv = window.visualViewport;
        const editable = document.activeElement?.matches('input:not([type="checkbox"]):not([type="radio"]),textarea,[contenteditable="true"]');
        const height = vv?.height ?? window.innerHeight;
        const covered = Math.max(window.innerHeight, document.documentElement.clientHeight) - height;
        const keyboard = Boolean(editable && covered > 120);
        setViewport({ height, top: vv?.offsetTop ?? 0, keyboard });
        if (keyboard) document.activeElement?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      });
    };
    measure();
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    document.addEventListener('focusin', measure); document.addEventListener('focusout', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      document.removeEventListener('focusin', measure); document.removeEventListener('focusout', measure);
    };
  }, []);
  useEffect(() => {
    if (!settingsOpen) return;
    root.current?.querySelector<HTMLElement>('.mobile-settings-close')?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { setSettingsOpen(false); settingsButton.current?.focus(); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [settingsOpen]);
  function switchModule(id: ModuleId) {
    setSettingsOpen(false); setSceneOpen(false); setActive(id);
  }
  return <PluginNavigationProvider value={{ target, openPlugin }}>
    <div ref={root} className="mobile-workspace" data-keyboard={viewport.keyboard} data-scene-phase={scene.phase} style={{ '--mobile-height': `${viewport.height}px`, '--mobile-top': `${viewport.top}px` } as CSSProperties}>
      <SceneBackground settings={scene.settings} reduced={scene.reduced} arranging={viewport.keyboard} />
      <div className="mobile-scene-wash" aria-hidden="true" />
      <header className="mobile-header">
        <div className="mobile-brand"><Icon name="orbit" size={21} /><div><span>我的观景室</span>{syncStatus && <small className="mobile-sync-status" role="status" aria-live="polite">{syncStatus}</small>}</div></div>
        <div className="mobile-header-actions">
          <button ref={sceneButton} type="button" aria-label="场景设置" aria-expanded={sceneOpen} onClick={() => { setSceneOpen(!sceneOpen); setSettingsOpen(false); }}><Icon name="today" size={19} /></button>
          <button ref={settingsButton} type="button" aria-label="打开设置" aria-expanded={settingsOpen} onClick={() => { setSettingsOpen(!settingsOpen); setSceneOpen(false); }}><Icon name="settings" size={19} /></button>
        </div>
      </header>
      <div className="mobile-module-heading"><div><p>{date}</p><h1>{current.title}</h1><span>{current.subtitle}</span></div><button type="button" className="mobile-capture" onClick={() => openPlugin('notes', { action: 'add' })}><Icon name="pen" size={17} /><span>记一下</span></button></div>
      <main className="mobile-module-deck" aria-label="个人空间模块">
        {modules.map(item => <div key={item.id} className="mobile-module" data-mobile-module={item.id} hidden={active !== item.id} inert={active !== item.id}><PluginView pluginId={item.id} mode="panel" instanceId={'mobile-' + item.id} /></div>)}
      </main>
      <nav className="mobile-tabs" aria-label="手机模块导航">
        {modules.map(item => <button key={item.id} type="button" aria-current={active === item.id ? 'page' : undefined} onClick={() => switchModule(item.id)}><span className="mobile-tab-emblem"><Icon name={item.icon} size={22} /></span><span>{item.title}</span></button>)}
      </nav>
      {settingsOpen && <aside className="mobile-settings" role="dialog" aria-modal="false" aria-label="设置"><header><div><small>PERSONAL SPACE</small><h2>你的空间</h2></div><button className="mobile-settings-close" type="button" aria-label="关闭设置" onClick={() => { setSettingsOpen(false); settingsButton.current?.focus(); }}><Icon name="close" size={20} /></button></header><div className="mobile-settings-content">{settings}</div></aside>}
      {sceneOpen && <SceneControls settings={scene.settings} onChange={scene.setSettings} reduced={scene.reduced} phase={scene.phase} onClose={() => { setSceneOpen(false); sceneButton.current?.focus(); }} />}
      {!scene.stored && <p className="mobile-preference-warning" role="status">场景设置暂时只保留在此页。</p>}
    </div>
  </PluginNavigationProvider>;
}
