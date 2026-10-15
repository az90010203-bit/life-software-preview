import type { PluginManifest } from '../../platform/plugins';
export const manifest: PluginManifest = {
  id: 'calendar',
  apiVersion: 1,
  version: '1.0.0',
  title: '月历',
  description: '在日期里留下一点记录。',
  icon: 'calendar',
  sizes: {
    icon: { width: 112, height: 112 },
    card: { width: 340, height: 240 },
    panel: { width: 640, height: 520 },
  },
  minPanel: { width: 500, height: 420 },
};
