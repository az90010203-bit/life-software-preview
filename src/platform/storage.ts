import { useEffect, useState } from 'react';
import { validPluginId } from './plugins';

export type Decoded<T> = { data: T; damaged: boolean };
export type PluginStateSpec<T> = {
  id: string;
  createDefault: () => T;
  decode: (value: unknown) => Decoded<T>;
  readLegacy?: () => unknown | undefined;
};
export type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
export type LoadedPluginState<T> = {
  data: T;
  warning: string | null;
  blockWrites: boolean;
};

export function pluginStorageKey(id: string): string {
  if (!validPluginId(id)) throw new Error('无效的插件数据命名空间');
  return `life-preview.plugin.${id}.v1`;
}

export function readPluginState<T>(
  spec: PluginStateSpec<T>,
  storage: StoragePort,
): LoadedPluginState<T> {
  const empty = spec.createDefault();
  try {
    const raw = storage.getItem(pluginStorageKey(spec.id));
    const value: unknown = raw === null ? spec.readLegacy?.() : JSON.parse(raw);
    if (value === undefined)
      return { data: empty, warning: null, blockWrites: false };
    const result = spec.decode(value);
    return {
      data: result.data,
      warning: result.damaged
        ? '部分记录暂无法读取，可用内容已保留；本页修改暂不覆盖原数据。'
        : null,
      blockWrites: result.damaged,
    };
  } catch {
    return {
      data: empty,
      warning: '模块数据暂无法读取，原有数据未改动；本页新内容暂不覆盖原记录。',
      blockWrites: true,
    };
  }
}

export function usePluginState<T>(spec: PluginStateSpec<T>) {
  const [initial] = useState<LoadedPluginState<T>>(() => {
    try {
      return readPluginState(spec, globalThis.localStorage);
    } catch {
      return {
        data: spec.createDefault(),
        warning: '浏览器本地保存暂不可用，内容先保留在当前页面。',
        blockWrites: true,
      };
    }
  });
  const [data, setData] = useState(initial.data);
  const [writeWarning, setWriteWarning] = useState<string | null>(null);
  useEffect(() => {
    if (initial.blockWrites) return;
    try {
      globalThis.localStorage.setItem(
        pluginStorageKey(spec.id),
        JSON.stringify(data),
      );
      setWriteWarning(null);
    } catch {
      setWriteWarning(
        '浏览器暂时无法保存，内容仍在当前页面，刷新后修改可能丢失。',
      );
    }
  }, [data, initial.blockWrites, spec.id]);
  return [data, setData, initial.warning ?? writeWarning] as const;
}
