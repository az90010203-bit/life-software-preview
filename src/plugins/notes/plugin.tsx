import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type TextareaHTMLAttributes,
} from 'react';
import Icon from '../../components/Icons';
import TaskEditor from '../../components/TaskEditor';
import DataTools from '../../components/DataTools';
import { useData, useDraft } from '../../data/react';
import { DataError, type NoteRecord } from '../../data/types';
import { usePluginNavigation } from '../../platform/navigation';
import { useLocalDay } from '../../platform/useLocalDay';
import type { PluginDefinition, PluginViewProps } from '../../platform/plugins';
import { findNotes, groupNotesByDay, noteDayLabel } from './helpers';
import { manifest } from './manifest';
import './notes.css';

export { stateSpec } from './legacy';

function Provider({ children }: PropsWithChildren) {
  return <>{children}</>;
}

function messageFor(error: unknown) {
  return error instanceof Error
    ? error.message
    : '暂时没能保存，输入内容已保留，请再试一次。';
}

function AutoTextarea({
  value,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    function resize() {
      if (!field) return;
      field.style.height = '0px';
      field.style.height = `${Math.max(64, Math.min(field.scrollHeight, 190))}px`;
    }
    resize();
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return;
      width = field.clientWidth;
      resize();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [value]);
  return (
    <textarea
      {...props}
      ref={ref}
      value={value}
      rows={2}
      className={'np-textarea ' + (props.className ?? '')}
    />
  );
}

function Compose() {
  const { snapshot, service } = useData();
  const draft = useDraft('notes:new');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const id = useId();
  async function save() {
    if (!snapshot.ready || busyRef.current || !draft.value.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await service.createNote(draft.value, 'notes:new');
      draft.setValue('');
      setFeedback('这段想法已收好。');
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="np-compose"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="np-eyebrow" htmlFor={id}>
        先放在这里
      </label>
      <AutoTextarea
        id={id}
        data-plugin-focus
        aria-label="随手记内容"
        placeholder="想到什么，记一句就好。"
        value={draft.value}
        disabled={busy || !snapshot.ready}
        onChange={(event) => {
          draft.setValue(event.target.value);
          setFeedback('');
          setError('');
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            (event.ctrlKey || event.metaKey) &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            void save();
          }
        }}
      />
      <div className="np-compose-footer">
        <span className="np-draft-status" role="status">
          {error ||
            draft.error ||
            feedback ||
            (draft.value
              ? draft.saved
                ? '草稿已保留'
                : '正在保留草稿…'
              : '无需标题，也不用先整理。')}
        </span>
        <button
          type="submit"
          className="wc-primary-action np-save"
          disabled={busy || !snapshot.ready || !draft.value.trim()}
        >
          {busy ? '正在收好…' : '收好片段'}
        </button>
      </div>
    </form>
  );
}

function NoteEditor({
  note,
  onClose,
}: {
  note: NoteRecord;
  onClose: () => void;
}) {
  const { snapshot, service } = useData();
  const draftKey = `notes:edit:${note.id}`;
  const [revision, setRevision] = useState(
    () =>
      snapshot.drafts.find((draft) => draft.key === draftKey)?.baseRevision ??
      note.revision,
  );
  const draft = useDraft(draftKey, note.text, revision);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [loadLatest, setLoadLatest] = useState(false);
  const changedElsewhere =
    Boolean(note.deletedAt) || revision !== note.revision;
  const id = useId();

  useEffect(() => {
    if (!loadLatest) return;
    draft.setValue(note.text);
    setLoadLatest(false);
  }, [loadLatest, note.text, draft.setValue]);

  async function save(asCopy = false) {
    if (busyRef.current || !draft.value.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      if (asCopy) await service.createNote(draft.value, draftKey);
      else await service.updateNote(note.id, draft.value, revision, draftKey);
      draft.setValue('');
      onClose();
    } catch (reason) {
      if (reason instanceof DataError && reason.code === 'conflict')
        setConflict(true);
      else setError(messageFor(reason));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="np-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!changedElsewhere && !conflict) void save();
      }}
    >
      <label className="np-visually-hidden" htmlFor={id}>
        编辑片段
      </label>
      <AutoTextarea
        id={id}
        aria-label="编辑片段内容"
        value={draft.value}
        disabled={busy}
        autoFocus
        onChange={(event) => {
          draft.setValue(event.target.value);
          setError('');
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            (event.ctrlKey || event.metaKey) &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            if (!changedElsewhere && !conflict) void save();
          }
        }}
      />
      {(changedElsewhere || conflict) && (
        <div className="np-conflict" role="alert">
          <p>
            {note.deletedAt
              ? '原片段已移到回收站。你的修改还在，可以另存一份。'
              : '这段记录已有更新。你的修改还在，可以另存一份。'}
          </p>
          <div className="np-actions">
            <button
              type="button"
              className="np-pill"
              disabled={busy || !draft.value.trim()}
              onClick={() => void save(true)}
            >
              保存副本
            </button>
            {!note.deletedAt && (
              <button
                type="button"
                className="np-text-button"
                disabled={busy}
                onClick={() => {
                  setRevision(note.revision);
                  setLoadLatest(true);
                  setConflict(false);
                  setError('');
                }}
              >
                使用最新版本
              </button>
            )}
          </div>
        </div>
      )}
      <div className="np-editor-footer">
        <span className="np-draft-status" role="status">
          {error ||
            draft.error ||
            (draft.saved ? '编辑草稿已保留' : '正在保留草稿…')}
        </span>
        <div className="np-actions">
          <button
            type="button"
            className="np-text-button"
            disabled={busy}
            onClick={onClose}
          >
            收起
          </button>
          <button
            type="submit"
            className="np-pill np-pill--gold"
            disabled={
              busy || !draft.value.trim() || changedElsewhere || conflict
            }
          >
            {busy ? '保存中…' : '保存修改'}
          </button>
        </div>
      </div>
    </form>
  );
}

