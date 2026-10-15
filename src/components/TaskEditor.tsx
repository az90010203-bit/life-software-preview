import { useRef, useState, type FormEvent } from 'react';
import { useData, useDraft } from '../data/react';
import { DataError, type TaskRecord } from '../data/types';
import './plugin-ui.css';

type Props = {
  task?: TaskRecord;
  initialDate: string;
  initialText?: string;
  sourceNoteId?: string;
  focusDay?: string;
  onDone: (task: TaskRecord) => void;
  onCancel?: () => void;
};
type Fields = {
  id: string;
  title: string;
  date: string;
  time: string;
  details: string;
  baseRevision?: number;
};
const newId = () =>
  crypto.randomUUID?.() ??
  `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export default function TaskEditor(props: Props) {
  return (
    <Editor
      key={
        props.task?.id ??
        `${props.initialDate}:${props.sourceNoteId ?? ''}:${props.focusDay ?? ''}`
      }
      {...props}
    />
  );
}
function Editor({
  task,
  initialDate,
  initialText = '',
  sourceNoteId,
  focusDay,
  onDone,
  onCancel,
}: Props) {
  const { service, snapshot } = useData();
  const draftKey = task
    ? `task:edit:${task.id}`
    : `task:new:${sourceNoteId ?? initialDate}:${focusDay ?? ''}`;
  const [initial] = useState<Fields>(() => {
    const fallback = {
      id: task?.id ?? newId(),
      title: task?.title ?? initialText.trim().split(/\r?\n/)[0] ?? '',
      date: task?.date ?? focusDay ?? initialDate,
      time: task?.time ?? '',
      details: task?.details ?? initialText,
      baseRevision: task?.revision,
    };
    try {
      const stored = snapshot.drafts.find((draft) => draft.key === draftKey);
      const parsed: unknown = stored ? JSON.parse(stored.text) : undefined;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'title' in parsed &&
        typeof parsed.title === 'string'
      ) {
        const restored = parsed as Partial<Fields>;
        return {
          id: typeof restored.id === 'string' ? restored.id : fallback.id,
          title: parsed.title,
          date:
            typeof restored.date === 'string' ? restored.date : fallback.date,
          time: typeof restored.time === 'string' ? restored.time : '',
          details: typeof restored.details === 'string' ? restored.details : '',
          baseRevision:
            typeof restored.baseRevision === 'number'
              ? restored.baseRevision
              : fallback.baseRevision,
        };
      }
    } catch {
      /* Preserve the stored draft in export; start with safe fields. */
    }
    return fallback;
  });
  const [expected, setExpected] = useState(initial.baseRevision);
  const draft = useDraft(draftKey, JSON.stringify(initial), expected);
  let fields = initial;
  try {
    fields = { ...initial, ...JSON.parse(draft.value) };
  } catch {
    /* Loading draft. */
  }
  const [detailsOpen, setDetailsOpen] = useState(
    Boolean(fields.time || fields.details),
  );
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [replaceId, setReplaceId] = useState('');
  const focuses = focusDay
    ? (snapshot.focus[focusDay] ?? [])
        .map((id) => snapshot.tasks.find((item) => item.id === id))
        .filter((item): item is TaskRecord => Boolean(item && !item.deletedAt))
    : [];
  const full = Boolean(
    focusDay &&
    focuses.length >= 3 &&
    !focuses.some((item) => item.id === task?.id),
  );
  function change(patch: Partial<Fields>) {
    draft.setValue(JSON.stringify({ ...fields, ...patch }));
    setError('');
  }
  async function save(event?: FormEvent, copy = false) {
    event?.preventDefault();
    if (lock.current || !fields.title.trim()) return;
    if (full && !replaceId) {
      setError('选择一件要替换的重点。');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const values = {
        title: fields.title,
        date: focusDay ?? fields.date,
        time: fields.time || undefined,
        details: fields.details || undefined,
      };
      const result =
        task && !copy
          ? await service.updateTask(task.id, values, expected, draftKey)
          : await service.createTask(
              { ...values, id: copy ? newId() : fields.id, sourceNoteId },
              { focusDay, replaceId: replaceId || undefined, draftKey },
            );
      draft.setValue('');
      onDone(result);
    } catch (e) {
      setConflict(e instanceof DataError && e.code === 'conflict');
      setError(e instanceof Error ? e.message : '尚未保存，请保留输入重试。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function latest() {
    const current = snapshot.tasks.find(
      (item) => item.id === task?.id && !item.deletedAt,
    );
    if (!current) {
      setError('原事项已删除，可以将当前草稿保存为副本。');
      return;
    }
    setExpected(current.revision);
    draft.setValue(
      JSON.stringify({
        id: current.id,
        title: current.title,
        date: current.date,
        time: current.time ?? '',
        details: current.details ?? '',
        baseRevision: current.revision,
      }),
      current.revision,
    );
    setConflict(false);
    setError('');
  }
  return (
    <form
      className="pu-editor"
      aria-label={task ? '编辑事项' : '添加事项'}
      onSubmit={(event) => {
        void save(event);
      }}
      onKeyDown={(event) => {
        if (
          event.key === 'Enter' &&
          (event.ctrlKey || event.metaKey) &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          void save();
        }
        if (event.key === 'Escape' && !busy && !event.nativeEvent.isComposing) {
          event.stopPropagation();
          onCancel?.();
        }
      }}
    >
      <label className="pu-label">
        {task ? '编辑事项' : focusDay ? '选一件重要的事' : '安排一件事'}
        <input
          data-plugin-focus
          aria-label="事项标题"
          className="pu-input pu-task-title"
          placeholder="想做什么？"
          value={fields.title}
          onChange={(event) => change({ title: event.target.value })}
          disabled={busy}
          required
        />
      </label>
      <div className="pu-row">
        <label className="pu-label">
          日期
          <input
            aria-label="事项日期"
            className="pu-input"
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            value={focusDay ?? fields.date}
            disabled={Boolean(focusDay) || busy}
            onChange={(event) => change({ date: event.target.value })}
            required
          />
        </label>
        <button
          className="pu-link"
          type="button"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen(!detailsOpen)}
        >
          {detailsOpen ? '收起细节' : '时间与详情'}
        </button>
      </div>
      {detailsOpen && (
        <div className="pu-extra">
          <label className="pu-label">
            时间 · 选填
            <input
              className="pu-input"
              aria-label="事项时间"
              type="time"
              value={fields.time}
              disabled={busy}
              onChange={(event) => change({ time: event.target.value })}
            />
          </label>
          <label className="pu-label">
            详情 · 选填
            <textarea
              className="pu-input pu-textarea"
              aria-label="事项详情"
              rows={3}
              value={fields.details}
              disabled={busy}
              onChange={(event) => change({ details: event.target.value })}
            />
          </label>
        </div>
      )}
      {task &&
        task.date !== fields.date &&
        Object.values(snapshot.focus).some((ids) => ids.includes(task.id)) && (
          <p className="pu-hint">改期后会移出原日期的重点，事项仍然保留。</p>
        )}
      {full && (
        <fieldset className="pu-replace">
          <legend>今天已有三件重点，选择替换一件</legend>
          {focuses.map((item) => (
            <label key={item.id}>
              <input
                type="radio"
                name={`replace-${fields.id}`}
                checked={replaceId === item.id}
                onChange={() => setReplaceId(item.id)}
              />
              {item.title}
            </label>
          ))}
        </fieldset>
      )}
      {(error || draft.error) && (
        <p role="alert" className="pu-error">
          {error || draft.error}
        </p>
      )}
      {conflict && (
        <div className="pu-actions">
          <button
            className="pu-button"
            type="button"
            disabled={busy}
            onClick={() => {
              void save(undefined, true);
            }}
          >
            保存为副本
          </button>
          <button
            className="pu-button"
            type="button"
            disabled={busy}
            onClick={latest}
          >
            使用最新版本
          </button>
        </div>
      )}
      <div className="pu-actions">
        <span className="pu-hint">
          {draft.error
            ? '草稿暂存于此页'
            : draft.saved
              ? '草稿已保留'
              : '正在保留草稿…'}
        </span>
        {onCancel && (
          <button
            className="pu-button"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            收起
          </button>
        )}
        <button
          className="wc-primary-action"
          type="submit"
          disabled={
            busy ||
            !snapshot.ready ||
            !fields.title.trim() ||
            (full && !replaceId)
          }
        >
          {busy
            ? '保存中…'
            : task
              ? '保存修改'
              : focusDay
                ? '设为重点'
                : '添加事项'}
        </button>
      </div>
    </form>
  );
}
