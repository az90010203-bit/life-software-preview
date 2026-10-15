import { createPluginRegistry } from '../platform/plugins';
import type { WidgetMode } from '../platform/plugins';
import { notesPlugin } from './notes/plugin';
import { calendarPlugin } from './calendar/plugin';
import { todayPlugin } from './today/plugin';
// The application's only plugin registration point. Platform code has no business cases.
export const pluginRegistry = createPluginRegistry([
  notesPlugin,
  calendarPlugin,
  todayPlugin,
]);
export const primaryPluginId =
  pluginRegistry.list.find((plugin) => plugin.manifest.quickAction)?.manifest
    .id ?? '';
export const defaultWidgets: {
  id: string;
  kind: string;
  mode: WidgetMode;
  x: number;
  y: number;
  z: number;
}[] = [
  {
    id: '9d1ca4c3-9467-43aa-a2bf-f9dac31ae816',
    kind: notesPlugin.manifest.id,
    mode: 'panel',
    x: 0,
    y: 0,
    z: 3,
  },
  {
    id: 'b5a560f2-3675-462d-bb9b-96c37fa2f6f3',
    kind: calendarPlugin.manifest.id,
    mode: 'panel',
    x: 1,
    y: 1,
    z: 2,
  },
  {
    id: 'c8aab7be-3f08-4878-8ac4-2a1da891d2d3',
    kind: todayPlugin.manifest.id,
    mode: 'card',
    x: 1,
    y: 0,
    z: 1,
  },
];
