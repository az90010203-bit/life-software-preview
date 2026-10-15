import { useState } from 'react';
import { useCloud } from './react';
import { useData } from '../data/react';
import PwaInstallHelp from '../pwa/PwaInstallHelp';
import DraftRecovery from '../data/DraftRecovery';
import './account.css';
import type { EntityData, EntityKind } from '../data/sync-types';
function readable(
  kind: EntityKind,
  data: EntityData | null,
  titles: Map<string, string>,
) {
  if (!data) return '这条内容已删除。';
  if (kind === 'focus')
    return Array.isArray(data.ids)
      ? data.ids
          .map((id) => titles.get(String(id)) ?? '一件待确认的事')
          .join('\n') || '没有选择重点。'
      : '重点顺序已有变化。';
  if (kind === 'tasks')
    return [
      data.deletedAt ? '已移入最近删除' : '',
      data.title,
      [data.date, data.time].filter(Boolean).join(' · '),
      data.completed ? '已完成' : '',
      data.details,
    ]
      .filter(Boolean)
      .join('\n');
  return [data.deletedAt ? '已移入最近删除' : '', data.text]
    .filter(Boolean)
    .join('\n');
}
export function cloudLabel(state: ReturnType<typeof useCloud>['state']) {
  if (state.status === 'unconfigured') return '仅保存在此设备';
  if (state.status === 'signed-out') return '未登录';
  if (!state.canUse)
    return state.status === 'import'
      ? '等待确认导入'
      : state.status === 'loading'
        ? '正在打开'
        : '账号待验证';
  if (state.status === 'syncing') return '正在同步';
  if (state.local.conflicts.length)
    return `${state.local.conflicts.length} 项待确认`;
  if (state.local.pending) return `${state.local.pending} 项待同步`;
  if (state.status === 'idle') return '已同步';
  if (state.status === 'offline') return '离线模式';
  return '连接云端';
}
function SignIn() {
  const { controller } = useCloud();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="account-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        void controller
          .signIn(email, password)
          .then(
            () => setPassword(''),
            (e) => setError(e instanceof Error ? e.message : '登录未完成。'),
          )
          .finally(() => setBusy(false));
      }}
    >
      <label>
        邮箱
        <input
          aria-label="私人账号邮箱"
          autoComplete="username"
          inputMode="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        密码
        <input
          aria-label="私人账号密码"
          autoComplete="current-password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
      </label>
      <button type="submit" className="wc-primary-action" disabled={busy}>
        {busy ? '登录中…' : '进入私人空间'}
      </button>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      <p className="account-caption">
        仅支持已开通的私人账号。首次账号设置与密码恢复由你的云端管理后台完成。
      </p>
    </form>
  );
}
export default function AccountPanel() {
  const { controller, state } = useCloud();
  const { service, snapshot } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titles = new Map(snapshot.tasks.map((task) => [task.id, task.title]));
  const counts = service.getImportCounts();
  function run(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    void operation()
      .catch((e) =>
        setError(e instanceof Error ? e.message : '操作未完成，内容仍保留。'),
      )
      .finally(() => setBusy(false));
  }
  return (
    <div className="account-panel">
      <header>
        <span className="account-eyebrow">PERSONAL CLOUD</span>
        <h2>你的私人空间</h2>
        <p className="account-sync-state" role="status">
          {cloudLabel(state)}
        </p>
      </header>
      {state.status === 'loading' && (
        <p className="account-caption">正在打开本地记录和登录状态…</p>
      )}
      {state.status === 'unconfigured' ? (
        <p className="account-notice">
          云端服务尚未连接。现在可以离线记录和安装到主屏幕；记录仅保存在此设备，尚未上传或跨设备同步。
        </p>
      ) : !state.user ? (
        <SignIn />
      ) : (
        <>
          <div className="account-identity">
            <span>{state.user.email}</span>
            <button
              type="button"
              className="pu-link"
              disabled={busy}
              onClick={() => run(controller.signOut)}
            >
              退出登录
            </button>
          </div>
          {state.status === 'import' ? (
            <div className="account-import">
              <h3>把这台设备的记录带上云端</h3>
              <p>
                {counts.notes} 条片段 · {counts.tasks} 件事项 ·{' '}
                {counts.dayNotes} 天备注 · {counts.focus} 天重点
              </p>
              <p className="account-caption">
                包含最近删除和历史记录。保留原记录和草稿，重复导入不会增加副本。
              </p>
              <button
                type="button"
                className="wc-primary-action"
                disabled={busy}
                onClick={() => run(controller.confirmImport)}
              >
                确认导入此私人账号
              </button>
            </div>
          ) : state.canUse ? (
            <>
              <div className="account-actions">
                <button
                  type="button"
                  className="pu-button"
                  disabled={busy || state.status === 'syncing'}
                  onClick={() => run(controller.retry)}
                >
                  立即同步
                </button>
                <span className="account-caption">
                  {state.local.lastSyncedAt
                    ? `最近同步 ${new Date(state.local.lastSyncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                    : '联网后自动同步'}
                </span>
              </div>
              {state.local.conflicts.map((conflict) => (
                <article className="account-conflict" key={conflict.id}>
                  <h3>有一处修改需要你选择</h3>
                  <p>{conflict.message}</p>
                  <details>
                    <summary>查看本地内容与云端版本</summary>
                    <div className="account-compare">
                      <label>
                        此设备
                        <pre>
                          {conflict.operation.changes
                            .map((change) =>
                              readable(change.kind, change.next, titles),
                            )
                            .join('\n\n')}
                        </pre>
                      </label>
                      <label>
                        云端
                        <pre>
                          {conflict.remote
                            .map((entity) =>
                              readable(entity.kind, entity.data, titles),
                            )
                            .join('\n\n')}
                        </pre>
                      </label>
                    </div>
                  </details>
                  <div className="account-actions">
                    <button
                      className="pu-button"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(() => controller.resolve(conflict.id, 'copy'))
                      }
                    >
                      保留本地副本
                    </button>
                    <button
                      className="pu-link"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(() => controller.resolve(conflict.id, 'remote'))
                      }
                    >
                      采用云端版本
                    </button>
                  </div>
                </article>
              ))}
            </>
          ) : (
            <div className="account-notice">
              <p>
                账号验证通过后才能打开此设备的私人内容。请使用原来绑定的账号，或重新连接后重试。
              </p>
              <button
                type="button"
                className="pu-button"
                disabled={busy}
                onClick={() => run(controller.retry)}
              >
                重新连接
              </button>
            </div>
          )}
        </>
      )}
      {(state.error || error) && (
        <p className="account-error" role="alert">
          {error || state.error}
        </p>
      )}
      {state.canUse && <DraftRecovery />}
      <PwaInstallHelp />
      <footer className="account-caption">
        布局、场景偏好和输入草稿分别保存在设备上。应用在前台或重新联网时同步已保存记录。
      </footer>
    </div>
  );
}
