import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  ApplyResult,
  CloudEntity,
  CloudOperation,
  PullResult,
} from '../data/sync-types';

export type CloudUser = { id: string; email: string };
export interface CloudTransport {
  getUser(): Promise<CloudUser | null>;
  signIn(email: string, password: string): Promise<CloudUser>;
  signOut(): Promise<void>;
  onUserChange(callback: (user: CloudUser | null) => void): () => void;
  pull(cursor: number, owner?: string): Promise<PullResult>;
  apply(operation: CloudOperation): Promise<ApplyResult>;
}
export const cloudConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
function entities(value: unknown): CloudEntity[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        !item ||
        !['notes', 'tasks', 'focus', 'dayNotes'].includes(item.kind) ||
        typeof item.id !== 'string' ||
        !Number.isSafeInteger(item.version) ||
        item.version < 0 ||
        (item.data !== null &&
          (typeof item.data !== 'object' || Array.isArray(item.data))),
    )
  )
    throw new Error('云端返回的数据格式不兼容，本地内容未改动。');
  return value;
}
export function parsePull(value: unknown): PullResult {
  if (
    !value ||
    typeof value !== 'object' ||
    !('cursor' in value) ||
    !Number.isSafeInteger(value.cursor) ||
    Number(value.cursor) < 0 ||
    !('entities' in value)
  )
    throw new Error('云端同步响应不完整，本地内容未改动。');
  return { cursor: Number(value.cursor), entities: entities(value.entities) };
}
function user(value: { id: string; email?: string } | null): CloudUser | null {
  return value ? { id: value.id, email: value.email ?? '' } : null;
}
export class SupabaseTransport implements CloudTransport {
  private client: SupabaseClient;
  constructor(url: string, key: string) {
    this.client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'life-private-session',
      },
    });
  }
  async getUser() {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    return user(data.session?.user ?? null);
  }
  async signIn(email: string, password: string) {
    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    if (!data.user) throw new Error('登录未完成，请重试。');
    return user(data.user)!;
  }
  async signOut() {
    const { error } = await this.client.auth.signOut({ scope: 'local' });
    if (error) throw error;
  }
  onUserChange(callback: (value: CloudUser | null) => void) {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(() => callback(user(session?.user ?? null)));
    });
    return () => data.subscription.unsubscribe();
  }
  private async rpc(name: string, args: Record<string, unknown>) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const { data, error } = await this.client
        .rpc(name, args)
        .abortSignal(controller.signal);
      if (error) throw new Error(error.message);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
  async pull(cursor: number, owner?: string) {
    return parsePull(
      await this.rpc('pull_changes', {
        after_cursor: cursor,
        expected_owner: owner ?? null,
      }),
    );
  }
  async apply(operation: CloudOperation): Promise<ApplyResult> {
    const value: unknown = await this.rpc('apply_operation', { operation });
    const parsed = parsePull(value);
    if (
      !value ||
      typeof value !== 'object' ||
      !('status' in value) ||
      (value.status !== 'applied' && value.status !== 'conflict')
    )
      throw new Error('云端提交响应不完整，待同步内容已保留。');
    return {
      ...parsed,
      status: value.status,
      message:
        'message' in value && typeof value.message === 'string'
          ? value.message
          : undefined,
    };
  }
}
export function createCloudTransport(): CloudTransport | null {
  return cloudConfigured
    ? new SupabaseTransport(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      )
    : null;
}
