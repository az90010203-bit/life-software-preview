import type { PluginManifest } from '../../platform/plugins';
export const manifest: PluginManifest = {
  id: 'today',
  apiVersion: 1,
  version: '1.0.0',
  title: '今天',
  description: '把今天放在眼前。',
  icon: 'today',
  sizes: {
    icon: { width: 112, height: 112 },
    card: { width: 340, height: 156 },
    panel: { width: 350, height: 300 },
  },
  minPanel: { width: 300, height: 220 },
};
