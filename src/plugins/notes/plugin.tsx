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
import { readLegacyContent, isRecord } from '../legacy';
import { manifest } from './manifest';
type Note = { id: string; text: string; createdAt: string };
type NotesState = { version: 1; notes: Note[]; draft: string };
export const stateSpec: PluginStateSpec<NotesState> = {
  id: manifest.id,
  createDefault: () => ({ version: 1, notes: [], draft: '' }),
  readLegacy: readLegacyContent,
  decode(value) {
    if (!isRecord(value) || value.version !== 1)
      throw new Error('记录格式不兼容');
    const data: NotesState = {
      version: 1,
      notes: [],
      draft: typeof value.draft === 'string' ? value.draft : '',
    };
    let damaged =
      typeof value.draft !== 'string' || !Array.isArray(value.notes);
    const ids = new Set<string>();
    if (Array.isArray(value.notes))
      for (const note of value.notes) {
        if (
          isRecord(note) &&
          typeof note.id === 'string' &&
          note.id &&
          !ids.has(note.id) &&
          typeof note.text === 'string' &&
          note.text.trim() &&
          typeof note.createdAt === 'string' &&
          Number.isFinite(Date.parse(note.createdAt))
        ) {
          ids.add(note.id);
          data.notes.push({
            id: note.id,
            text: note.text,
            createdAt: note.createdAt,
          });
        } else damaged = true;
      }
    return { data, damaged };
  },
};
type NotesApi = {
  content: NotesState;
  setDraft: (value: string) => void;
  saveDraft: () => void;
  notesFeedback: string;
  storageWarning: string | null;
};
const Context = createContext<NotesApi | null>(null);
function useNotes() {
  const data = useContext(Context);
  if (!data) throw new Error('随手记未初始化');
  return data;
}
function Provider({ children }: PropsWithChildren) {
  const [content, setContent, storageWarning] = usePluginState(stateSpec);
  const [notesFeedback, setNotesFeedback] = useState('');
  const setDraft = useCallback((value: string) => {
    setContent((previous) =>
      previous.draft === value ? previous : { ...previous, draft: value },
    );
    setNotesFeedback('');
  }, []);

  const saveDraft = useCallback(() => {
    const id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createdAt = new Date().toISOString();
    setContent((previous) => {
      const text = previous.draft.trim();
      if (!text) return previous;
      return {
        ...previous,
        notes: [{ id, text, createdAt }, ...previous.notes],
        draft: '',
      };
    });
    setNotesFeedback('这段想法已收好。');
  }, []);

  return (
    <Context.Provider
      value={{ content, setDraft, saveDraft, notesFeedback, storageWarning }}
    >
      {children}
    </Context.Provider>
  );
}
function NoteList({ notes }: { notes: Note[] }) {
  if (notes.length === 0) return <p className="wc-empty">还没有收好的片段。</p>;
  return (
    <ol className="wc-notes-list" aria-label="已收好的片段">
      {notes.map((note) => (
        <li className="wc-note" key={note.id}>
          <p className="wc-note-text">{note.text}</p>
          <time className="wc-note-time" dateTime={note.createdAt}>
            {new Intl.DateTimeFormat('zh-CN', {
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(note.createdAt))}
          </time>
        </li>
      ))}
    </ol>
  );
}

function View({ mode }: PluginViewProps) {
  const data = useNotes();
  const { content } = data;
  const controlId = useId();
  return (
    <>
      {' '}
      <>
        {mode === 'panel' && (
          <form
            className="wc-form wc-notes-form"
            onSubmit={(event) => {
              event.preventDefault();
              data.saveDraft();
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent.isComposing &&
                content.draft.trim()
              ) {
                event.preventDefault();
                data.saveDraft();
              }
            }}
          >
            <label
              className="wc-field-label wc-writing-label"
              htmlFor={controlId}
            >
              此刻
            </label>
            <textarea
              data-plugin-focus
              className="wc-textarea wc-notes-writing"
              id={controlId}
              aria-label="随手记内容"
              placeholder="把脑海里的那一点，先放在这里。"
              rows={4}
              value={content.draft}
              onChange={(event) => data.setDraft(event.target.value)}
            />
            <div className="wc-compose-footer">
              {data.notesFeedback && (
                <p className="wc-feedback" role="status">
                  {data.notesFeedback}
                </p>
              )}
              <button
                className="wc-primary-action"
                type="submit"
                disabled={!content.draft.trim()}
              >
                收好片段
              </button>
            </div>
          </form>
        )}
        <div className="wc-history">
          <header className="wc-history-heading">
            <h3 className="wc-history-title">
              {mode === 'card' ? '最近收好' : '收好的片段'}
            </h3>
            <span className="wc-count">{content.notes.length} 条</span>
          </header>
          <NoteList
            notes={mode === 'card' ? content.notes.slice(0, 2) : content.notes}
          />
        </div>
      </>
      {data.storageWarning && (
        <p className="wc-storage-warning" role="status">
          {data.storageWarning}
        </p>
      )}
    </>
  );
}
function Status() {
  const { content } = useNotes();
  return (
    <>
      <span className="latin">
        {String(content.notes.length).padStart(2, '0')}
      </span>
      <span>片段</span>
    </>
  );
}
export const notesPlugin: PluginDefinition = {
  manifest,
  Provider,
  View,
  Status,
};
