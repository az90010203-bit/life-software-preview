import { createContext, useContext, type PropsWithChildren } from 'react';
import type { PluginDefinition, PluginViewProps } from '../../platform/plugins';
import { usePluginState, type PluginStateSpec } from '../../platform/storage';
import { useLocalDay } from '../../platform/useLocalDay';
import { validDateKey } from '../../platform/dates';
import { readLegacyContent } from '../legacy';
import {
  emptyDateState,
  decodeDateState,
  type DateState,
} from '../dateRecords';
import Calendar from './Calendar';
import { manifest } from './manifest';
export const stateSpec: PluginStateSpec<DateState> = {
  id: manifest.id,
  createDefault: emptyDateState,
  decode: decodeDateState,
  readLegacy() {
    const old = readLegacyContent();
    if (old) return { version: 1, records: old.calendar };
    const raw = globalThis.localStorage.getItem('life-preview.calendar.v1');
    return raw === null ? undefined : { version: 1, records: JSON.parse(raw) };
  },
};
type CalendarApi = {
  content: { calendar: DateState['records'] };
  todayKey: string;
  saveCalendar: (key: string, value: string) => void;
  storageWarning: string | null;
};
const Context = createContext<CalendarApi | null>(null);
function useCalendar() {
  const data = useContext(Context);
  if (!data) throw new Error('月历未初始化');
  return data;
}
function Provider({ children }: PropsWithChildren) {
  const [state, setState, storageWarning] = usePluginState(stateSpec);
  const todayKey = useLocalDay();
  function saveCalendar(key: string, value: string) {
    if (!validDateKey(key)) return;
    setState((previous) => {
      const records = { ...previous.records };
      const text = value.trim();
      if (text) records[key] = text;
      else delete records[key];
      return { ...previous, records };
    });
  }
  return (
    <Context.Provider
      value={{
        content: { calendar: state.records },
        todayKey,
        saveCalendar,
        storageWarning,
      }}
    >
      {children}
    </Context.Provider>
  );
}
function View({ mode }: PluginViewProps) {
  const data = useCalendar();
  const { content, todayKey } = data;
  const date = new Date(todayKey + 'T12:00:00');
  const monthRecords = Object.entries(content.calendar)
    .filter(([key]) => key.startsWith(todayKey.slice(0, 7)))
    .sort(([a], [b]) => b.localeCompare(a));
  const recentRecord = monthRecords[0];
  const todayRecord = content.calendar[todayKey];
  return (
    <>
      {mode === 'panel' ? (
        <Calendar records={content.calendar} onSave={data.saveCalendar} />
      ) : (
        <>
          <header className="wc-calendar-card-header">
            <p className="wc-calendar-card-month">
              {date.getFullYear()} 年 {date.getMonth() + 1} 月
            </p>
          </header>
          <div className="wc-calendar-card-main">
            <div className="wc-calendar-date-block">
              <time
                className="wc-calendar-today-number"
                dateTime={todayKey}
                aria-label={`今天是${date.getMonth() + 1}月${date.getDate()}日`}
              >
                {date.getDate()}
              </time>
              <span className="wc-calendar-card-weekday">
                {new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(
                  date,
                )}
              </span>
            </div>
            <div className="wc-calendar-card-detail">
              <p className="wc-calendar-card-label">
                {todayRecord
                  ? '今天记下'
                  : recentRecord
                    ? `最近 · ${Number(recentRecord[0].slice(-2))} 日`
                    : '今日日记'}
              </p>
              <p className="wc-calendar-card-summary">
                {todayRecord || recentRecord?.[1] || '今天还没有留下记录。'}
              </p>
              {monthRecords.length > 0 && (
                <p className="wc-caption">
                  本月 {monthRecords.length} 天有记录
                </p>
              )}
            </div>
          </div>
        </>
      )}
      {data.storageWarning && (
        <p className="wc-storage-warning" role="status">
          {data.storageWarning}
        </p>
      )}
    </>
  );
}
function Status() {
  const { content } = useCalendar();
  return (
    <>
      <span className="latin">
        {String(Object.keys(content.calendar).length).padStart(2, '0')}
      </span>
      <span>留下的日子</span>
    </>
  );
}
export const calendarPlugin: PluginDefinition = {
  manifest,
  Provider,
  View,
  Status,
};
