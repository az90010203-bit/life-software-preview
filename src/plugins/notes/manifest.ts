import type { PluginManifest } from '../../platform/plugins';
export const manifest: PluginManifest = {
  id: 'notes',
  apiVersion: 1,
  version: '2.0.0',
  title: '随手记',
  description: '接住此刻的一个念头。',
  icon: 'notes',
  sizes: {
    icon: { width: 112, height: 112 },
    card: { width: 340, height: 178 },
    panel: { width: 680, height: 680 },
  },
  minPanel: { width: 360, height: 380 },
  quickAction: { label: '记一下', icon: 'plus', mode: 'panel' },
};
