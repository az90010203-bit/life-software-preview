import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import Calendar, { localDateKey, validDateKey, type CalendarRecords } from './Calendar';

type Note = { id: string; text: string; createdAt: string };
type ContentData = {
  version: 1;
  notes: Note[];
  draft: string;
  calendar: CalendarRecords;
  today: Record<string, string>;
};
type InitialContent = { data: ContentData; warning: string | null; blockWrites: boolean };
type WidgetData = {
  content: ContentData;
  todayKey: string;
  todayDraft: string;
  notesFeedback: string;
  todayFeedback: string;
  storageWarning: string | null;
  setDraft: (value: string) => void;
  saveDraft: () => void;
  saveCalendar: (key: string, value: string) => void;
  setTodayDraft: (value: string) => void;
  saveToday: () => void;
};

const STORAGE_KEY = 'life-preview.content.v1';
const LEGACY_CALENDAR_KEY = 'life-preview.calendar.v1';
const WidgetDataContext = createContext<WidgetData | null>(null);

function emptyContent(): ContentData {
  return { version: 1, notes: [], draft: '', calendar: {}, today: {} };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDateMap(value: unknown): { records: CalendarRecords; damaged: boolean } {
  const records: CalendarRecords = {};
  if (!isObject(value)) return { records, damaged: true };
  let damaged = false;
  for (const [key, text] of Object.entries(value)) {
    if (!validDateKey(key) || typeof text !== 'string') {
      damaged = true;
    } else if (text.trim()) {
      records[key] = text;
    }
  }
  return { records, damaged };
}

function readInitialContent(): InitialContent {
  const data = emptyContent();
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return { data, warning: '浏览器本地保存暂不可用。内容先保留在当前页面，刷新后可能丢失。', blockWrites: true };
  }

  if (raw === null) {
    // Only import when the shared store does not exist. Keep the original key intact.
    try {
      const legacy = window.localStorage.getItem(LEGACY_CALENDAR_KEY);
      if (legacy === null) return { data, warning: null, blockWrites: false };
      const migrated = readDateMap(JSON.parse(legacy));
      data.calendar = migrated.records;
      return {
        data,
        warning: migrated.damaged ? '部分旧日历记录无法读取，可用记录已保留；原有数据未改动。' : null,
        blockWrites: false,
      };
    } catch {
      return { data, warning: '旧日历暂时无法读取，原有数据未改动。可以继续记录新内容。', blockWrites: false };
    }
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || value.version !== 1) {
      return { data, warning: '本地内容格式暂无法识别。原有数据未改动，本页新内容暂不覆盖原记录。', blockWrites: true };
    }
    let damaged = false;
    const ids = new Set<string>();
    if (Array.isArray(value.notes)) {
      for (const note of value.notes) {
        if (isObject(note) && typeof note.id === 'string' && note.id.length > 0 && !ids.has(note.id)
          && typeof note.text === 'string' && note.text.trim().length > 0
          && typeof note.createdAt === 'string' && Number.isFinite(Date.parse(note.createdAt))) {
          ids.add(note.id);
          data.notes.push({ id: note.id, text: note.text, createdAt: note.createdAt });
        } else {
          damaged = true;
        }
      }
    } else {
      damaged = true;
    }
    if (typeof value.draft === 'string') data.draft = value.draft;
    else damaged = true;
    const calendar = readDateMap(value.calendar);
    const today = readDateMap(value.today);
    data.calendar = calendar.records;
    data.today = today.records;
    damaged ||= calendar.damaged || today.damaged;
    return {
      data,
      warning: damaged ? '部分本地内容暂无法读取。可用内容已保留，本页修改暂不覆盖原数据。' : null,
      blockWrites: damaged,
    };
  } catch {
    return { data, warning: '本地内容暂无法读取。原有数据未改动，本页新内容暂不覆盖原记录。', blockWrites: true };
  }
}

function useWidgetData(): WidgetData {
  const data = useContext(WidgetDataContext);
  if (!data) throw new Error('WidgetContent 必须放在 WidgetDataProvider 内。');
  return data;
}