function NoteItem({
  note,
  onDelete,
  onArrange,
  deleting,
  editing,
  onEditingChange,
}: {
  note: NoteRecord;
  onDelete: (note: NoteRecord) => void;
  onArrange: (note: NoteRecord, focus: boolean) => void;
  deleting: boolean;
  editing: boolean;
  onEditingChange: (value: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [long, setLong] = useState(
    note.text.length > 220 || note.text.split('\n').length > 4,
  );
  const textRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;
    function measure() {
      if (!text) return;
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 23.4;
      setLong(text.scrollHeight > lineHeight * 4 + 1);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => observer.disconnect();
  }, [note.text, expanded, editing]);
  return (
    <li className="np-note" data-note-id={note.id}>
      <div className="np-note-top">
        <time dateTime={note.createdAt}>
          {new Intl.DateTimeFormat('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(note.createdAt))}
        </time>
        {note.updatedAt !== note.createdAt && (
          <span className="np-edited">已编辑</span>
        )}
        {!editing && (
          <details className="np-menu">
            <summary aria-label="片段更多操作">•••</summary>
            <button
              type="button"
              disabled={deleting}
              onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                onDelete(note);
              }}
            >
              移到回收站
            </button>
          </details>
        )}
      </div>
      {editing ? (
        <NoteEditor note={note} onClose={() => onEditingChange(false)} />
      ) : (
        <>
          <p
            ref={textRef}
            className={'np-note-text' + (!expanded ? ' is-collapsed' : '')}
          >
            {note.text}
          </p>
          {long && (
            <button
              type="button"
              className="np-text-button np-expand"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '收起全文' : '展开全文'}
            </button>
          )}
          <div className="np-note-actions">
            <button
              type="button"
              className="np-text-button"
              onClick={() => onEditingChange(true)}
            >
              <Icon name="pen" size={13} />
              编辑
            </button>
            <button
              type="button"
              className="np-text-button"
              onClick={() => onArrange(note, false)}
            >
              <Icon name="calendar" size={13} />
              安排
            </button>
            <button
              type="button"
              className="np-text-button"
              onClick={() => onArrange(note, true)}
            >
              <Icon name="today" size={13} />
              今日重点
            </button>
          </div>
        </>
      )}
    </li>
  );
}

