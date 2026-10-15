import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { dateInMonth, localDateKey, validDateKey } from '../../platform/dates';
import { useLocalDay } from '../../platform/useLocalDay';
import { useData, useDraft } from '../../data/react';
import {
  DataError,
  type DayNoteRecord,
  type TaskRecord,
} from '../../data/types';
import { usePluginNavigation } from '../../platform/navigation';
import Icon from '../../components/Icons';
import TaskEditor from '../../components/TaskEditor';
import FocusPicker from '../../components/FocusPicker';
import DataTools from '../../components/DataTools';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function compareTasks(a: TaskRecord, b: TaskRecord) {
  return (
    Number(a.completed) - Number(b.completed) ||
    a.date.localeCompare(b.date) ||
    (a.time ?? '99:99').localeCompare(b.time ?? '99:99') ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

function dateFromKey(key: string) {
  return dateInMonth(
    Number(key.slice(0, 4)),
    Number(key.slice(5, 7)) - 1,
    Number(key.slice(8, 10)),
  );
}

function dateLabel(key: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(dateFromKey(key));
}

function DayNoteEditor({
  date,
  note,
  onDone,
}: {
  date: string;
  note?: DayNoteRecord;
  onDone: () => void;
}) {
  const { snapshot, service } = useData();
  const controlId = useId();
  const key = 'calendar.day-note:' + date;
  const [baseRevision] = useState(
    () =>
      snapshot.drafts.find((draft) => draft.key === key)?.baseRevision ??
      note?.revision ??
      0,
  );
  const draft = useDraft(key, note?.text ?? '', baseRevision);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save(appendToLatest = false) {
    if (busy) return;
    setBusy(true);
    try {
      const latest = appendToLatest
        ? service.getSnapshot().dayNotes.find((item) => item.date === date)
        : undefined;
      const text =
        appendToLatest && latest?.text
          ? latest.text + '\n\n' + draft.value
          : draft.value;
      await service.saveDayNote(
        date,
        text,
        appendToLatest ? (latest?.revision ?? 0) : baseRevision,
        key,
      );
      onDone();
    } catch (reason) {
      setConflict(reason instanceof DataError && reason.code === 'conflict');
      setError(
        reason instanceof Error
          ? reason.message
          : '当天备注暂未保存，请保留这段文字。',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="cal-note-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void save();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onDone();
        }
      }}
    >
      <label className="cal-eyebrow" htmlFor={controlId}>
        当天备注
      </label>
      <textarea
        id={controlId}
        aria-label={`${dateLabel(date)}的当天备注`}
        rows={3}
        value={draft.value}
        onChange={(event) => {
          draft.setValue(event.target.value);
          setError('');
        }}
        placeholder="这一天，还想记住什么？"
        autoFocus
      />
      <div className="cal-note-actions">
        <span className="cal-status">
          {draft.saved ? '草稿已暂存' : '正在暂存…'}
        </span>
        <button type="button" onClick={onDone}>
          稍后再写
        </button>
        <button
          type="submit"
          className="cal-gold"
          disabled={busy || !snapshot.ready}
        >
          {busy ? '保存中…' : '保存备注'}
        </button>
      </div>
      {(error || draft.error) && (
        <p className="cal-warning" role="alert">
          {error || draft.error}
        </p>
      )}
      {conflict && (
        <div className="cal-note-conflict">
          <p>草稿仍然保留。可以将它作为新的一段，追加在最新备注后面。</p>
          <button
            type="button"
            disabled={busy || !draft.value.trim()}
            onClick={() => void save(true)}
          >
            追加到最新备注
          </button>
        </div>
      )}
    </form>
  );
}

export default function Calendar() {
  const { snapshot, service } = useData();
  const { target } = usePluginNavigation();
  const today = useLocalDay();
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false);
  const [focusTask, setFocusTask] = useState<TaskRecord | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState<TaskRecord | null>(null);
  const dateButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusDate = useRef<string | null>(null);
  const handledTarget = useRef<number | null>(null);
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const tasks = snapshot.tasks.filter((task) => !task.deletedAt);
  const dayTasks = tasks
    .filter((task) => task.date === selected)
    .sort(compareTasks);
  const dayNote = snapshot.dayNotes.find((note) => note.date === selected);
  const editingTask = tasks.find((task) => task.id === editingId);
  const firstWeekday =
    (dateInMonth(month.year, month.month, 1).getDay() + 6) % 7;
  const cellCount =
    Math.ceil(
      (firstWeekday + dateInMonth(month.year, month.month + 1, 0).getDate()) /
        7,
    ) * 7;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = normalizedQuery
    ? tasks
        .filter((task) =>
          `${task.title}\n${task.details ?? ''}`
            .toLocaleLowerCase()
            .includes(normalizedQuery),
        )
        .sort(compareTasks)
    : [];
  const noteMatches = normalizedQuery
    ? snapshot.dayNotes
        .filter((note) =>
          note.text.toLocaleLowerCase().includes(normalizedQuery),
        )
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];

  function selectDate(key: string, focus = false) {
    if (!validDateKey(key)) return;
    const date = dateFromKey(key);
    setSelected(key);
    setMonth({ year: date.getFullYear(), month: date.getMonth() });
    setEditingId(null);
    setCreating(!tasks.some((task) => task.date === key));
    setNoteEditing(false);
    setError('');
    if (focus) focusDate.current = key;
  }

  useEffect(() => {
    if (!focusDate.current) return;
    dateButtons.current.get(focusDate.current)?.focus();
    focusDate.current = null;
  }, [selected, month]);

  useEffect(() => {
    if (!creating && !editingId) return;
    const frame = window.requestAnimationFrame(() =>
      panelRef.current
        ?.querySelector<HTMLInputElement>('[data-plugin-focus]')
        ?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [creating, editingId, selected]);

  useEffect(() => {
    if (
      !target ||
      target.pluginId !== 'calendar' ||
      handledTarget.current === target.requestId ||
      !snapshot.ready
    )
      return;
    handledTarget.current = target.requestId;
    const task = tasks.find((item) => item.id === target.taskId);
    const key =
      task?.date ??
      (target.date && validDateKey(target.date) ? target.date : today);
    selectDate(key);
    if (task) {
      setEditingId(task.id);
      setCreating(false);
    }
    if (target.taskId && !task)
      setError('这个事项暂时不在月历中，可以在最近删除里找回。');
    window.requestAnimationFrame(() =>
      panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' }),
    );
  }, [target, snapshot.ready]);

  function moveMonth(offset: number) {
    const next = dateInMonth(month.year, month.month + offset, 1);
    if (next.getFullYear() < 1 || next.getFullYear() > 9999) return;
    const desired = dateInMonth(
      next.getFullYear(),
      next.getMonth(),
      Math.min(
        dateFromKey(selected).getDate(),
        dateInMonth(next.getFullYear(), next.getMonth() + 1, 0).getDate(),
      ),
    );
    selectDate(localDateKey(desired));
    setCreating(false);
  }

  function onDateKeyDown(event: KeyboardEvent<HTMLButtonElement>, key: string) {
    if (event.nativeEvent.isComposing) return;
    const date = dateFromKey(key);
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -((date.getDay() + 6) % 7),
      End: 6 - ((date.getDay() + 6) % 7),
    };
    if (event.key in offsets) {
      event.preventDefault();
      selectDate(
        localDateKey(
          dateInMonth(
            date.getFullYear(),
            date.getMonth(),
            date.getDate() + offsets[event.key],
          ),
        ),
        true,
      );
      setCreating(false);
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      const offset =
        (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1);
      const next = dateInMonth(date.getFullYear(), date.getMonth() + offset, 1);
      if (next.getFullYear() < 1 || next.getFullYear() > 9999) return;
      const nextKey = localDateKey(
        dateInMonth(
          next.getFullYear(),
          next.getMonth(),
          Math.min(
            date.getDate(),
            dateInMonth(next.getFullYear(), next.getMonth() + 1, 0).getDate(),
          ),
        ),
      );
      selectDate(nextKey, true);
      setCreating(false);
    }
  }

  async function action(operation: () => Promise<void>) {
    setError('');
    try {
      await operation();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '这次修改暂未保存，请再试一次。',
      );
    }
  }

  return (
    <div className="cal-shell" ref={panelRef}>
      <div className="cal-toolbar">
        <h2 id={headingId}>
          {month.year}
          <span>年</span> {month.month + 1}
          <span>月</span>
        </h2>
        <div className="cal-month-actions">
          <button
            aria-label="上一月"
            onClick={() => moveMonth(-1)}
            disabled={month.year === 1 && month.month === 0}
          >
            ‹
          </button>
          <button
            className="cal-return-today"
            onClick={() => selectDate(today)}
          >
            今天
          </button>
          <button
            aria-label="下一月"
            onClick={() => moveMonth(1)}
            disabled={month.year === 9999 && month.month === 11}
          >
            ›
          </button>
          <button
            className={searching ? 'is-active' : ''}
            aria-label="搜索月历事项与备注"
            aria-expanded={searching}
            onClick={() => {
              setSearching(!searching);
              setQuery('');
            }}
          >
            <Icon name="search" size={18} />
          </button>
        </div>
      </div>
      {searching && (
        <div className="cal-search">
          <input
            aria-label="搜索事项和当天备注"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="找一件事，或某天的一句话"
            autoFocus
          />
          {normalizedQuery && (
            <div className="cal-search-results" aria-label="月历搜索结果">
              {matches.slice(0, 30).map((task) => (
                <button
                  key={task.id}
                  onClick={() => {
                    selectDate(task.date);
                    setEditingId(task.id);
                    setCreating(false);
                    setSearching(false);
                    setQuery('');
                  }}
                >
                  <time>{task.date.slice(5).replace('-', '/')}</time>
                  <span>{task.title}</span>
                </button>
              ))}
              {noteMatches.slice(0, 10).map((note) => (
                <button
                  key={note.date}
                  onClick={() => {
                    selectDate(note.date);
                    setCreating(false);
                    setNoteEditing(true);
                    setSearching(false);
                    setQuery('');
                  }}
                >
                  <time>{note.date.slice(5).replace('-', '/')}</time>
                  <span>{note.text}</span>
                  <small>备注</small>
                </button>
              ))}
              {matches.length + noteMatches.length === 0 && (
                <p className="cal-empty">还没有找到，换个词试试。</p>
              )}
              {matches.length > 30 && (
                <p className="cal-status">
                  先显示前 30 件，写得更具体可以缩小范围。
                </p>
              )}
            </div>
          )}
        </div>
      )}
      <div className="cal-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="cal-grid" role="group" aria-labelledby={headingId}>
        {Array.from({ length: cellCount }, (_, index) => {
          const day = index - firstWeekday + 1;
          const date = dateInMonth(month.year, month.month, day);
          const key = localDateKey(date);
          const outside = date.getMonth() !== month.month;
          const cellTasks = tasks
            .filter((task) => task.date === key)
            .sort(compareTasks);
          const count = cellTasks.length;
          const hasNote = snapshot.dayNotes.some(
            (note) => note.date === key && note.text.trim(),
          );
          return (
            <button
              key={key}
              ref={(node) => {
                if (node) dateButtons.current.set(key, node);
                else dateButtons.current.delete(key);
              }}
              className={
                'cal-day' +
                (outside ? ' is-outside' : '') +
                (key === today ? ' is-today' : '') +
                (key === selected ? ' is-selected' : '')
              }
              aria-label={`${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日${key === today ? '，今天' : ''}，${count ? count + '件事项' : '没有事项'}${hasNote ? '，有当天备注' : ''}`}
              aria-current={key === today ? 'date' : undefined}
              aria-pressed={key === selected}
              tabIndex={key === selected ? 0 : -1}
              disabled={!validDateKey(key)}
              onClick={() => {
                selectDate(key);
                window.requestAnimationFrame(() =>
                  panelRef.current
                    ?.querySelector('.cal-day-panel')
                    ?.scrollIntoView({ block: 'start', behavior: 'auto' }),
                );
              }}
              onKeyDown={(event) => onDateKeyDown(event, key)}
            >
              <span className="cal-day-number">
                {date.getDate()}
                {count > 0 && (
                  <small className="cal-day-count" aria-hidden="true">
                    {count}
                  </small>
                )}
              </span>
              <span
                className={
                  'cal-day-summary' +
                  (cellTasks[0]?.completed ? ' is-completed' : '')
                }
                aria-hidden="true"
              >
                {cellTasks[0]?.title ?? ''}
              </span>
              <i
                aria-hidden="true"
                className={
                  (count ? 'has-tasks' : '') + (hasNote ? ' has-note' : '')
                }
              >
                {count > 3 ? (
                  <b />
                ) : (
                  Array.from({ length: count }, (_, dot) => <b key={dot} />)
                )}
                {hasNote && !count && <b />}
              </i>
            </button>
          );
        })}
      </div>
      <section
        className="cal-day-panel"
        aria-label={`${dateLabel(selected)}的安排`}
      >
        <header className="cal-day-heading">
          <div>
            <span className="cal-eyebrow">
              {selected === today
                ? '今天'
                : selected < today
                  ? '那一天'
                  : '接下来'}
            </span>
            <h3>{dateLabel(selected)}</h3>
          </div>
          <button
            className="cal-add-task"
            disabled={!snapshot.ready}
            onClick={() => {
              setEditingId(null);
              setCreating(true);
            }}
          >
            <Icon name="plus" size={16} />
            <span>写一件</span>
          </button>
        </header>
        {!snapshot.ready ? (
          <p className="cal-empty" role="status">
            正在打开你的安排…
          </p>
        ) : (
          dayTasks.length === 0 &&
          !creating && (
            <button className="cal-empty-add" onClick={() => setCreating(true)}>
              这天还没有安排。点这里，写一件就好。
            </button>
          )
        )}
        <ul className="cal-task-list">
          {dayTasks.map((task) => (
            <li
              key={task.id}
              className={'cal-task' + (task.completed ? ' is-completed' : '')}
            >
              <button
                className="cal-task-check"
                role="checkbox"
                aria-checked={task.completed}
                aria-label={(task.completed ? '取消完成' : '完成') + task.title}
                disabled={!snapshot.ready}
                onClick={() =>
                  void action(() =>
                    service.toggleTask(task.id, !task.completed),
                  )
                }
              >
                {task.completed && <Icon name="check" size={16} />}
              </button>
              <button
                className="cal-task-content"
                onClick={() => {
                  setEditingId(editingId === task.id ? null : task.id);
                  setCreating(false);
                }}
                aria-expanded={editingId === task.id}
              >
                <span className="cal-task-title">{task.title}</span>
                <span className="cal-task-meta">
                  {task.time ?? '时间随心'}
                  {snapshot.focus[today]?.includes(task.id)
                    ? ' · 今日重点'
                    : ''}
                </span>
              </button>
              <button
                className="cal-task-more"
                aria-label={'将' + task.title + '列为重点'}
                title="列为重点"
                onClick={() => setFocusTask(task)}
              >
                <Icon name="today" size={17} />
              </button>
              {editingId === task.id && (
                <div className="cal-inline-editor">
                  <TaskEditor
                    task={editingTask}
                    initialDate={selected}
                    onDone={(saved) => {
                      selectDate(saved.date);
                      setCreating(false);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                  <button
                    className="cal-delete"
                    onClick={() =>
                      void action(async () => {
                        await service.deleteTask(task.id);
                        setDeleted(task);
                        setEditingId(null);
                      })
                    }
                  >
                    删除这件事
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {creating && snapshot.ready && (
          <div className="cal-new-task">
            <TaskEditor
              key={'new:' + selected}
              initialDate={selected}
              onDone={(saved) => {
                selectDate(saved.date);
                setCreating(false);
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        )}
        {deleted && (
          <div className="cal-undo" role="status">
            <span>已放入最近删除</span>
            <button
              onClick={() =>
                void action(async () => {
                  await service.restoreTask(deleted.id);
                  setDeleted(null);
                })
              }
            >
              撤销
            </button>
            <button aria-label="关闭删除提示" onClick={() => setDeleted(null)}>
              <Icon name="close" size={13} />
            </button>
          </div>
        )}
        <div className="cal-day-note">
          {noteEditing ? (
            <DayNoteEditor
              key={selected}
              date={selected}
              note={dayNote}
              onDone={() => setNoteEditing(false)}
            />
          ) : (
            <button
              className="cal-note-preview"
              onClick={() => setNoteEditing(true)}
              disabled={!snapshot.ready}
            >
              <span className="cal-eyebrow">
                当天备注
                {snapshot.drafts.some(
                  (draft) =>
                    draft.key === 'calendar.day-note:' + selected &&
                    draft.text !== dayNote?.text,
                )
                  ? ' · 有未完成草稿'
                  : ''}
              </span>
              <span className={dayNote?.text ? '' : 'cal-note-placeholder'}>
                {dayNote?.text ?? '留一句话，不一定是一件事。'}
              </span>
              <Icon name="pen" size={15} />
            </button>
          )}
        </div>
        {(error || snapshot.warning) && (
          <p className="cal-warning" role="alert">
            {error || snapshot.warning}
          </p>
        )}
      </section>
      {focusTask && (
        <FocusPicker
          task={
            snapshot.tasks.find((task) => task.id === focusTask.id) ?? focusTask
          }
          onClose={() => setFocusTask(null)}
          onDone={() => {
            setFocusTask(null);
            selectDate(today);
            setCreating(false);
          }}
        />
      )}
      <div className="cal-tools">
        <DataTools kind="tasks" />
      </div>
    </div>
  );
}
