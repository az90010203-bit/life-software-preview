import type { ComponentType, PropsWithChildren } from 'react';
import type { IconName } from '../components/Icons';

export type WidgetMode = 'icon' | 'card' | 'panel';
export type WidgetSize = Readonly<{ width: number; height: number }>;
export type PluginViewProps = {
  mode: Exclude<WidgetMode, 'icon'>;
  instanceId: string;
};
export type PluginManifest = {
  id: string;
  apiVersion: 1;
  version: string;
  title: string;
  description: string;
  icon: IconName;
  sizes: Readonly<Record<WidgetMode, WidgetSize>>;
  minPanel: WidgetSize;
  quickAction?: { label: string; icon: IconName; mode: WidgetMode };
};
export type PluginDefinition = {
  manifest: PluginManifest;
  Provider: ComponentType<PropsWithChildren>;
  View: ComponentType<PluginViewProps>;
  Status?: ComponentType;
};

export function validPluginId(id: string): boolean {
  return /^[a-z][a-z0-9.-]{0,63}$/.test(id);
}

export function createPluginRegistry(definitions: readonly PluginDefinition[]) {
  const entries = new Map<string, PluginDefinition>();
  const sizeValid = (size: WidgetSize) =>
    size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0 &&
    size.width <= 8192 &&
    size.height <= 8192;
  for (const definition of definitions) {
    const manifest = definition.manifest;
    if (!validPluginId(manifest.id) || entries.has(manifest.id))
      throw new Error('插件 ID 无效或重复：' + manifest.id);
    if (manifest.apiVersion !== 1)
      throw new Error('不支持的插件接口版本：' + manifest.id);
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || !manifest.title.trim())
      throw new Error('插件信息不完整：' + manifest.id);
    if (
      !['icon', 'card', 'panel'].every((mode) =>
        sizeValid(manifest.sizes[mode as WidgetMode]),
      ) ||
      !sizeValid(manifest.minPanel) ||
      manifest.sizes.panel.width < manifest.minPanel.width ||
      manifest.sizes.panel.height < manifest.minPanel.height
    )
      throw new Error('插件尺寸无效：' + manifest.id);
    if (
      manifest.quickAction &&
      !['icon', 'card', 'panel'].includes(manifest.quickAction.mode)
    )
      throw new Error('插件快捷入口形态无效：' + manifest.id);
    entries.set(manifest.id, definition);
  }
  const list = Object.freeze([...entries.values()]);
  const manifests: Readonly<Record<string, PluginManifest>> = Object.freeze(
    Object.fromEntries(
      list.map((plugin) => [plugin.manifest.id, plugin.manifest]),
    ),
  );
  return Object.freeze({
    list,
    manifests,
    find: (id: string) => entries.get(id),
    describe: (id: string): PluginManifest =>
      entries.get(id)?.manifest ?? {
        id,
        apiVersion: 1,
        version: '0.0.0',
        title: '未加载的插件',
        description: id,
        icon: 'space',
        sizes: {
          icon: { width: 112, height: 112 },
          card: { width: 340, height: 178 },
          panel: { width: 440, height: 510 },
        },
        minPanel: { width: 112, height: 112 },
      },
  });
}
