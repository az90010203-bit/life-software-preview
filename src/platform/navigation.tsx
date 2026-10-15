import { createContext, useContext, type PropsWithChildren } from 'react';
export type PluginTarget = {
  date?: string;
  taskId?: string;
  action?: 'add' | 'select';
  pluginId: string;
  requestId: number;
};
export type PluginDestination = Omit<PluginTarget, 'pluginId' | 'requestId'>;
type Navigation = {
  target: PluginTarget | null;
  openPlugin: (id: string, target?: PluginDestination) => void;
};
const Context = createContext<Navigation>({
  target: null,
  openPlugin: () => undefined,
});
export function PluginNavigationProvider({
  children,
  value,
}: PropsWithChildren<{ value: Navigation }>) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function usePluginNavigation() {
  return useContext(Context);
}
