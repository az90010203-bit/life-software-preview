export function pwaBase(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\?#]/.test(value)) throw new Error('PWA base 必须是站内绝对路径。');
  return value.endsWith('/') ? value : value + '/';
}

export function createManifest(baseValue: string) {
  const base = pwaBase(baseValue);
  return {
    id: base,
    name: '人生 · 我的观景室',
    short_name: '人生',
    description: '随手记收想法，月历安排事情，今天聚焦重要的事。',
    lang: 'zh-CN',
    start_url: base,
    scope: base,
    display: 'standalone',
    background_color: '#eaf0f4',
    theme_color: '#eaf0f4',
    icons: [
      { src: base + 'icons/orbit-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: base + 'icons/orbit-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
}

export function workerSource(baseValue: string, version: string, files: string[]) {
  const base = pwaBase(baseValue);
  const prefix = 'life-preview-shell-' + encodeURIComponent(base) + '-';
  const shell = [...new Set([base, base + 'index.html', ...files.map(file => base + file)])];
  return `/* Life Observatory: public application shell only. */
const BASE = ${JSON.stringify(base)};
const PREFIX = ${JSON.stringify(prefix)};
const CACHE = PREFIX + ${JSON.stringify(version)};
const SHELL = ${JSON.stringify(shell)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({type:'window'});
    clients.forEach(client => client.postMessage({type:'LIFE_OFFLINE_READY'}));
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'LIFE_ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE) || request.headers.has('Authorization')) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch {
        const cache = await caches.open(CACHE);
        return await cache.match(BASE) || await cache.match(BASE + 'index.html') || new Response('暂时无法连接。请联网打开一次观景室后再离线使用。', {status:503, headers:{'Content-Type':'text/plain;charset=utf-8'}});
      }
    })());
    return;
  }
  const relative = url.pathname.slice(BASE.length);
  const publicPath = ['assets/','icons/','fonts/','art/'].some(prefix => relative.startsWith(prefix)) || relative === 'favicon.svg' || relative === 'manifest.webmanifest';
  const destination = ['script','style','image','font','manifest'].includes(request.destination);
  if (!publicPath || !destination) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(request, {ignoreSearch:true});
    if (saved) return saved;
    const response = await fetch(request);
    if (response.ok && response.type !== 'opaque') {
      const copy = response.clone();
      event.waitUntil(cache.put(request, copy).catch(() => undefined));
    }
    return response;
  })());
});
`;
}
