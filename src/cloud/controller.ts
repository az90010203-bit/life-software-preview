import type { TaskService } from '../data/types';
import type { LocalSyncState, SyncLocalPort } from '../data/sync-types';
import type { CloudTransport, CloudUser } from './transport';

export type CloudStatus =
  | 'loading'
  | 'unconfigured'
  | 'signed-out'
  | 'import'
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'error';
export type CloudSnapshot = {
  status: CloudStatus;
  user: CloudUser | null;
  local: LocalSyncState;
  error: string;
  canUse: boolean;
};
type Local = TaskService & SyncLocalPort;
const emptyLocal = (): LocalSyncState => ({
  owner: null,
  pending: 0,
  conflicts: [],
  cursor: 0,
  lastSyncedAt: null,
});
export class CloudController {
  private snapshot: CloudSnapshot;
  private listeners = new Set<() => void>();
  private running?: Promise<void>;
  private started = false;
  private unsubscribe?: () => void;
  private unsubscribeLocal?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private debounce?: ReturnType<typeof setTimeout>;
  private closed = false;
  private explicitLogout = false;
  private verifiedUser: string | null = null;
  private authGeneration = 0;
  constructor(
    readonly service: Local,
    readonly transport: CloudTransport | null,
  ) {
    this.snapshot = {
      status: transport ? 'loading' : 'unconfigured',
      user: null,
      local: emptyLocal(),
      error: '',
      canUse: !transport,
    };
    try {
      this.explicitLogout =
        localStorage.getItem('life-preview.cloud-signed-out') === '1';
    } catch {
      /* Unavailable storage cannot persist a login either. */
    }
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<CloudSnapshot>) {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private trust(user?: CloudUser) {
    try {
      if (user)
        localStorage.setItem(
          'life-preview.trusted-cloud-account',
          JSON.stringify(user),
        );
      else localStorage.removeItem('life-preview.trusted-cloud-account');
    } catch {
      /* Offline access still works in this running page. */
    }
  }
  private trusted(): CloudUser | null {
    try {
      const value = JSON.parse(
        localStorage.getItem('life-preview.trusted-cloud-account') || 'null',
      );
      return value &&
        typeof value.id === 'string' &&
        typeof value.email === 'string'
        ? value
        : null;
    } catch {
      return null;
    }
  }
  private async localState() {
    const local = await this.service.getSyncState();
    this.publish({ local });
    return local;
  }
  start = async () => {
    if (this.started) return;
    this.started = true;
    try {
      await this.service.initialize();
      await this.localState();
    } catch (e) {
      this.publish({
        status: this.transport ? 'error' : 'unconfigured',
        error: this.message(e),
        canUse: !this.transport,
      });
      return;
    }
    if (this.closed) return;
    if (!this.transport) return;
    this.unsubscribe = this.transport.onUserChange((value) => {
      if (!this.explicitLogout)
        void this.authChanged(value).catch((e) =>
          this.publish({ status: 'error', error: this.message(e) }),
        );
    });
    this.unsubscribeLocal = this.service.subscribe(() => {
      if (this.running) return;
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        void this.localState()
          .then((local) => (local.pending > 0 ? this.sync() : undefined))
          .catch((e) =>
            this.publish({ status: 'error', error: this.message(e) }),
          );
      }, 450);
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('storage', this.onStorage);
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    this.timer = setInterval(() => {
      if (
        typeof document === 'undefined' ||
        document.visibilityState === 'visible'
      )
        void this.retry();
    }, 15000);
    if (this.explicitLogout) {
      this.publish({ status: 'signed-out', user: null, canUse: false });
      return;
    }
    const generation = this.authGeneration;
    try {
      const user = await this.transport.getUser();
      if (
        generation === this.authGeneration &&
        !this.explicitLogout &&
        !this.closed
      )
        await this.authChanged(user);
    } catch (e) {
      if (
        generation !== this.authGeneration ||
        this.explicitLogout ||
        this.closed
      )
        return;
      const cached = this.trusted();
      this.publish({
        status: 'offline',
        user: cached,
        canUse: Boolean(cached && cached.id === this.snapshot.local.owner),
        error: this.message(e),
      });
    }
  };
  private onOnline = () => {
    void this.retry();
  };
  private onStorage = (event: StorageEvent) => {
    if (event.key !== 'life-preview.cloud-signed-out' || event.newValue !== '1')
      return;
    this.explicitLogout = true;
    this.authGeneration++;
    this.verifiedUser = null;
    this.trust();
    this.publish({
      status: 'signed-out',
      user: null,
      canUse: false,
      error: '',
    });
  };
  private onVisibility = () => {
    if (document.visibilityState === 'visible') void this.retry();
  };
  retry = async () => {
    try {
      if (
        !this.snapshot.canUse &&
        this.snapshot.user &&
        this.snapshot.status !== 'import'
      )
        await this.authChanged(this.snapshot.user);
      else await this.sync();
    } catch (e) {
      this.publish({ status: 'error', error: this.message(e) });
    }
  };
  private isCurrent(user: CloudUser, generation?: number) {
    return (
      !this.closed &&
      !this.explicitLogout &&
      this.snapshot.user?.id === user.id &&
      (generation === undefined || generation === this.authGeneration)
    );
  }
  private message(e: unknown) {
    return e instanceof Error
      ? e.message
      : '暂时无法连接云端，本地内容仍保留。';
  }
  private async authChanged(value: CloudUser | null) {
    if (this.closed) return;
    const generation = ++this.authGeneration;
    if (!value) {
      this.verifiedUser = null;
      this.publish({ status: 'signed-out', user: null, canUse: false });
      return;
    }
    if (
      this.snapshot.user?.id === value.id &&
      this.verifiedUser === value.id &&
      this.snapshot.canUse &&
      this.snapshot.status !== 'offline' &&
      this.snapshot.status !== 'error'
    ) {
      this.publish({ user: value });
      return;
    }
    const sameAccount = this.snapshot.user?.id === value.id;
    if (!sameAccount) this.verifiedUser = null;
    this.publish({
      user: value,
      error: '',
      canUse: sameAccount && this.snapshot.canUse,
    });
    const local = await this.localState();
    if (!this.isCurrent(value, generation)) return;
    if (local.owner && local.owner !== value.id) {
      this.publish({
        status: 'error',
        canUse: false,
        error:
          '此设备已绑定另一个私人账号，请使用原账号登录。原数据与待同步内容均保留。',
      });
      return;
    }
    try {
      const pulled = await this.transport!.pull(local.cursor, value.id);
      if (!this.isCurrent(value, generation)) return;
      this.verifiedUser = value.id;
      if (!local.owner) {
        const counts = this.service.getImportCounts();
        if (counts.notes + counts.tasks + counts.dayNotes + counts.focus > 0) {
          this.publish({ status: 'import', canUse: false });
          return;
        }
        await this.service.bindAccount(value.id);
        if (!this.isCurrent(value, generation)) return;
      }
      await this.service.acceptRemote(pulled);
      if (!this.isCurrent(value, generation)) return;
      await this.localState();
      if (!this.isCurrent(value, generation)) return;
      this.trust(value);
      this.publish({ status: 'idle', canUse: true });
      await this.sync();
    } catch (e) {
      if (!this.isCurrent(value, generation)) return;
      this.verifiedUser = null;
      const cached = this.trusted();
      this.publish({
        status: 'offline',
        error: this.message(e),
        canUse: Boolean(local.owner === value.id && cached?.id === value.id),
      });
    }
  }
  signIn = async (email: string, password: string) => {
    if (!this.transport) throw new Error('云端服务尚未配置。');
    const generation = ++this.authGeneration;
    const value = await this.transport.signIn(email.trim(), password);
    if (this.explicitLogout && generation !== this.authGeneration) return;
    this.explicitLogout = false;
    try {
      localStorage.removeItem('life-preview.cloud-signed-out');
    } catch {
      /* The current page can still sign in. */
    }
    await this.authChanged(value);
  };
  confirmImport = async () => {
    const value = this.snapshot.user;
    const generation = this.authGeneration;
    if (!value || !this.transport || this.verifiedUser !== value.id)
      throw new Error('请先连接云端并登录。');
    await this.service.bindAccount(value.id);
    if (!this.isCurrent(value, generation)) return;
    await this.localState();
    if (!this.isCurrent(value, generation)) return;
    this.trust(value);
    this.publish({ status: 'idle', canUse: true });
    await this.sync();
  };
  signOut = async () => {
    this.authGeneration++;
    this.explicitLogout = true;
    try {
      localStorage.setItem('life-preview.cloud-signed-out', '1');
    } catch {
      /* This running page remains signed out. */
    }
    this.verifiedUser = null;
    this.trust();
    this.publish({
      user: null,
      status: 'signed-out',
      canUse: false,
      error: '',
    });
    await this.transport?.signOut();
  };
  sync = () => {
    if (this.running) return this.running;
    this.running = this.performSync()
      .catch((e) => {
        this.publish({ status: 'offline', error: this.message(e) });
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  };
  private async performSync() {
    if (
      !this.transport ||
      this.explicitLogout ||
      !this.snapshot.user ||
      this.snapshot.status === 'import'
    )
      return;
    const account = this.snapshot.user;
    const local = await this.localState();
    if (local.owner !== account.id || !this.snapshot.canUse) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.publish({ status: 'offline' });
      return;
    }
    this.publish({ status: 'syncing', error: '' });
    try {
      const pulled = await this.transport.pull(local.cursor, account.id);
      if (this.explicitLogout || this.snapshot.user?.id !== account.id) return;
      await this.service.acceptRemote(pulled);
      for (let index = 0; index < 100; index++) {
        if (this.explicitLogout || this.snapshot.user?.id !== account.id)
          return;
        const operation = (await this.service.getPendingOperations())[0];
        if (this.explicitLogout || this.snapshot.user?.id !== account.id)
          return;
        if (!operation) break;
        if (operation.owner !== account.id)
          throw new Error('待同步内容的账号不匹配，已停止上传。');
        const result = await this.transport.apply({
          id: operation.id,
          changes: operation.changes,
          owner: account.id,
        });
        if (this.explicitLogout || this.snapshot.user?.id !== account.id)
          return;
        await this.service.acknowledgeOperation(operation.id, result);
      }
      const current = await this.service.getSyncState();
      const latest = await this.transport.pull(current.cursor, account.id);
      if (this.explicitLogout || this.snapshot.user?.id !== account.id) return;
      await this.service.acceptRemote(latest);
      await this.localState();
      if (this.isCurrent(account)) this.publish({ status: 'idle', error: '' });
    } catch (e) {
      if (!this.isCurrent(account)) return;
      await this.localState();
      if (this.isCurrent(account))
        this.publish({ status: 'offline', error: this.message(e) });
    }
  }
  resolve = async (id: string, resolution: 'remote' | 'copy') => {
    const account = this.snapshot.user;
    if (!account || !this.snapshot.canUse || !this.isCurrent(account))
      throw new Error('请先使用此设备绑定的私人账号登录。');
    const local = await this.service.getSyncState();
    if (
      !this.isCurrent(account) ||
      local.owner !== account.id ||
      !this.snapshot.canUse
    )
      throw new Error('账号不匹配，私人内容未改动。');
    await this.service.resolveConflict(id, resolution);
    await this.localState();
    await this.sync();
  };
  close() {
    this.closed = true;
    this.unsubscribe?.();
    this.unsubscribeLocal?.();
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('storage', this.onStorage);
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
  }
}
