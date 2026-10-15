import { useState } from 'react';
import { useData } from '../data/react';
import './plugin-ui.css';
export default function DataTools({ kind }: { kind: 'notes' | 'tasks' }) {
  const { service, snapshot } = useData();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const deleted = (kind === 'notes' ? snapshot.notes : snapshot.tasks).filter(
    (item) => item.deletedAt,
  );
  async function restore(id: string) {
    setBusy(true);
    setError('');
    try {
      if (kind === 'notes') await service.restoreNote(id);
      else await service.restoreTask(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '恢复失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setBusy(true);
    setError('');
    try {
      const json = await service.exportData();
      const url = URL.createObjectURL(
        new Blob([json], { type: 'application/json' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `人生-插件备份-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败，请先复制当前输入。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="pu-data-tools">
      <summary>更多</summary>
      <div className="pu-data-body">
        <button
          className="pu-button"
          disabled={busy}
          onClick={() => {
            void download();
          }}
        >
          导出插件数据
        </button>
        <details>
          <summary>
            最近删除 <span>{deleted.length}</span>
          </summary>
          {deleted.length ? (
            <ul className="pu-deleted-list">
              {deleted.map((item) => (
                <li key={item.id}>
                  <span>{'text' in item ? item.text : item.title}</span>
                  <button
                    className="pu-link"
                    disabled={busy}
                    onClick={() => {
                      void restore(item.id);
                    }}
                  >
                    恢复
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pu-hint">这里暂时没有删除的内容。</p>
          )}
          {kind === 'tasks' && deleted.length > 0 && (
            <p className="pu-hint">恢复后保留原日期，可再手动选为重点。</p>
          )}
        </details>
        {error && (
          <p role="alert" className="pu-error">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
