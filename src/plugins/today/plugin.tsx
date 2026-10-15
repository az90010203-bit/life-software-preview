import {
  createContext,
  useContext,
  useCallback,
  useId,
  useState,
  type PropsWithChildren,
} from 'react';
import type { PluginDefinition, PluginViewProps } from '../../platform/plugins';
import { usePluginState, type PluginStateSpec } from '../../platform/storage';
import { useLocalDay } from '../../platform/useLocalDay';
import { readLegacyContent } from '../legacy';
import {
  emptyDateState,
  decodeDateState,
  type DateState,
} from '../dateRecords';
import { manifest } from './manifest';
export const stateSpec: PluginStateSpec<DateState> = {
  id: manifest.id,
  createDefault: emptyDateState,
  decode: decodeDateState,
  readLegacy() {
    const old = readLegacyContent();
    return old ? { version: 1, records: old.today } : undefined;
  },
};
type TodayApi = {
  content: { today: DateState['records'] };
  todayKey: string;
  todayDraft: string;
  todayFeedback: string;
  storageWarning: string | null;
  setTodayDraft: (value: string) => void;
  saveToday: () => void;
};
const Context = createContext<TodayApi | null>(null);
function useToday() {
  const data = useContext(Context);
  if (!data) throw new Error('今日重点未初始化');
  return data;
}
function Provider({ children }: PropsWithChildren) {
  const [state, setState, storageWarning] = usePluginState(stateSpec);
  const content = { today: state.records };
  const todayKey = useLocalDay();
  const [todayDrafts, setTodayDrafts] = useState<Record<string, string>>(
    () => ({ ...state.records }),
  );
  const [todayFeedback, setTodayFeedback] = useState('');
  const setTodayDraft = useCallback(
    (value: string) => {
      setTodayDrafts((previous) => ({ ...previous, [todayKey]: value }));
      setTodayFeedback('');
    },
    [todayKey],
  );

  const todayDraft = todayDrafts[todayKey] ?? content.today[todayKey] ?? '';
  const saveToday = useCallback(() => {
    const text = todayDraft.trim();
    setState((previous) => {
      const today = { ...previous.records };
      if (text) today[todayKey] = text;
      else delete today[todayKey];
      return { ...previous, records: today };
    });
    setTodayDrafts((previous) => ({ ...previous, [todayKey]: text }));
    setTodayFeedback(text ? '今天的重点已保存。' : '已清空今天的重点。');
  }, [todayDraft, todayKey]);

  return (
    <Context.Provider
      value={{
        content,
        todayKey,
        todayDraft,
        todayFeedback,
        storageWarning,
        setTodayDraft,
        saveToday,
      }}
    >
      {children}
    </Context.Provider>
  );
}
function View({ mode }: PluginViewProps) {
  const data = useToday();
  const { content, todayKey } = data;
  const date = new Date(todayKey + 'T12:00:00');
  const controlId = useId();
  return (
    <>
      {mode === 'card' ? (
        <>
          <div className="wc-today-heading">
            <span className="wc-field-label wc-today-label">重点</span>
            <time className="wc-today-date" dateTime={todayKey}>
              {String(date.getMonth() + 1).padStart(2, '0')}.
              {String(date.getDate()).padStart(2, '0')}
            </time>
          </div>
          <p className="wc-today-summary">
            {content.today[todayKey] || '还没有选定重点。'}
          </p>
        </>
      ) : (
        <form
          className="wc-form"
          onSubmit={(event) => {
            event.preventDefault();
            data.saveToday();
          }}
        >
          <div className="wc-today-heading">
            <label
              className="wc-field-label wc-today-label"
              htmlFor={controlId}
            >
              重点
            </label>
            <time className="wc-today-date" dateTime={todayKey}>
              {String(date.getMonth() + 1).padStart(2, '0')}.
              {String(date.getDate()).padStart(2, '0')}
            </time>
          </div>
          <input
            className="wc-input"
            id={controlId}
            type="text"
            aria-label="今天的重点"
            placeholder="今天，想把哪件事做好？"
            value={data.todayDraft}
            onChange={(event) => data.setTodayDraft(event.target.value)}
          />
          <button className="wc-primary-action" type="submit">
            保存重点
          </button>
          {data.todayFeedback && (
            <p className="wc-feedback" role="status">
              {data.todayFeedback}
            </p>
          )}
        </form>
      )}
      {data.storageWarning && (
        <p className="wc-storage-warning" role="status">
          {data.storageWarning}
        </p>
      )}
    </>
  );
}
export const todayPlugin: PluginDefinition = { manifest, Provider, View };
