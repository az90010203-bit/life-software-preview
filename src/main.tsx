import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type ConnectionState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'connected'; timestamp: string }
  | { status: 'error' };

const isStaticPreview = import.meta.env.MODE === 'github-pages';
const statusLabels: Record<ConnectionState['status'], string> = {
  idle: '等待测试',
  checking: isStaticPreview ? '正在测试' : '正在连接',
  connected: isStaticPreview ? '访问正常' : '连接成功',
  error: isStaticPreview ? '访问未成功' : '连接未成功',
};

function App() {
  const [connection, setConnection] = useState<ConnectionState>({ status: 'idle' });

  async function testConnection() {
    setConnection({ status: 'checking' });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);

    try {
      const endpoint = isStaticPreview ? 'preview-status.json' : '__preview/health';
      const response = await fetch(`${import.meta.env.BASE_URL}${endpoint}`, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Connection failed');
      const health: unknown = await response.json();
      if (
        typeof health !== 'object' || health === null
        || !('ok' in health) || health.ok !== true
        || !('app' in health) || health.app !== 'life-platform-preview'
        || !('stage' in health) || health.stage !== 'preview'
      ) {
        throw new Error('Invalid response');
      }
      const timestamp = isStaticPreview
        ? ('buildTime' in health ? health.buildTime : undefined)
        : ('serverTime' in health ? health.serverTime : undefined);
      if (typeof timestamp !== 'string' || !Number.isFinite(new Date(timestamp).getTime())) {
        throw new Error('Invalid response time');
      }
      setConnection({ status: 'connected', timestamp });
    } catch {
      setConnection({ status: 'error' });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return (
    <div className="page-shell">
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">人</span>
          <span className="brand-name">人生软件</span>
        </div>
        <span className="preview-badge">平台预览</span>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-heading">
          <p className="eyebrow">从一个小小的连接开始</p>
          <h1 id="page-heading">让它来到<br className="mobile-break" />你的手边。</h1>
          <p className="intro-copy">先确认这张页面能在电脑和手机上打开。<br />属于你的模块，之后再慢慢加入。</p>
          <p className="preview-note">当前仅为页面预览；插件宿主与数据存储尚未实现。</p>
        </section>

        <section className="connection-card" aria-labelledby="connection-heading">
          <div className="connection-topline">
            <h2 id="connection-heading">{isStaticPreview ? '访问状态' : '连接状态'}</h2>
            <span className={`connection-status status-${connection.status}`} aria-live="polite">
              <span className="status-dot" aria-hidden="true" />
              {statusLabels[connection.status]}
            </span>
          </div>
          <div className="connection-body">
            <div className="connection-message" role="status" aria-live="polite">
              {connection.status === 'idle' && <p>{isStaticPreview
                ? '点一下，确认这张预览页面能正常响应。'
                : '点一下，确认你与电脑上的预览已经连通。'}</p>}
              {connection.status === 'checking' && <p>{isStaticPreview
                ? '正在确认页面响应，请稍候…'
                : '正在等待电脑回应，请稍候…'}</p>}
              {connection.status === 'connected' && (
                <>
                  <p>{isStaticPreview ? '页面已响应，访问正常。' : '电脑已回应，连接正常。'}</p>
                  <p className="response-time">{isStaticPreview ? '页面更新时间' : '服务器时间'} · <time dateTime={connection.timestamp}>
                    {new Intl.DateTimeFormat('zh-CN', {
                      timeZone: 'Asia/Tokyo',
                      year: 'numeric', month: '2-digit', day: '2-digit',
                      hour: '2-digit', minute: '2-digit', second: '2-digit',
                      hour12: false,
                    }).format(new Date(connection.timestamp))}
                  </time>（日本时间）</p>
                </>
              )}
              {connection.status === 'error' && <p>{isStaticPreview
                ? '页面暂时未响应，请稍后再试。'
                : '暂时没有连上。请确认电脑上的预览服务还在运行，再试一次。'}</p>}
            </div>
            <button className="test-button" type="button" onClick={testConnection} disabled={connection.status === 'checking'}>
              {connection.status === 'checking' ? (isStaticPreview ? '测试中…' : '连接中…') : '测试连接'}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </section>

        <section className="modules-section" aria-labelledby="modules-heading">
          <div className="section-title">
            <h2 id="modules-heading">模块入口</h2>
            <span>还没有安装模块</span>
          </div>
          <div className="module-empty">
            <span className="empty-symbol" aria-hidden="true">＋</span>
            <div>
              <h3>之后安装模块</h3>
              <p>安装好的模块，会出现在这里。</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span>当前阶段：平台预览</span>
        <span>本页不保存个人内容。</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
