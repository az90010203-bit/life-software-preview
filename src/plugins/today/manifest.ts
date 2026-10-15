import type { PluginManifest } from '../../platform/plugins';
export const manifest: PluginManifest = {
  id: 'today',
  apiVersion: 1,
  version: '2.0.0',
  title: '今天',
  description: '最多三件重点，给今天留一点余地。',
  icon: 'today',
  sizes: {
    icon: { width: 112, height: 112 },
    card: { width: 500, height: 180 },
    panel: { width: 390, height: 510 },
  },
  minPanel: { width: 300, height: 220 },
};
