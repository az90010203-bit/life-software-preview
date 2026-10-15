// Interaction prototype: a freely arranged workspace with icon/card/panel instances.
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import Icon from './components/Icons';
import SceneBackground from './components/SceneBackground';
import SceneControls from './scene/SceneControls';
import { useScenePreferences } from './scene/useScene';
import {
  PluginProviders,
  PluginView,
} from './platform/PluginHost';
import { pluginRegistry, primaryPluginId } from './plugins';
import {
  createItem,
  minimumItemSize,
  loadWorkspace,
  saveWorkspace,
  setItemMode,
  snapBox,
  type Box,
  type DeskItem,
  type WidgetKind,
  type WidgetMode,
} from './workspace';

type Gesture = {
  id: string;
  type: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  box: Box;
  item: DeskItem;
  element: HTMLElement;
};
const kinds = pluginRegistry.list.map((plugin) => plugin.manifest.id);
const modes: WidgetMode[] = ['icon', 'card', 'panel'];
const modeTitles: Record<WidgetMode, string> = {
  icon: '图标',
  card: '卡片',
  panel: '面板',
};

function WorkspaceDesk() {
  const [initial] = useState(loadWorkspace);
  const [items, setItems] = useState(initial.items);
  const [warning, setWarning] = useState(initial.warning);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [library, setLibrary] = useState(false);
  const [about, setAbout] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(
    initial.items.find((i) => i.kind === primaryPluginId)?.id ??
      initial.items[0]?.id ??
      null,
  );
  const [canvas, setCanvas] = useState({ width: 1600, height: 750 });
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [toast, setToast] = useState<{
    text: string;
    removed?: DeskItem;
  } | null>(null);
  const [addMode, setAddMode] = useState<WidgetMode>('card');
  const canvasRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const focusWidgetId = useRef<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const primaryAction = pluginRegistry.describe(primaryPluginId)
    .quickAction ?? {
    label: '添加组件',
    icon: 'plus' as const,
    mode: 'panel' as const,
  };
  const scene = useScenePreferences();
  const [sceneOpen, setSceneOpen] = useState(false);
  const sceneButton = useRef<HTMLButtonElement>(null);
  function closeScene() {
    setSceneOpen(false);
    sceneButton.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (library || about || editing) setSceneOpen(false);
  }, [library, about, editing]);
  useEffect(() => {
    if (!sceneOpen) return;
    function outside(event: globalThis.PointerEvent) {
      if (!(event.target instanceof Element) || event.target.closest('[data-scene-controls], [data-scene-trigger]')) return;
      setSceneOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [sceneOpen]);
  // Store panel dimensions in desktop design units, so a smaller viewport
  // preserves breathing room without changing the user's saved arrangement.
  const widthScale = Math.min(1, canvas.width / 1220);
  const heightScale = Math.min(1, canvas.height / 680);
  const today = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Tokyo',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setCanvas({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setSaved(false);
    const timer = window.setTimeout(() => {
      const ok = saveWorkspace(items);
      setSaved(ok);
      setWarning(ok ? null : '浏览器暂时不能保存布局，本次页面仍可使用。');
    }, 300);
    return () => window.clearTimeout(timer);
  }, [items]);
  useEffect(() => {
    if (!focusWidgetId.current) return;
    const id = focusWidgetId.current;
    const timer = window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(
          '[data-widget-id="' + id + '"] [data-plugin-focus]',
        )
        ?.focus();
      focusWidgetId.current = null;
    }, 80);
    return () => window.clearTimeout(timer);
  }, [items, focusRequest]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  function getBox(item: DeskItem): Box {
    const width = Math.min(item.width * widthScale, Math.max(1, canvas.width)),
      height = Math.min(item.height * heightScale, Math.max(1, canvas.height));
    return {
      x: item.x * Math.max(0, canvas.width - width),
      y: item.y * Math.max(0, canvas.height - height),
      width,
      height,
    };
  }
  function activate(id: string) {
    setActiveId(id);
    setItems((current) => {
      const maxZ = Math.max(0, ...current.map((i) => i.z));
      const item = current.find((i) => i.id === id);
      return !item || item.z === maxZ
        ? current
        : current.map((i) => (i.id === id ? { ...i, z: maxZ + 1 } : i));
    });
  }
  function changeMode(id: string, mode: WidgetMode) {
    activate(id);
    setItems((current) =>
      current.map((i) => (i.id === id ? setItemMode(i, mode) : i)),
    );
  }
  function add(kind: WidgetKind, mode = addMode) {
    const item = createItem(kind, mode, items);
    setItems((current) => [
      ...current,
      { ...item, z: Math.max(0, ...current.map((i) => i.z)) + 1 },
    ]);
    setActiveId(item.id);
    setEditing(true);
    setToast({
      text:
        pluginRegistry.describe(kind).title + '已放进空间，可以拖动标题栏。',
    });
  }
  function remove(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setItems((current) => current.filter((i) => i.id !== id));
    if (activeId === id) setActiveId(null);
    setToast({
      text:
        '已收起' +
        pluginRegistry.describe(item.kind).title +
        '，内容仍然保留。',
      removed: item,
    });
  }
  function undoRemove() {
    if (!toast?.removed) return;
    const item = toast.removed;
    setItems((current) =>
      current.some((i) => i.id === item.id)
        ? current
        : [
            ...current,
            { ...item, z: Math.max(0, ...current.map((i) => i.z)) + 1 },
          ],
    );
    setActiveId(item.id);
    setToast(null);
  }
  function startGesture(
    event: ReactPointerEvent<HTMLElement>,
    item: DeskItem,
    type: Gesture['type'],
  ) {
    if (!editing || event.button !== 0 || window.innerWidth < 800) return;
    if (
      type === 'move' &&
      (event.target as HTMLElement).closest(
        'select,input,textarea,[data-no-drag]',
      )
    )
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activate(item.id);
    gesture.current = {
      id: item.id,
      type,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      box: getBox(item),
      item,
      element: event.currentTarget,
    };
  }
  function moveGesture(event: ReactPointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!editing || !current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX,
      dy = event.clientY - current.startY;
    let box: Box;
    if (current.type === 'move') {
      const snapped = snapBox(
        { ...current.box, x: current.box.x + dx, y: current.box.y + dy },
        items.filter((i) => i.id !== current.id).map(getBox),
        canvas,
      );
      box = snapped.box;
      setGuides(snapped.guides);
    } else {
      const min = minimumItemSize(current.item);
      box = {
        ...current.box,
        width: Math.min(
          canvas.width - current.box.x,
          Math.max(min.width * widthScale, current.box.width + dx),
        ),
        height: Math.min(
          canvas.height - current.box.y,
          Math.max(min.height * heightScale, current.box.height + dy),
        ),
      };
      setGuides({});
    }
    setItems((latest) =>
      latest.map((i) =>
        i.id === current.id
          ? {
              ...i,
              x:
                canvas.width > box.width
                  ? box.x / (canvas.width - box.width)
                  : 0,
              y:
                canvas.height > box.height
                  ? box.y / (canvas.height - box.height)
                  : 0,
              ...(current.type === 'resize'
                ? {
                    width: Math.max(
                      minimumItemSize(i).width,
                      box.width / widthScale,
                    ),
                    height: Math.max(
                      minimumItemSize(i).height,
                      box.height / heightScale,
                    ),
                  }
                : {}),
            }
          : i,
      ),
    );
  }
  function endGesture(
    event: ReactPointerEvent<HTMLElement>,
    cancelled = false,
  ) {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (cancelled)
      setItems((latest) =>
        latest.map((i) =>
          i.id === current.id
            ? {
                ...i,
                x: current.item.x,
                y: current.item.y,
                width: current.item.width,
                height: current.item.height,
              }
            : i,
        ),
      );
    gesture.current = null;
    setGuides({});
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyboardMove(
    event: ReactKeyboardEvent<HTMLElement>,
    item: DeskItem,
  ) {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = directions[event.key];
    if (!editing || !d || window.innerWidth < 800) return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 8,
      box = getBox(item),
      next = snapBox(
        { ...box, x: box.x + d[0] * step, y: box.y + d[1] * step },
        [],
        canvas,
        0,
      ).box;
    setItems((current) =>
      current.map((i) =>
        i.id === item.id
          ? {
              ...i,
              x:
                canvas.width > next.width
                  ? next.x / (canvas.width - next.width)
                  : 0,
              y:
                canvas.height > next.height
                  ? next.y / (canvas.height - next.height)
                  : 0,
            }
          : i,
      ),
    );
  }
  function openPrimaryPlugin() {
    if (!primaryPluginId) {
      setLibrary(true);
      return;
    }
    setLibrary(false);
    setEditing(false);
    const targetInstance =
      items.find((i) => i.id === activeId && i.kind === primaryPluginId) ??
      items.find((i) => i.kind === primaryPluginId);
    if (targetInstance) {
      focusWidgetId.current = targetInstance.id;
      if (targetInstance.mode === primaryAction.mode)
        activate(targetInstance.id);
      else changeMode(targetInstance.id, primaryAction.mode);
    } else {
      const item = createItem(primaryPluginId, primaryAction.mode, items);
      focusWidgetId.current = item.id;
      setItems((current) => [...current, item]);
      setActiveId(item.id);
    }
    setFocusRequest((current) => current + 1);
  }
  function cancelGesture() {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    setGuides({});
    setItems((latest) =>
      latest.map((i) =>
        i.id === current.id
          ? {
              ...i,
              x: current.item.x,
              y: current.item.y,
              width: current.item.width,
              height: current.item.height,
            }
          : i,
      ),
    );
    if (current.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
  }
  useEffect(() => {
    if (!editing) cancelGesture();
  }, [editing]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        if (gesture.current) {
          cancelGesture();
          setEditing(false);
        } else if (library) setLibrary(false);
        else if (about) setAbout(false);
        else if (editing) setEditing(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [library, about, editing]);
  return (
    <div className={'observatory ' + (editing ? 'is-arranging' : '')} data-scene-phase={scene.phase}>
      <SceneBackground
        settings={scene.settings}
        reduced={scene.reduced}
        arranging={editing}
      />
      <header className="app-header">
        <div className="app-brand">
          <Icon name="orbit" size={36} />
          <span>人生</span>
          <i />
          <small className="latin">PERSONAL SPACE</small>
        </div>
        <div className="header-actions">
          <button
            ref={sceneButton}
            data-scene-trigger
            className={'round-control scene-motion-control ' + (sceneOpen ? 'is-active' : '')}
            aria-label="场景设置"
            aria-expanded={sceneOpen}
            aria-haspopup="dialog"
            title="场景设置"
            onClick={() => { setAbout(false); setLibrary(false); setSceneOpen(!sceneOpen); }}
          >
            <Icon name="today" size={20} />
          </button>
          <button
            className={'arrange-control ' + (editing ? 'is-active' : '')}
            aria-label={editing ? '完成布置' : '布置空间'}
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            {editing ? '完成布置' : '布置空间'}
          </button>
          <button className="round-control" aria-label="空间说明" title="空间说明" onClick={() => setAbout(!about)}>
            <Icon name="info" size={20} />
          </button>
        </div>
      </header>
      {sceneOpen && <>
        <SceneControls settings={scene.settings} onChange={scene.setSettings} reduced={scene.reduced} phase={scene.phase} onClose={closeScene} />
        {!scene.stored && <p className="scene-storage-notice" role="status">场景偏好暂存于本次打开的页面。</p>}
      </>}
      <div className="workspace-date">{today}</div>
      {editing && <p className="arrange-hint">拖动标题栏移动 · 右下角调整大小 · 菜单切换显示方式</p>}
      <main
        className="desk-workspace"
        ref={canvasRef}
        aria-label="可自由布置的模块桌面"
      >
        {items.length === 0 && (
          <div className="desk-empty">
            <Icon name="space" size={40} />
            <p>从一块组件开始，布置自己的空间。</p>
            <button onClick={() => setLibrary(true)}>
              打开组件库
              <Icon name="plus" size={18} />
            </button>
          </div>
        )}
        {items.map((item) => {
          const box = getBox(item),
            descriptor = pluginRegistry.describe(item.kind);
          const style: CSSProperties = {
            left: box.x,
            top: box.y,
            width: box.width,
            height: box.height,
            zIndex: item.z,
          };
          return (
            <article
              key={item.id}
              data-widget-id={item.id}
              data-kind={item.kind}
              data-mode={item.mode}
              className={
                'desk-widget mode-' +
                item.mode +
                (item.id === activeId ? ' is-selected' : '')
              }
              style={style}
              onPointerDown={() => activate(item.id)}
            >
              <div className="widget-chrome">
                <button
                  className="widget-handle"
                  aria-label={'移动' + descriptor.title + '组件'}
                  title={editing ? '拖动，或用方向键移动' : descriptor.title}
                  onPointerDown={(event) => startGesture(event, item, 'move')}
                  onPointerMove={moveGesture}
                  onPointerUp={endGesture}
                  onPointerCancel={(event) => endGesture(event, true)}
                  onKeyDown={(event) => keyboardMove(event, item)}
                >
                  <Icon name={editing ? 'move' : descriptor.icon} size={19} />
                  <span>{descriptor.title}</span>
                </button>
                {editing && (
                  <div className="widget-controls" data-no-drag>
                    <select
                      aria-label={descriptor.title + '显示方式'}
                      value={item.mode}
                      onChange={(event) =>
                        changeMode(item.id, event.target.value as WidgetMode)
                      }
                    >
                      {modes.map((mode) => (
                        <option key={mode} value={mode}>
                          {modeTitles[mode]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="widget-remove"
                      aria-label={'移除' + descriptor.title + '组件'}
                      title="从桌面收起，保留内容"
                      onClick={() => remove(item.id)}
                    >
                      <Icon name="close" size={17} />
                    </button>
                  </div>
                )}
                {!editing && item.mode === 'card' && (
                  <button
                    className="expand-widget"
                    aria-label={'展开' + descriptor.title + '面板'}
                    onClick={() => changeMode(item.id, 'panel')}
                  >
                    <Icon name="panel" size={15} />
                    <span>展开</span>
                  </button>
                )}
              </div>
              {item.mode === 'icon' ? (
                <button
                  className="widget-icon-body"
                  aria-label={'打开' + descriptor.title + '面板'}
                  onClick={() => {
                    if (!editing) changeMode(item.id, 'panel');
                  }}
                >
                  <Icon name={descriptor.icon} size={36} />
                  <span>{descriptor.title}</span>
                  <i />
                </button>
              ) : (
                <div className="widget-content">
                  <PluginView
                    pluginId={item.kind}
                    mode={item.mode}
                    instanceId={item.id}
                  />
                </div>
              )}
              {editing && item.mode !== 'icon' && (
                <button
                  className="resize-grip"
                  aria-label={'调整' + descriptor.title + modeTitles[item.mode] + '大小'}
                  title="拖动调整大小"
                  onPointerDown={(event) => startGesture(event, item, 'resize')}
                  onPointerMove={moveGesture}
                  onPointerUp={endGesture}
                  onPointerCancel={(event) => endGesture(event, true)}
                >
                  <Icon name="resize" size={21} />
                </button>
              )}
            </article>
          );
        })}
        {guides.x !== undefined && (
          <div className="snap-guide vertical" style={{ left: guides.x }} />
        )}
        {guides.y !== undefined && (
          <div className="snap-guide horizontal" style={{ top: guides.y }} />
        )}
      </main>
      {library && (
        <aside className="component-library" aria-label="组件库">
          <div className="library-header">
            <div>
              <small>COMPONENTS</small>
              <h2>组件库</h2>
            </div>
            <button
              className="round-control"
              aria-label="关闭组件库"
              onClick={() => setLibrary(false)}
            >
              <Icon name="close" size={20} />
            </button>
          </div>
          <p className="library-intro">
            把需要的功能放进空间，同一个模块可以放多份。
          </p>
          <div
            className="add-mode-options"
            role="group"
            aria-label="新组件显示方式"
          >
            {modes.map((mode) => (
              <button
                className={addMode === mode ? 'selected' : ''}
                key={mode}
                onClick={() => setAddMode(mode)}
              >
                <Icon name={mode} size={18} />
                {modeTitles[mode]}
              </button>
            ))}
          </div>
          <div className="library-items">
            {kinds.map((kind) => (
              <div className="library-entry" key={kind}>
                <span className="library-symbol">
                  <Icon name={pluginRegistry.describe(kind).icon} size={27} />
                </span>
                <div>
                  <h3>{pluginRegistry.describe(kind).title}</h3>
                  <p>{pluginRegistry.describe(kind).description}</p>
                  <small>
                    已放置 {items.filter((i) => i.kind === kind).length} 个
                  </small>
                </div>
                <button
                  aria-label={
                    '添加' + pluginRegistry.describe(kind).title + '组件'
                  }
                  title="添加一份"
                  onClick={() => add(kind)}
                >
                  <Icon name="plus" size={23} />
                </button>
              </div>
            ))}
          </div>
          <div className="library-foot">
            <p>收起组件会保留内容。布局与记录仅保存在当前浏览器。</p>
            <small>当前提供内置插件</small>
          </div>
        </aside>
      )}
      {about && (
        <aside className="about-panel" aria-label="平台预览说明">
          <button
            className="round-control"
            aria-label="关闭说明"
            onClick={() => setAbout(false)}
          >
            <Icon name="close" size={18} />
          </button>
          <h2>一个由你布置的空间</h2>
          <p>拖动、增减、缩放组件，也可以把同一功能切换成图标、卡片或面板。</p>
          <p>
            这是桌面布局与模块呈现的交互预览。记录和布局仅保存在当前浏览器。当前支持内置插件接入，外部插件包安装与云同步尚未接入。
          </p>
          <p>手机以列表展示，保留电脑的桌面位置。</p>
          <p>
            右上角可暂停背景动态。书写、布置空间或离开页面时，动态会自动暂停。
          </p>
          <p>
            字体采用 HarmonyOS Sans（鸿蒙 Sans）。{' '}
            <a
              href={
                import.meta.env.BASE_URL + 'fonts/HarmonyOS-Sans-LICENSE.txt'
              }
              target="_blank"
              rel="noreferrer"
            >
              许可声明
            </a>
          </p>
        </aside>
      )}
      {(toast || warning) && (
        <div className="workspace-toast" role="status">
          <span>{warning ?? toast?.text}</span>
          {!warning && toast?.removed && (
            <button onClick={undoRemove}>
              <Icon name="undo" size={16} />
              撤销
            </button>
          )}
        </div>
      )}
      {editing && (
        <footer className="workspace-footer" role="status">
          <span>布置你的空间</span>
          <span>{saved ? '布局已保存' : '正在保存…'}</span>
        </footer>
      )}
      <nav className="operation-dock" aria-label="空间快捷操作">
        <button className="dock-action" onClick={openPrimaryPlugin}>
          <Icon name={pluginRegistry.describe(primaryPluginId).icon} size={23} />
          <span>{pluginRegistry.describe(primaryPluginId).title}</span>
        </button>
        <button className="dock-action" onClick={() => {
          const calendar = items.find((item) => item.kind === 'calendar');
          if (calendar) {
            setLibrary(false);
            changeMode(calendar.id, 'panel');
          } else add('calendar', 'panel');
        }}>
          <Icon name="calendar" size={23} />
          <span>月历</span>
        </button>
        <button className={'dock-action ' + (library ? 'active' : '')} aria-label="打开组件库" aria-expanded={library} onClick={() => setLibrary(!library)}>
          <Icon name="plus" size={23} />
          <span>添加组件</span>
        </button>
      </nav>
    </div>
  );
}
export default function WorkspacePrototype() {
  return (
    <PluginProviders>
      <WorkspaceDesk />
    </PluginProviders>
  );
}
