import type { PluginManifest } from '../../platform/plugins';
export const manifest: PluginManifest = {
  id: 'calendar',
  apiVersion: 1,
  version: '2.0.0',
  title: '月历',
  description: '安排未来，也留住这一天。',
  icon: 'calendar',
  sizes: {
    icon: { width: 112, height: 112 },
    card: { width: 340, height: 240 },
    panel: { width: 500, height: 420 },
  },
  minPanel: { width: 360, height: 420 },
};
