// Read-only compatibility with the preview's former shared content store.
export function readLegacyContent(): Record<string, unknown> | undefined {
  const raw = globalThis.localStorage.getItem('life-preview.content.v1');
  if (raw === null) return undefined;
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.version !== 1)
    throw new Error('不支持的旧记录格式');
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