export function WidgetDataProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(readInitialContent);
  const [content, setContent] = useState(initial.data);
  const [todayKey, setTodayKey] = useState(() => localDateKey(new Date()));
  const [todayDrafts, setTodayDrafts] = useState<Record<string, string>>(() => ({ ...initial.data.today }));
  const [writeWarning, setWriteWarning] = useState<string | null>(null);
  const [notesFeedback, setNotesFeedback] = useState('');
  const [todayFeedback, setTodayFeedback] = useState('');

  useEffect(() => {
    if (initial.blockWrites) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(content));
      setWriteWarning(null);
    } catch {
      setWriteWarning('浏览器暂时无法保存。内容仍在当前页面，刷新后修改可能丢失。');
    }
  }, [content, initial.blockWrites]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function refreshDate() {
      clearTimeout(timer);
      const now = new Date();
      setTodayKey(localDateKey(now));
      const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(refreshDate, nextDay.getTime() - now.getTime() + 50);
    }
    refreshDate();
    document.addEventListener('visibilitychange', refreshDate);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', refreshDate); };
  }, []);

  const setDraft = useCallback((value: string) => {
    setContent((previous) => previous.draft === value ? previous : { ...previous, draft: value });
    setNotesFeedback('');
  }, []);

  const saveDraft = useCallback(() => {
    const id = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID() : `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createdAt = new Date().toISOString();
    setContent((previous) => {
      const text = previous.draft.trim();
      if (!text) return previous;
      return { ...previous, notes: [{ id, text, createdAt }, ...previous.notes], draft: '' };
    });
    setNotesFeedback('这段想法已收好。');
  }, []);

  const saveCalendar = useCallback((key: string, value: string) => {
    if (!validDateKey(key)) return;
    setContent((previous) => {
      const calendar = { ...previous.calendar };
      const text = value.trim();
      if (text) calendar[key] = text;
      else delete calendar[key];
      return { ...previous, calendar };
    });
  }, []);

  const setTodayDraft = useCallback((value: string) => {
    setTodayDrafts((previous) => ({ ...previous, [todayKey]: value }));
    setTodayFeedback('');
  }, [todayKey]);

  const todayDraft = todayDrafts[todayKey] ?? content.today[todayKey] ?? '';
  const saveToday = useCallback(() => {
    const text = todayDraft.trim();
    setContent((previous) => {
      const today = { ...previous.today };
      if (text) today[todayKey] = text;
      else delete today[todayKey];
      return { ...previous, today };
    });
    setTodayDrafts((previous) => ({ ...previous, [todayKey]: text }));
    setTodayFeedback(text ? '今天的重点已保存。' : '已清空今天的重点。');
  }, [todayDraft, todayKey]);

  const storageWarning = [initial.warning, writeWarning].filter(Boolean).join(' ') || null;
  const value = useMemo<WidgetData>(() => ({
    content, todayKey, todayDraft, notesFeedback, todayFeedback, storageWarning,
    setDraft, saveDraft, saveCalendar, setTodayDraft, saveToday,
  }), [content, todayKey, todayDraft, notesFeedback, todayFeedback, storageWarning,
    setDraft, saveDraft, saveCalendar, setTodayDraft, saveToday]);

  return <WidgetDataContext.Provider value={value}>{children}</WidgetDataContext.Provider>;
}

export function useWidgetSummary(): { notesCount: number; calendarDays: number; today: string } {
  const { content, todayKey } = useWidgetData();
  return { notesCount: content.notes.length, calendarDays: Object.keys(content.calendar).length, today: content.today[todayKey] ?? '' };
}

function NoteList({ notes }: { notes: Note[] }) {
  if (notes.length === 0) return <p className="wc-empty">还没有片段。想到什么，就先放下来。</p>;
  return (
    <ol className="wc-notes-list" aria-label="已收好的片段">
      {notes.map((note) => (
        <li className="wc-note" key={note.id}>
          <p className="wc-note-text">{note.text}</p>
          <time className="wc-note-time" dateTime={note.createdAt}>
            {new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(note.createdAt))}
          </time>
        </li>
      ))}
    </ol>
  );
}

export function WidgetContent({ kind, mode, instanceId }: {
  kind: 'notes' | 'calendar' | 'today';
  mode: 'card' | 'panel';
  instanceId: string;
}) {
  const data = useWidgetData();
  const controlId = useId();
  const { content, todayKey } = data;
  const date = new Date(`${todayKey}T12:00:00`);
  const monthPrefix = todayKey.slice(0, 7);
  const monthRecords = Object.entries(content.calendar).filter(([key]) => key.startsWith(monthPrefix)).sort(([a], [b]) => b.localeCompare(a));
  const recentRecord = monthRecords[0];
  const todayRecord = content.calendar[todayKey];
  const label = kind === 'notes' ? '随手记' : kind === 'calendar' ? '日历' : '今天的重点';

  return (
    <section className={`wc-content wc-content--${mode} wc-content--${kind}`} aria-label={`${label}${mode === 'panel' ? '面板' : '卡片'}`} data-instance-id={instanceId}>
      {kind === 'notes' && (
        <>
          {mode === 'panel' && (
            <form className="wc-form" onSubmit={(event) => { event.preventDefault(); data.saveDraft(); }} onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && content.draft.trim()) {
                event.preventDefault();
                data.saveDraft();
              }
            }}>
              <label className="wc-field-label" htmlFor={controlId}>此刻想到什么？</label>
              <textarea className="wc-textarea" id={controlId} aria-label="随手记内容" placeholder="把脑海里的那一点，先放在这里。" rows={4} value={content.draft} onChange={(event) => data.setDraft(event.target.value)} />
              <button className="wc-primary-action" type="submit" disabled={!content.draft.trim()}>收好片段</button>
              {data.notesFeedback && <p className="wc-feedback" role="status">{data.notesFeedback}</p>}
            </form>
          )}
          <p className="wc-count">{content.notes.length} 条已收好</p>
          <NoteList notes={mode === 'card' ? content.notes.slice(0, 2) : content.notes} />
        </>
      )}

      {kind === 'today' && (mode === 'card' ? (
        <>
          <p className="wc-today-summary">{content.today[todayKey] || '今天还没有选定重点。'}</p>
          <p className="wc-caption">为今天留下一件最重要的事。</p>
        </>
      ) : (
        <form className="wc-form" onSubmit={(event) => { event.preventDefault(); data.saveToday(); }}>
          <label className="wc-field-label" htmlFor={controlId}>今天最重要的一件事</label>
          <input className="wc-input" id={controlId} type="text" aria-label="今天的重点" placeholder="今天，想把哪件事做好？" value={data.todayDraft} onChange={(event) => data.setTodayDraft(event.target.value)} />
          <button className="wc-primary-action" type="submit">保存重点</button>
          {data.todayFeedback && <p className="wc-feedback" role="status">{data.todayFeedback}</p>}
        </form>
      ))}

      {kind === 'calendar' && (mode === 'panel' ? (
        <Calendar records={content.calendar} onSave={data.saveCalendar} />
      ) : (
        <>
          <header className="wc-calendar-card-header">
            <p className="wc-calendar-card-month">{date.getFullYear()} 年 {date.getMonth() + 1} 月</p>
            <time className="wc-calendar-today-number" dateTime={todayKey} aria-label={`今天是${date.getMonth() + 1}月${date.getDate()}日`}>{date.getDate()}</time>
          </header>
          <p className="wc-calendar-card-summary">{todayRecord || (recentRecord ? `${Number(recentRecord[0].slice(-2))} 日 · ${recentRecord[1]}` : '这个月还没留下记录。')}</p>
          <p className="wc-caption">本月 {monthRecords.length} 天有记录</p>
        </>
      ))}
      {data.storageWarning && <p className="wc-storage-warning" role="status">{data.storageWarning}</p>}
    </section>
  );
}
