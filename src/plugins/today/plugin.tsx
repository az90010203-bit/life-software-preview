import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import Icon from '../../components/Icons';
import TaskEditor from '../../components/TaskEditor';
import DataTools from '../../components/DataTools';
import FocusPicker from '../../components/FocusPicker';
import { useData } from '../../data/react';
import type { TaskRecord } from '../../data/types';
import { usePluginNavigation } from '../../platform/navigation';
import type { PluginDefinition, PluginViewProps } from '../../platform/plugins';
import type { PluginStateSpec } from '../../platform/storage';
import { useLocalDay } from '../../platform/useLocalDay';
import { readLegacyContent } from '../legacy';
import {
  emptyDateState,
  decodeDateState,
  type DateState,
} from '../dateRecords';
import { manifest } from './manifest';
import './today.css';

// Kept as the source decoder for migration and old plugin consumers.
export const stateSpec: PluginStateSpec<DateState> = {
  id: manifest.id,
  createDefault: emptyDateState,
  decode: decodeDateState,
  readLegacy() {
    const old = readLegacyContent();
    return old ? { version: 1, records: old.today } : undefined;
  },
};

function Provider({ children }: PropsWithChildren) {
  return children;
}

function View({ mode }: PluginViewProps) {
  const { snapshot, service } = useData();
  const { openPlugin, target } = usePluginNavigation();
  const todayKey = useLocalDay();
  const [editor, setEditor] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [allDates, setAllDates] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const busy = useRef(false);
  const date = new Date(todayKey + 'T12:00:00');
  const taskById = useMemo(
    () => new Map(snapshot.tasks.map((task) => [task.id, task])),
    [snapshot.tasks],
  );
  const focusedIds = snapshot.focus[todayKey] ?? [];
  const focused = focusedIds
    .map((id) => taskById.get(id))
    .filter((task): task is TaskRecord => !!task && !task.deletedAt)
    .slice(0, 3);
  const selected = selectedId ? taskById.get(selectedId) : undefined;
  const editingTask =
    editor && editor !== 'new' ? taskById.get(editor) : undefined;
  const candidates = snapshot.tasks
    .filter(
      (task) =>
        !task.deletedAt &&
        !task.completed &&
        !focusedIds.includes(task.id) &&
        (allDates || task.date === todayKey) &&
        (task.title + '\n' + (task.details ?? ''))
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time ?? '99:99').localeCompare(b.time ?? '99:99') ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const previous = useMemo(() => {
    const ids = [
      ...new Set(
        Object.keys(snapshot.focus)
          .filter((day) => day < todayKey)
          .sort()
          .reverse()
          .flatMap((day) => snapshot.focus[day]),
      ),
    ];
    return ids
      .map((id) => taskById.get(id))
      .filter(
        (task): task is TaskRecord =>
          !!task &&
          !task.deletedAt &&
          !task.completed &&
          task.date < todayKey &&
          !focusedIds.includes(task.id),
      );
  }, [snapshot.focus, todayKey, taskById, focusedIds]);

  useEffect(() => {
    setEditor(null);
    setPicking(false);
    setSelectedId(null);
    setFeedback('');
    setError('');
  }, [todayKey]);

  useEffect(() => {
    if (mode !== 'panel' || !target || target.pluginId !== 'today') return;
    if (target.action === 'add') {
      setEditor('new');
      setPicking(false);
      setSelectedId(null);
    }
    if (target.action === 'select') {
      setPicking(true);
      setEditor(null);
      setSelectedId(null);
    }
    if (target.taskId) {
      setEditor(target.taskId);
      setPicking(false);
      setSelectedId(null);
    }
  }, [target, mode]);

  function beginAdd() {
    setFeedback('');
    setError('');
    if (mode === 'card') {
      openPlugin('today', { action: 'add' });
      return;
    }
    setEditor('new');
    setPicking(false);
    setSelectedId(null);
  }

  function edit(task: TaskRecord) {
    if (mode === 'card') {
      openPlugin('today', { taskId: task.id });
      return;
    }
    setEditor(task.id);
    setPicking(false);
    setSelectedId(null);
    setFeedback('');
    setError('');
  }

  async function act(id: string, operation: () => Promise<void>, message = '') {
    if (busy.current) return;
    busy.current = true;
    setBusyId(id);
    setError('');
    setFeedback('');
    try {
      await operation();
      setFeedback(message);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '没有保存成功，请再试一次。',
      );
    } finally {
      busy.current = false;
      setBusyId('');
    }
  }

  function reorder(index: number, offset: number) {
    const ids = focused.map((task) => task.id);
    const next = index + offset;
    if (next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    void act(
      ids[next],
      () => service.reorderFocus(todayKey, ids),
      '顺序已调整。',
    );
  }

  const showList = !editor && !selected;
  return (
    <div className={'today-plugin today-plugin--' + mode}>
      <header className="today-plugin-heading">
        <div className="today-plugin-title">
          <span>今日重点</span>
          <span className="today-plugin-count">
            {focused.length}
            <small> / 3</small>
          </span>
        </div>
        <time className="today-plugin-date" dateTime={todayKey}>
          {String(date.getMonth() + 1).padStart(2, '0')}.
          {String(date.getDate()).padStart(2, '0')}
        </time>
      </header>
      {mode === 'panel' && showList && (
        <p className="today-plugin-caption">
          给今天留一点余地，只放真正重要的事。
        </p>
      )}
      {!snapshot.ready && (
        <p className="today-plugin-empty" role="status">
          正在打开今天…
        </p>
      )}
      {snapshot.ready && showList && (
        <>
          <ol className="today-priorities" aria-label="今日三件重点">
            {focused.map((task, index) => (
              <li
                key={task.id}
                className={
                  task.completed
                    ? 'today-priority is-completed'
                    : 'today-priority'
                }
              >
                <label
                  className="today-priority-check"
                  title={task.completed ? '标为未完成' : '完成这件事'}
                >
                  <input
                    type="checkbox"
                    checked={task.completed}
                    disabled={!!busyId}
                    aria-label={
                      (task.completed ? '标为未完成：' : '完成：') + task.title
                    }
                    onChange={(event) => {
                      void act(task.id, () =>
                        service.toggleTask(task.id, event.target.checked),
                      );
                    }}
                  />
                  <span aria-hidden="true">
                    {task.completed ? (
                      <Icon name="check" size={14} />
                    ) : (
                      String(index + 1).padStart(2, '0')
                    )}
                  </span>
                </label>
                <button
                  type="button"
                  className="today-priority-title"
                  onClick={() => edit(task)}
                  title={task.title}
                >
                  <span>{task.title}</span>
                  {mode === 'panel' && task.time && <time>{task.time}</time>}
                </button>
                {mode === 'panel' && (
                  <details className="today-priority-menu">
                    <summary aria-label={'更多操作：' + task.title}>
                      ···
                    </summary>
                    <div>
                      <button
                        type="button"
                        disabled={!!busyId || index === 0}
                        onClick={() => reorder(index, -1)}
                      >
                        上移
                      </button>
                      <button
                        type="button"
                        disabled={!!busyId || index === focused.length - 1}
                        onClick={() => reorder(index, 1)}
                      >
                        下移
                      </button>
                      <button
                        type="button"
                        disabled={!!busyId}
                        onClick={() => {
                          void act(
                            task.id,
                            () => service.removeFocus(todayKey, task.id),
                            '已移出重点，事项仍保留在月历中。',
                          );
                        }}
                      >
                        移出重点
                      </button>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ol>
          {focused.length === 0 && (
            <p className="today-plugin-empty">今天，想把哪件事做好？</p>
          )}
          <div className="today-plugin-add-actions">
            <button
              className="today-add"
              type="button"
              disabled={!snapshot.ready}
              onClick={beginAdd}
            >
              <Icon name="plus" size={16} />
              {focused.length >= 3 ? '替换一件重点' : '添一件重点'}
            </button>
            {mode === 'panel' && (
              <button
                className="today-choose"
                type="button"
                onClick={() => {
                  setPicking(!picking);
                  setQuery('');
                  setSelectedId(null);
                  setError('');
                }}
              >
                {picking ? '收起选择' : '从安排中选择'}
              </button>
            )}
          </div>
        </>
      )}
      {mode === 'panel' && snapshot.ready && editor && (
        <div className="today-plugin-editor">
          {editor === 'new' || (editingTask && !editingTask.deletedAt) ? (
            <TaskEditor
              key={editor + ':' + todayKey}
              task={editingTask}
              initialDate={todayKey}
              focusDay={editor === 'new' ? todayKey : undefined}
              onDone={() => {
                setEditor(null);
                setFeedback('已保存。');
              }}
              onCancel={() => setEditor(null)}
            />
          ) : (
            <>
              <p className="today-plugin-empty">
                这件事项已删除，草稿仍会保留。
              </p>
              <button
                type="button"
                className="today-choose"
                onClick={() => setEditor(null)}
              >
                返回今天
              </button>
            </>
          )}
        </div>
      )}
      {mode === 'panel' && selected && (
        <FocusPicker
          key={selected.id + ':' + todayKey}
          task={selected}
          onClose={() => setSelectedId(null)}
          onDone={() => {
            setPicking(false);
            setFeedback('已放到今天的重点。');
          }}
        />
      )}
      {mode === 'panel' && picking && showList && (
        <section className="today-picker" aria-label="从已有安排中选择重点">
          <label className="today-search">
            <Icon name="search" size={17} />
            <input
              type="search"
              aria-label="搜索已有事项"
              placeholder="找一件已有的事…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="today-other-days">
            <input
              type="checkbox"
              checked={allDates}
              onChange={(event) => setAllDates(event.target.checked)}
            />
            也看其他日期
          </label>
          <ul className="today-candidates">
            {candidates.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(task.id);
                    setError('');
                  }}
                >
                  <span>{task.title}</span>
                  <time dateTime={task.date}>
                    {task.date === todayKey ? '今天' : task.date}
                    {task.time ? ' · ' + task.time : ''}
                  </time>
                  <Icon name="plus" size={15} />
                </button>
              </li>
            ))}
          </ul>
          {candidates.length === 0 && (
            <p className="today-plugin-empty">
              {query
                ? '没有找到，可以直接添一件。'
                : allDates
                  ? '暂时没有可选的安排。'
                  : '今天没有其他安排，勾选上方可查看其他日期。'}
            </p>
          )}
        </section>
      )}
      {mode === 'panel' && showList && (
        <div className="today-plugin-secondary">
          <details className="today-history">
            <summary>
              之前未完成{previous.length > 0 && <span>{previous.length}</span>}
            </summary>
            <p className="today-history-hint">
              挑一件带到今天，不着急全部搬过来。
            </p>
            <ul className="today-candidates">
              {previous.map((task) => (
                <li key={task.id}>
                  <button type="button" onClick={() => setSelectedId(task.id)}>
                    <span>{task.title}</span>
                    <time dateTime={task.date}>{task.date}</time>
                    <span className="today-carry-label">带到今天</span>
                  </button>
                </li>
              ))}
            </ul>
            {previous.length === 0 && (
              <p className="today-plugin-empty">没有留下的旧重点。</p>
            )}
          </details>
          <DataTools kind="tasks" />
        </div>
      )}
      {busyId && (
        <p className="today-plugin-status" role="status">
          正在保存…
        </p>
      )}
      {feedback && (
        <p className="today-plugin-status" role="status">
          {feedback}
        </p>
      )}
      {error && (
        <p className="today-plugin-error" role="alert">
          {error}
        </p>
      )}
      {snapshot.warning && (
        <p className="today-plugin-error" role="status">
          {snapshot.warning}
        </p>
      )}
    </div>
  );
}

export const todayPlugin: PluginDefinition = { manifest, Provider, View };
