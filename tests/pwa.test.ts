import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createManifest, pwaBase, workerSource } from '../src/pwa/config';

test('manifest identity, launch and icons stay inside root and GitHub Pages scope', () => {
  for (const base of ['/', '/life-software-preview/']) {
    const manifest = createManifest(base);
    assert.equal(manifest.id, base);
    assert.equal(manifest.start_url, base);
    assert.equal(manifest.scope, base);
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.short_name, '人生');
    assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
    assert.ok(manifest.icons.every(icon => icon.src.startsWith(base + 'icons/')));
  }
  assert.equal(pwaBase('/preview'), '/preview/');
  assert.throws(() => pwaBase('//example.com/'));
  assert.throws(() => pwaBase('/preview?wrong'));
});

test('install icons are PNGs at their declared dimensions, including the iOS touch icon', () => {
  for (const [name, dimension] of [['orbit-192', 192], ['orbit-512', 512], ['apple-touch-icon', 180]] as const) {
    const png = readFileSync(`public/icons/${name}.png`);
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), dimension);
    assert.equal(png.readUInt32BE(20), dimension);
  }
});

type FakeRequest = { url: string; method: string; mode: string; destination: string; headers: Headers };
type WorkerEvent = { request?: FakeRequest; data?: { type: string }; respondWith?: (value: Promise<Response>) => void; waitUntil: (promise: Promise<unknown>) => void };
function workerHarness(base = '/preview/') {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const responses = new Map<string, Response>();
  const added: string[] = [];
  const removed: string[] = [];
  let skipped = 0;
  const cache = {
    async addAll(urls: string[]) { added.push(...urls); responses.set(base, new Response('offline-shell')); },
    async match(value: string | FakeRequest) { return responses.get(typeof value === 'string' ? value : new URL(value.url).pathname); },
    async put() {},
  };
  vm.runInNewContext(workerSource(base, 'test-build', ['assets/main-123.js', 'assets/main-123.css']), {
    self: { location: { origin: 'https://example.com' }, addEventListener(name: string, handler: (event: WorkerEvent) => void) { handlers.set(name, handler); }, clients: { async claim() {}, async matchAll() { return []; } }, skipWaiting() { skipped++; } },
    caches: { async open() { return cache; }, async keys() { return ['life-preview-shell-%2Fpreview%2F-old', 'unrelated-cache']; }, async delete(name: string) { removed.push(name); } },
    URL, Response, fetch: async () => { throw new Error('offline'); },
  });
  async function dispatch(name: string, extra: Partial<WorkerEvent> = {}) {
    const pending: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    handlers.get(name)!({ waitUntil(promise) { pending.push(promise); }, respondWith(value) { response = value; }, ...extra });
    await Promise.all(pending);
    return response ? await response : undefined;
  }
  const request = (url: string, mode = 'cors', destination = ''): FakeRequest => ({ url, mode, destination, method: 'GET', headers: new Headers() });
  return { dispatch, request, added, removed, skipped: () => skipped };
}

test('worker installs an application shell, waits for approval and only removes its own old cache', async () => {
  const worker = workerHarness();
  await worker.dispatch('install');
  assert.deepEqual(worker.added, ['/preview/', '/preview/index.html', '/preview/assets/main-123.js', '/preview/assets/main-123.css']);
  assert.equal(worker.skipped(), 0);
  await worker.dispatch('message', { data: { type: 'not-an-update' } });
  assert.equal(worker.skipped(), 0);
  await worker.dispatch('message', { data: { type: 'LIFE_ACTIVATE_UPDATE' } });
  assert.equal(worker.skipped(), 1);
  await worker.dispatch('activate');
  assert.deepEqual(worker.removed, ['life-preview-shell-%2Fpreview%2F-old']);
});

test('offline navigations fall back to the shell without caching APIs, credentials or cross-origin data', async () => {
  const worker = workerHarness();
  await worker.dispatch('install');
  const response = await worker.dispatch('fetch', { request: worker.request('https://example.com/preview/?entry=notes', 'navigate', 'document') });
  assert.equal(await response?.text(), 'offline-shell');
  for (const request of [worker.request('https://example.com/preview/api/tasks'), worker.request('https://db.example.com/rest/v1/tasks'), worker.request('https://example.com/outside/', 'navigate', 'document'), worker.request('https://example.com/preview/assets/private.js', 'cors', 'script')]) {
    if (request.url.endsWith('private.js')) request.headers.set('Authorization', 'Bearer private');
    assert.equal(await worker.dispatch('fetch', { request }), undefined);
  }
});
