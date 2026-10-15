// @refresh reset
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { LocalTaskService } from './service';
import type { TaskService } from './types';

const defaultService = new LocalTaskService();
if (import.meta.hot) import.meta.hot.dispose(() => defaultService.close());
const Context = createContext<TaskService>(defaultService);
export function DataProvider({
  children,
  service = defaultService,
}: PropsWithChildren<{ service?: TaskService }>) {
  useEffect(() => {
    void service.initialize();
  }, [service]);
  return <Context.Provider value={service}>{children}</Context.Provider>;
}
export function useData() {
  const service = useContext(Context);
  const snapshot = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot,
  );
  return { service, snapshot };
}
export function useDraft(key: string, initial = '', baseRevision?: number) {
  const { service, snapshot } = useData();
  const stored = snapshot.drafts.find((item) => item.key === key);
  const [state, setState] = useState(() => ({
    key,
    value: stored?.text ?? initial,
  }));
  const [saved, setSaved] = useState(Boolean(stored));
  const [error, setError] = useState('');
  const dirty = useRef(false);
  const initialized = useRef('');
  const sequence = useRef(0);
  const revision = useRef(baseRevision);
  const currentKey = useRef(key);
  currentKey.current = key;
  revision.current = baseRevision;
  useEffect(() => {
    if (!snapshot.ready) return;
    if (initialized.current !== key) {
      initialized.current = key;
      // A fast input can arrive as the database becomes ready. Never replace it
      // with the initial draft in a later effect.
      if (dirty.current && state.key === key) return;
      const token = ++sequence.current;
      dirty.current = false;
      setState({ key, value: stored?.text ?? initial });
      setSaved(Boolean(stored));
      setError('');
      if (!stored && initial) {
        void service.saveDraft(key, initial, revision.current).then(
          () => {
            if (sequence.current === token && currentKey.current === key)
              setSaved(true);
          },
          (e) => {
            if (sequence.current === token && currentKey.current === key)
              setError(e instanceof Error ? e.message : '草稿尚未保存');
          },
        );
      }
    } else if (!dirty.current) {
      setState((previous) =>
        previous.value === (stored?.text ?? initial)
          ? previous
          : { key, value: stored?.text ?? initial },
      );
    }
  }, [snapshot.ready, key, stored?.text, initial, service]);
  function setValue(value: string, nextBaseRevision = revision.current) {
    dirty.current = true;
    const token = ++sequence.current;
    setState({ key, value });
    setSaved(false);
    setError('');
    const write = value
      ? service.saveDraft(key, value, nextBaseRevision)
      : service.clearDraft(key);
    void write.then(
      () => {
        if (sequence.current === token && currentKey.current === key)
          setSaved(true);
      },
      (e) => {
        if (sequence.current === token && currentKey.current === key)
          setError(e instanceof Error ? e.message : '草稿尚未保存');
      },
    );
  }
  return {
    value:
      initialized.current !== key
        ? (stored?.text ?? initial)
        : state.key === key
          ? state.value
          : (stored?.text ?? initial),
    setValue,
    saved,
    error,
  };
}
