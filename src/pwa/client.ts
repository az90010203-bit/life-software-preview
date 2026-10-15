import { useSyncExternalStore } from 'react';

type UpdateState = { offlineReady: boolean; updateAvailable: boolean; updating: boolean; error: string };
let state: UpdateState = { offlineReady: false, updateAvailable: false, updating: false, error: '' };
let registration: ServiceWorkerRegistration | undefined;
let started = false;
let approvedReload = false;
let activationRequested = false;
let activatedForReload = false;
let activationTimeout: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const guards = new Set<() => Promise<void>>();
function publish(patch: Partial<UpdateState>) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function updateError(cause: unknown) {
  if (cause instanceof DOMException) return '浏览器暂时无法保存当前输入，页面已保留。请复制或导出后再更新。';
  return cause instanceof Error ? cause.message : '当前输入尚未保存，页面已保留，请稍后重试。';
}

/** A guard must reject while any user input cannot be safely persisted. */
export function registerPwaUpdateGuard(guard: () => Promise<void>) { guards.add(guard); return () => { guards.delete(guard); }; }

async function flushBeforeReload() {
  if (!guards.size) throw new Error('还在准备保存当前输入，请稍后再更新。');
  await Promise.all([...guards].map(guard => guard()));
}

async function finishApprovedUpdate() {
  clearTimeout(activationTimeout);
  try {
    // Catch any typing between the initial flush and worker activation, too.
    await flushBeforeReload();
    window.location.reload();
  } catch (cause) {
    publish({ updating: false, error: updateError(cause) });
  }
}

export function registerPwa() {
  if (started || !import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  started = true;
  const base = import.meta.env.BASE_URL;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!activationRequested) return;
    activatedForReload = true;
    if (!approvedReload) return;
    approvedReload = false;
    void finishApprovedUpdate();
  });
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'LIFE_OFFLINE_READY') publish({ offlineReady: true });
  });
  void navigator.serviceWorker.register(base + 'sw.js', { scope: base, updateViaCache: 'none' }).then(value => {
    registration = value;
    if (value.active) publish({ offlineReady: true });
    if (value.waiting) publish({ updateAvailable: true });
    value.addEventListener('updatefound', () => {
      const installing = value.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state !== 'installed') return;
        publish(navigator.serviceWorker.controller ? { updateAvailable: true } : { offlineReady: true });
      });
    });
    const check = () => { if (!document.hidden) void value.update().catch(() => undefined); };
    document.addEventListener('visibilitychange', check);
  }).catch(() => publish({ error: '离线组件暂未就绪，联网时仍可正常使用。' }));
}

async function applyUpdate() {
  if (state.updating || (!registration?.waiting && !activatedForReload)) return;
  publish({ updating: true, error: '' });
  try {
    await flushBeforeReload();
    if (activatedForReload) { await finishApprovedUpdate(); return; }
    const waiting = registration?.waiting;
    if (!waiting) { publish({ updateAvailable: false, updating: false }); return; }
    approvedReload = true;
    activationRequested = true;
    waiting.postMessage({ type: 'LIFE_ACTIVATE_UPDATE' });
    activationTimeout = setTimeout(() => {
      if (!approvedReload) return;
      approvedReload = false;
      publish({ updating: false, error: '更新暂时还没有完成，当前页面和输入已保留，可以稍后重试。' });
    }, 15_000);
  } catch (cause) {
    approvedReload = false;
    publish({ updating: false, error: updateError(cause) });
  }
}

export function usePwaUpdate() {
  const current = useSyncExternalStore(subscribe, () => state, () => state);
  return { ...current, applyUpdate };
}
