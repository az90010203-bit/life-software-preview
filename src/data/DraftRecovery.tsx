import { useState } from 'react';
import { useData } from './react';
import type { RecoverableDraft } from './types';
import '../components/plugin-ui.css';

function draftLabel(draft: RecoverableDraft) {
  if (draft.key.startsWith('notes:new')) return '随手记草稿';
  if (draft.key.startsWith('notes:edit:')) return '片段修改草稿';
  if (draft.key.startsWith('task:')) return '事项草稿';
  if (draft.key.startsWith('calendar.day-note:')) return '当天备注草稿';
  return '未完成草稿';
}

function preview(draft: RecoverableDraft) {
  if (draft.key.startsWith('task:')) {
    try {
      const value: unknown = JSON.parse(draft.text);
      if (
        value &&
        typeof value === 'object' &&
        'title' in value &&
        typeof value.title === 'string'
      ) {
        const fields = value as Record<string, unknown>;
        return [value.title, fields.date, fields.time, fields.details]
          .filter((item) => typeof item === 'string' && item)
          .join('\n');
      }
    } catch {
      /* An unfamiliar draft is still available in its original form. */
    }
  }
  return draft.text;
}

export default function DraftRecovery() {
  const { service, snapshot } = useData();
  const [drafts, setDrafts] = useState<RecoverableDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setDrafts(await service.listRecoverableDrafts());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '暂时无法查看本机草稿，原内容没有改动。',
      );
    } finally {
      setLoading(false);
    }
  }
  async function recover(draft: RecoverableDraft) {
    if (recovering) return;
    setRecovering(draft.id);
    setError('');
    setFeedback('');
    try {
      await service.recoverDraft(draft.id, {
        text: draft.text,
        updatedAt: draft.updatedAt,
      });
      setFeedback('已另存为随手记，原窗口的草稿和当前输入仍然保留。');
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '这份草稿暂未找回，原内容仍然保留。',
      );
    } finally {
      setRecovering('');
    }
  }
  return (
    <details
      className="pu-data-tools draft-recovery"
      onToggle={(event) => {
        if (event.currentTarget.open) void refresh();
      }}
    >
      <summary>找回本机草稿</summary>
      <div className="pu-data-body">
        <p className="pu-hint">
          这里可能包含其他窗口的草稿。找回会另存为随手记，原草稿和当前输入都保留。
        </p>
        <button
          type="button"
          className="pu-link"
          disabled={loading || !!recovering}
          onClick={() => void refresh()}
        >
          {loading ? '正在查看…' : '重新查看'}
        </button>
        {!loading && !error && drafts.length === 0 && (
          <p className="pu-hint">没有需要找回的草稿。</p>
        )}
        {drafts.map((draft) => (
          <article
            key={draft.id}
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 14,
              background: '#edf2f5',
            }}
          >
            <div className="pu-row">
              <span className="pu-label">{draftLabel(draft)}</span>
              <time className="pu-hint" dateTime={draft.updatedAt}>
                {new Intl.DateTimeFormat('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(draft.updatedAt))}
              </time>
            </div>
            <p
              style={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                fontSize: 12,
                lineHeight: 1.8,
                maxHeight: 150,
                overflow: 'auto',
                color: '#536f7e',
              }}
            >
              {preview(draft).slice(0, 500)}
              {preview(draft).length > 500 ? '…' : ''}
            </p>
            <div className="pu-actions">
              <button
                type="button"
                className="pu-button"
                disabled={!snapshot.ready || !!recovering}
                onClick={() => void recover(draft)}
              >
                {recovering === draft.id ? '正在找回…' : '找回为片段'}
              </button>
            </div>
          </article>
        ))}
        {feedback && (
          <p role="status" className="pu-hint">
            {feedback}
          </p>
        )}
        {error && (
          <p role="alert" className="pu-error">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