function View({ mode }: PluginViewProps) {
  const { snapshot, service } = useData();
  const { openPlugin } = usePluginNavigation();
  const today = useLocalDay();
  const [query, setQuery] = useState('');
  const [editingIds, setEditingIds] = useState<string[]>([]);
  const [arrange, setArrange] = useState<{
    note: NoteRecord;
    focus: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const mutationRef = useRef(false);
  const [undo, setUndo] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const active = useMemo(() => findNotes(snapshot.notes), [snapshot.notes]);
  const visible = useMemo(
    () => findNotes(snapshot.notes, query),
    [snapshot.notes, query],
  );
  const groups = useMemo(() => {
    const retained = snapshot.notes.filter(
      (note) => note.deletedAt && editingIds.includes(note.id),
    );
    return groupNotesByDay(
      [...visible, ...retained].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    );
  }, [visible, snapshot.notes, editingIds]);
  const searchId = useId();

  async function remove(note: NoteRecord) {
    if (mutationRef.current) return;
    mutationRef.current = true;
    setDeleting(note.id);
    setError('');
    try {
      await service.deleteNote(note.id);
      setUndo(note.id);
      setFeedback('片段已移到回收站。');
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      mutationRef.current = false;
      setDeleting(null);
    }
  }
  async function restore() {
    if (!undo || mutationRef.current) return;
    mutationRef.current = true;
    setError('');
    try {
      await service.restoreNote(undo);
      setUndo(null);
      setFeedback('片段已恢复。');
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      mutationRef.current = false;
    }
  }

  if (mode === 'card')
    return (
      <div className="np-card">
        <ol aria-label="最近收好的片段" className="np-card-list">
          {active.slice(0, 2).map((note) => (
            <li key={note.id}>
              <button type="button" onClick={() => openPlugin('notes')}>
                {note.text}
              </button>
            </li>
          ))}
        </ol>
        {active.length === 0 && (
          <p className="np-empty">有个想法？先留一句。</p>
        )}
        <button
          type="button"
          className="np-text-button np-card-compose"
          onClick={() => openPlugin('notes', { action: 'add' })}
        >
          <Icon name="plus" size={15} />
          记一下
        </button>
      </div>
    );

  return (
    <div className="np-panel">
      <Compose />
      <div className="np-library-toolbar">
        <div className="np-search">
          <Icon name="search" size={16} />
          <label className="np-visually-hidden" htmlFor={searchId}>
            搜索片段
          </label>
          <input
            id={searchId}
            type="search"
            placeholder="找回一个想法…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索片段"
          />
        </div>
        <span className="np-count">
          {query.trim()
            ? `${visible.length} / ${active.length}`
            : active.length}{' '}
          条
        </span>
        <DataTools kind="notes" />
      </div>
      {(feedback || error) && (
        <div
          className={'np-feedback' + (error ? ' is-error' : '')}
          role={error ? 'alert' : 'status'}
        >
          <span>{error || feedback}</span>
          {undo && !error && (
            <button
              type="button"
              className="np-text-button"
              onClick={() => void restore()}
            >
              撤销
            </button>
          )}
        </div>
      )}
      <div className="np-records" aria-label="收好的片段">
        {groups.map(({ day, entries }) => (
          <section className="np-day" key={day}>
            <h3 className="np-day-label">
              {noteDayLabel(day)}
              <span>{entries.length}</span>
            </h3>
            <ol className="np-notes-list">
              {entries.map((note) => (
                <NoteItem
                  key={note.id}
                  note={note}
                  deleting={deleting === note.id}
                  editing={editingIds.includes(note.id)}
                  onEditingChange={(value) =>
                    setEditingIds((ids) =>
                      value
                        ? [...ids.filter((id) => id !== note.id), note.id]
                        : ids.filter((id) => id !== note.id),
                    )
                  }
                  onDelete={(record) => void remove(record)}
                  onArrange={(record, focus) => {
                    setArrange({ note: record, focus });
                    setError('');
                  }}
                />
              ))}
            </ol>
          </section>
        ))}
        {groups.length === 0 && (
          <p className="np-empty">
            {!snapshot.ready
              ? '正在取回你的片段…'
              : query.trim()
                ? '没有找到，试试别的关键词。'
                : '还没有收好的片段。写一句，就从这里开始。'}
          </p>
        )}
      </div>
      {arrange && (
        <div className="np-task-sheet">
          <TaskEditor
            initialDate={today}
            initialText={arrange.note.text}
            sourceNoteId={arrange.note.id}
            focusDay={arrange.focus ? today : undefined}
            onDone={() => {
              setFeedback(
                arrange.focus
                  ? '已加入今日重点，原片段还在。'
                  : '已安排，原片段还在。',
              );
              setArrange(null);
              setUndo(null);
            }}
            onCancel={() => setArrange(null)}
          />
        </div>
      )}
      {snapshot.warning && (
        <p className="np-warning" role="status">
          {snapshot.warning}
        </p>
      )}
    </div>
  );
}

function Status() {
  const { snapshot } = useData();
  const count = snapshot.notes.filter((note) => !note.deletedAt).length;
  return (
    <>
      <span className="latin">{String(count).padStart(2, '0')}</span>
      <span>片段</span>
    </>
  );
}

export const notesPlugin: PluginDefinition = {
  manifest,
  Provider,
  View,
  Status,
};
