import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { dateInMonth, localDateKey } from '../../platform/dates';

export type CalendarRecords = Record<string, string>;

export type CalendarProps = {
  className?: string;
  records: CalendarRecords;
  onSave: (key: string, value: string) => void;
};

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export default function Calendar({
  className,
  records,
  onSave,
}: CalendarProps) {
  const isEditable = true;
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const dateButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterEditing = useRef<string | null>(null);
  const headingId = useId();

  useEffect(() => {
    if (editingDate === null && focusAfterEditing.current) {
      dateButtons.current.get(focusAfterEditing.current)?.focus();
      focusAfterEditing.current = null;
    }
  }, [editingDate]);

  const { year, month } = visibleMonth;
  const todayKey = localDateKey(new Date());
  const firstWeekday = (dateInMonth(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = dateInMonth(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  function closeEditor(restoreFocus = true) {
    focusAfterEditing.current = restoreFocus ? editingDate : null;
    setEditingDate(null);
    setDraft('');
  }

  function saveRecord() {
    if (!editingDate) return;
    const text = draft.trim();
    onSave(editingDate, text);
    closeEditor();
  }

  function moveMonth(offset: number) {
    const date = dateInMonth(year, month + offset, 1);
    closeEditor(false);
    setVisibleMonth({ year: date.getFullYear(), month: date.getMonth() });
  }

  function goToToday() {
    const now = new Date();
    closeEditor(false);
    setVisibleMonth({ year: now.getFullYear(), month: now.getMonth() });
  }

  function onDateKeyDown(event: KeyboardEvent<HTMLButtonElement>, day: number) {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const offset = offsets[event.key];
    if (offset === undefined) return;
    const targetDate = dateInMonth(year, month, day + offset);
    const button = dateButtons.current.get(localDateKey(targetDate));
    if (button) {
      event.preventDefault();
      button.focus();
    }
  }

  return (
    <section
      className={['wc-calendar', className].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
    >
      <div className="wc-calendar-toolbar">
        <h2 className="wc-calendar-month-label" id={headingId}>
          {year} 年 {month + 1} 月
        </h2>
        <div className="wc-calendar-navigation" aria-label="切换月份">
          <button
            className="wc-calendar-nav-button"
            type="button"
            aria-label="上一月"
            onClick={() => moveMonth(-1)}
            disabled={year === 1 && month === 0}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            className="wc-calendar-today-button"
            type="button"
            onClick={goToToday}
          >
            今天
          </button>
          <button
            className="wc-calendar-nav-button"
            type="button"
            aria-label="下一月"
            onClick={() => moveMonth(1)}
            disabled={year === 9999 && month === 11}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      <p className="wc-caption">
        {isEditable ? '点击日期写一笔。' : '查看这个月留下的记录。'}
      </p>
      <div className="wc-calendar-weekdays" aria-hidden="true">
        {WEEKDAYS.map((weekday) => (
          <span className="wc-calendar-weekday" key={weekday}>
            {weekday}
          </span>
        ))}
      </div>
      <div
        className="wc-calendar-days"
        role="group"
        aria-label={`${year}年${month + 1}月的日期`}
      >
        {Array.from({ length: cellCount }, (_, index) => {
          const day = index - firstWeekday + 1;
          if (day < 1 || day > daysInMonth) {
            return (
              <div
                className="wc-calendar-cell wc-calendar-cell--empty"
                key={`empty-${index}`}
                aria-hidden="true"
              />
            );
          }
          const date = dateInMonth(year, month, day);
          const key = localDateKey(date);
          const text = records[key];
          const isToday = key === todayKey;
          const isEditing = key === editingDate;
          const dateLabel = `${year}年${month + 1}月${day}日，${WEEKDAYS[(date.getDay() + 6) % 7]}`;
          const classes = [
            'wc-calendar-cell',
            isToday ? 'wc-calendar-cell--today' : '',
            text ? 'wc-calendar-cell--has-record' : '',
            isEditing ? 'wc-calendar-cell--editing' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div className={classes} key={key}>
              {isEditing ? (
                <form
                  className="wc-calendar-edit-form"
                  aria-label={`编辑${dateLabel}的记录`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveRecord();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      closeEditor();
                    } else if (
                      event.key === 'Enter' &&
                      (event.ctrlKey || event.metaKey)
                    ) {
                      event.preventDefault();
                      saveRecord();
                    }
                  }}
                >
                  <span
                    className="wc-calendar-day-number wc-calendar-edit-day"
                    aria-hidden="true"
                  >
                    {day}
                  </span>
                  <textarea
                    className="wc-calendar-editor"
                    aria-label={`${dateLabel}的记录`}
                    placeholder="写点什么…"
                    rows={2}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    autoFocus
                  />
                  <div className="wc-calendar-edit-actions">
                    <button className="wc-calendar-save-button" type="submit">
                      保存
                    </button>
                    <button
                      className="wc-calendar-cancel-button"
                      type="button"
                      onClick={() => closeEditor()}
                    >
                      取消
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  className="wc-calendar-day-button"
                  type="button"
                  disabled={!isEditable}
                  aria-label={`${dateLabel}${isToday ? '，今天' : ''}，${text ? `记录：${text.slice(0, 80)}${isEditable ? '，点击编辑' : ''}` : `无记录${isEditable ? '，点击添加' : ''}`}`}
                  aria-current={isToday ? 'date' : undefined}
                  onClick={() => {
                    setEditingDate(key);
                    setDraft(text ?? '');
                  }}
                  onKeyDown={(event) => onDateKeyDown(event, day)}
                  ref={(node) => {
                    if (node) dateButtons.current.set(key, node);
                    else dateButtons.current.delete(key);
                  }}
                >
                  <span className="wc-calendar-day-number" aria-hidden="true">
                    {day}
                  </span>
                  {text && (
                    <span className="wc-calendar-record" aria-hidden="true">
                      {text}
                    </span>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
