import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { useData } from '../data/react';
import { CloudController } from './controller';
import { createCloudTransport } from './transport';
const Context = createContext<CloudController | null>(null);
const transport = createCloudTransport();
export function CloudProvider({ children }: PropsWithChildren) {
  const { service } = useData();
  const [controller] = useState(() => new CloudController(service, transport));
  const cleanup = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(cleanup.current);
    void controller.start();
    return () => {
      cleanup.current = setTimeout(() => controller.close(), 0);
    };
  }, [controller]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function useCloud() {
  const controller = useContext(Context);
  if (!controller) throw new Error('云端账户尚未初始化');
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return { controller, state };
}
