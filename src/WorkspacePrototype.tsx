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
import {
  WidgetDataProvider,
  WidgetContent,
  useWidgetSummary,
} from './components/WidgetContent';
import {
  WIDGETS,
  createItem,
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
const kinds: WidgetKind[] = ['notes', 'calendar', 'today'];
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
    initial.items.find((i) => i.kind === 'notes')?.id ??
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
  const focusNoteId = useRef<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const summary = useWidgetSummary();
  const selected = items.find((i) => i.id === activeId);
  const topTitle = editing
    ? '布置空间'
    : selected
      ? WIDGETS[selected.kind].title
      : '我的空间';
  const today = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
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
    if (!focusNoteId.current) return;
    const id = focusNoteId.current;
    const timer = window.setTimeout(() => {
      document
        .querySelector<HTMLElement>('[data-widget-id="' + id + '"] textarea')
        ?.focus();
      focusNoteId.current = null;
    }, 80);
    return () => window.clearTimeout(timer);
  }, [items, focusRequest]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  function getBox(item: DeskItem): Box {
    const width = Math.min(item.width, Math.max(1, canvas.width)),
      height = Math.min(item.height, Math.max(1, canvas.height));
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
    setToast({ text: WIDGETS[kind].title + '已放进空间，可以拖动标题栏。' });
  }
  function remove(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setItems((current) => current.filter((i) => i.id !== id));
    if (activeId === id) setActiveId(null);
    setToast({
      text: '已收起' + WIDGETS[item.kind].title + '，内容仍然保留。',
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
      const min = WIDGETS[current.item.kind].minPanel;
      box = {
        ...current.box,
        width: Math.min(
          canvas.width - current.box.x,
          Math.max(min.width, current.box.width + dx),
        ),
        height: Math.min(
          canvas.height - current.box.y,
          Math.max(min.height, current.box.height + dy),
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
                    width: Math.max(WIDGETS[i.kind].minPanel.width, box.width),
                    height: Math.max(
                      WIDGETS[i.kind].minPanel.height,
                      box.height,
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
  function quickNote() {
    setLibrary(false);
    setEditing(false);
    const note =
      items.find((i) => i.id === activeId && i.kind === 'notes') ??
      items.find((i) => i.kind === 'notes');
    if (note) {
      focusNoteId.current = note.id;
      if (note.mode === 'panel') activate(note.id);
      else changeMode(note.id, 'panel');
    } else {
      const item = createItem('notes', 'panel', items);
      focusNoteId.current = item.id;
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
    <div className={'observatory ' + (editing ? 'is-arranging' : '')}>
      <img
        className="scene-backdrop"
        src={import.meta.env.BASE_URL + 'art/observatory.png'}
        alt=""
      />
      <header className="app-header">
        <div className="app-brand">
          <Icon name="orbit" size={36} />
          <span>人生</span>
          <i />
          <small className="latin">PERSONAL SPACE</small>
        </div>
        <div className="header-actions">
          <button className="preview-tag" onClick={() => setAbout(!about)}>
            交互预览
          </button>
          <button
            className={'round-control ' + (library ? 'is-active' : '')}
            aria-label="打开组件库"
            title="组件库"
            onClick={() => setLibrary(!library)}
          >
            <Icon name="add" />
          </button>
          <button
            className={'round-control ' + (editing ? 'is-active' : '')}
            aria-label={editing ? '完成布置' : '布置空间'}
            title={editing ? '完成布置' : '布置空间'}
            onClick={() => setEditing(!editing)}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>
      <div className="workspace-heading">
        <div className="workspace-index latin">
          {editing ? 'ARRANGE YOUR SPACE' : 'MY OBSERVATORY'}
        </div>
        <h1>{topTitle}</h1>
        <p>{editing ? '拖动标题栏，靠近时自动吸附。' : today}</p>
      </div>
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
            descriptor = WIDGETS[item.kind];
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
                  <WidgetContent
                    kind={item.kind}
                    mode={item.mode}
                    instanceId={item.id}
                  />
                </div>
              )}
              {editing && item.mode === 'panel' && (
                <button
                  className="resize-grip"
                  aria-label={'调整' + descriptor.title + '面板大小'}
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
                  <Icon name={WIDGETS[kind].icon} size={27} />
                </span>
                <div>
                  <h3>{WIDGETS[kind].title}</h3>
                  <p>{WIDGETS[kind].description}</p>
                  <small>
                    已放置 {items.filter((i) => i.kind === kind).length} 个
                  </small>
                </div>
                <button
                  aria-label={'添加' + WIDGETS[kind].title + '组件'}
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
            <small>当前提供内置示例组件</small>
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
            这是桌面布局与模块呈现的交互预览。记录和布局仅保存在当前浏览器，插件安装与云同步尚未接入。
          </p>
          <p>手机以列表展示，保留电脑的桌面位置。</p>
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
      <footer className="workspace-footer">
        <span>
          我的观景室<span className="footer-count">{items.length} 个组件</span>
        </span>
        <span>{saved ? '布局已保存到此浏览器' : '正在保存布局…'}</span>
      </footer>
      <div className="operation-dock">
        <div className="dock-side">
          <button
            onClick={() => setLibrary(!library)}
            className={library ? 'active' : ''}
          >
            <Icon name="add" size={20} />
            <span>组件库</span>
          </button>
          <i />
          <button
            onClick={() => setEditing(!editing)}
            className={editing ? 'active' : ''}
          >
            <Icon name={editing ? 'check' : 'move'} size={20} />
            <span>{editing ? '完成布置' : '布置空间'}</span>
          </button>
        </div>
        <button className="dock-primary" onClick={quickNote}>
          <Icon name="plus" size={26} />
          记一下
        </button>
        <div className="dock-side dock-summary">
          <span className="latin">
            {String(summary.notesCount).padStart(2, '0')}
          </span>
          <span>片段</span>
          <i />
          <span className="latin">
            {String(summary.calendarDays).padStart(2, '0')}
          </span>
          <span>留下的日子</span>
        </div>
      </div>
    </div>
  );
}
export default function WorkspacePrototype() {
  return (
    <WidgetDataProvider>
      <WorkspaceDesk />
    </WidgetDataProvider>
  );
}
