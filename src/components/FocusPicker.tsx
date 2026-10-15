import { useId, useRef, useState } from 'react';
import { useData } from '../data/react';
import type { TaskRecord } from '../data/types';
import { useLocalDay } from '../platform/useLocalDay';
import './focus-picker.css';

type Props = {
  task: TaskRecord;
  onClose: () => void;
  onDone?: () => void;
};

/** This confirmation never mutates a task until the final submit. */
export default function FocusPicker({ task, onClose, onDone }: Props) {
  const { snapshot, service } = useData();
  const todayKey = useLocalDay();
  const headingId = useId();
  const radioName = useId();
  const [confirmedDate, setConfirmedDate] = useState('');
  const [replaceId, setReplaceId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const current = snapshot.tasks.find((item) => item.id === task.id) ?? task;
  const focused = (snapshot.focus[todayKey] ?? [])
    .map((id) => snapshot.tasks.find((item) => item.id === id))
    .filter((item): item is TaskRecord => !!item && !item.deletedAt);
  const alreadyFocused = focused.some((item) => item.id === current.id);
  const needsMove = current.date !== todayKey;
  const confirmationKey = `${todayKey}:${current.date}`;
  const full = focused.length >= 3 && !alreadyFocused;
  const replacementValid = focused.some((item) => item.id === replaceId);

  async function submit() {
    if (
      saving.current ||
      current.deletedAt ||
      (needsMove && confirmedDate !== confirmationKey)
    )
      return;
    if (full && !replacementValid) return;
    if (alreadyFocused) {
      onDone?.();
      onClose();
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await service.setFocus(todayKey, current.id, {
        moveToDay: true,
        expectedDate: current.date,
        replaceId: full ? replaceId : undefined,
      });
      onDone?.();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '没有保存成功，请再试一次。',
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="focus-picker" aria-labelledby={headingId}>
      <div className="focus-picker-heading">
        <span className="focus-picker-orbit" aria-hidden="true">
          ✦
        </span>
        <div>
          <h3 id={headingId}>放到今天的重点</h3>
          <p>给重要的事，留一个位置。</p>
        </div>
      </div>
      <p className="focus-picker-task">{current.title}</p>
      {current.deletedAt ? (
        <p role="status">这件事项已删除，请先恢复。</p>
      ) : alreadyFocused ? (
        <p className="focus-picker-hint">它已经在今天的重点里了。</p>
      ) : (
        <>
          {needsMove && (
            <label className="focus-picker-confirm">
              <input
                type="checkbox"
                checked={confirmedDate === confirmationKey}
                disabled={busy}
                onChange={(event) =>
                  setConfirmedDate(event.target.checked ? confirmationKey : '')
                }
              />
              <span>
                将日期从 <time dateTime={current.date}>{current.date}</time>{' '}
                改为今天；月历会同步调整。
              </span>
            </label>
          )}
          {full && (
            <fieldset className="focus-picker-replacements" disabled={busy}>
              <legend>三个位置已满，选择要替换的重点</legend>
              {focused.map((item) => (
                <label key={item.id}>
                  <input
                    name={radioName}
                    type="radio"
                    checked={replaceId === item.id}
                    onChange={() => setReplaceId(item.id)}
                  />
                  <span>
                    {item.completed && (
                      <span className="focus-picker-completed">已完成 · </span>
                    )}
                    {item.title}
                  </span>
                </label>
              ))}
              <p>被替换的事项仍保留在月历中。</p>
            </fieldset>
          )}
        </>
      )}
      {error && (
        <p className="focus-picker-error" role="alert">
          {error}
        </p>
      )}
      <div className="focus-picker-actions">
        <button
          type="button"
          className="focus-picker-cancel"
          disabled={busy}
          onClick={onClose}
        >
          取消
        </button>
        <button
          type="button"
          className="wc-primary-action"
          disabled={
            !snapshot.ready ||
            busy ||
            !!current.deletedAt ||
            (!alreadyFocused &&
              ((needsMove && confirmedDate !== confirmationKey) ||
                (full && !replacementValid)))
          }
          onClick={submit}
        >
          {busy
            ? '正在保存…'
            : alreadyFocused
              ? '知道了'
              : full
                ? '替换并加入'
                : '加入今日重点'}
        </button>
      </div>
    </section>
  );
}
