import { isIP } from 'node:net';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { observatoryPwa } from './src/pwa/build';

function readAdditionalHost(value: string | undefined): string | undefined {
  const hostname = value?.trim().toLowerCase();
  if (!hostname) return undefined;

  const valid = hostname.length <= 253 && hostname.split('.').every(
    (label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
  );
  if (!valid) {
    throw new Error('LIFE_PREVIEW_ALLOWED_HOST 必须是一个完整主机名，不能包含网址、端口或通配符。');
  }
  return hostname;
}

function healthEndpoint(additionalHost: string | undefined): Plugin {
  return {
    name: 'life-preview-health',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split('?')[0];
        if (pathname !== '/__preview/health') return next();

        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('X-Content-Type-Options', 'nosniff');

        // Custom middleware runs before Vite's host check, so enforce it here too.
        const hostHeader = request.headers.host?.toLowerCase() ?? '';
        const hostname = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d+)?$/.exec(hostHeader)?.[1] ?? '';
        const ipHostname = hostname.replace(/^\[|\]$/g, '');
        const allowed = hostname === 'localhost'
          || hostname.endsWith('.localhost')
          || isIP(ipHostname) !== 0
          || hostname === additionalHost;
        if (!allowed) {
          response.statusCode = 403;
          response.end(JSON.stringify({ ok: false, error: 'host_not_allowed' }));
          return;
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405;
          response.setHeader('Allow', 'GET, HEAD');
          response.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
          return;
        }

        response.statusCode = 200;
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify({
          ok: true,
          app: 'life-platform-preview',
          stage: 'preview',
          serverTime: new Date().toISOString(),
        }));
      });
    },
  };
}

function pagesPreviewStatus(): Plugin {
  return {
    name: 'life-pages-preview-status',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'preview-status.json',
        source: `${JSON.stringify({
          ok: true,
          app: 'life-platform-preview',
          stage: 'preview',
          buildTime: new Date().toISOString(),
        }, null, 2)}\n`,
      });
    },
  };
}

function readPagesBase(value: string | undefined): string {
  const base = value?.trim() || '/';
  if (!base.startsWith('/') || base.startsWith('//') || /[\\?#]/.test(base)) {
    throw new Error('PAGES_BASE_PATH 必须是以 / 开头的站内路径。');
  }
  return base.endsWith('/') ? base : `${base}/`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['LIFE_PREVIEW_', 'PAGES_']);
  const isPages = mode === 'github-pages';
  const additionalHost = readAdditionalHost(
    process.env.LIFE_PREVIEW_ALLOWED_HOST ?? env.LIFE_PREVIEW_ALLOWED_HOST,
  );

  return {
    base: isPages ? readPagesBase(process.env.PAGES_BASE_PATH ?? env.PAGES_BASE_PATH) : '/',
    plugins: [react(), healthEndpoint(additionalHost), observatoryPwa(), ...(isPages ? [pagesPreviewStatus()] : [])],
    server: {
      host: '127.0.0.1',
      port: 4317,
      strictPort: true,
      allowedHosts: additionalHost ? [additionalHost] : [],
    },
  };
});
