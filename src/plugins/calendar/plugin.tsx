import type { PropsWithChildren } from 'react';
import type { PluginDefinition, PluginViewProps } from '../../platform/plugins';
import { useLocalDay } from '../../platform/useLocalDay';
import { useData } from '../../data/react';
import { usePluginNavigation } from '../../platform/navigation';
import Calendar, { compareTasks } from './Calendar';
import { manifest } from './manifest';
import './calendar.css';

export { stateSpec } from './legacy';

function Provider({ children }: PropsWithChildren) {
  return <>{children}</>;
}

function View({ mode }: PluginViewProps) {
  const { snapshot } = useData();
  const today = useLocalDay();
  const { openPlugin } = usePluginNavigation();
  if (mode === 'panel') return <Calendar />;
  const tasks = snapshot.tasks.filter((task) => !task.deletedAt);
  const todays = tasks.filter((task) => task.date === today).sort(compareTasks);
  const upcoming = tasks
    .filter((task) => task.date > today && !task.completed)
    .sort(compareTasks)[0];
  const dayNote = snapshot.dayNotes.find((note) => note.date === today);
  const todayDate = new Date(today + 'T12:00:00');
  const first = todays.find((task) => !task.completed) ?? todays[0];
  return (
    <div className="cal-card">
      <div className="cal-card-top">
        <time dateTime={today} className="cal-card-date">
          <strong>{todayDate.getDate()}</strong>
          <span>
            {todayDate.getMonth() + 1}月 ·{' '}
            {new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(
              todayDate,
            )}
          </span>
        </time>
        <span className="cal-card-count">
          {todays.length ? `${todays.length} 件安排` : '留一点余地'}
        </span>
      </div>
      <button
        className="cal-card-entry"
        onClick={() =>
          openPlugin('calendar', { date: today, taskId: first?.id })
        }
      >
        <span className="cal-eyebrow">
          今天{first?.time ? ` · ${first.time}` : ''}
        </span>
        <span
          className={
            first?.completed ? 'cal-card-title is-completed' : 'cal-card-title'
          }
        >
          {first?.title ?? dayNote?.text ?? '今天还没有安排，点这里写一件。'}
        </span>
      </button>
      {upcoming && (
        <button
          className="cal-card-upcoming"
          onClick={() =>
            openPlugin('calendar', { date: upcoming.date, taskId: upcoming.id })
          }
        >
          <span>
            {Number(upcoming.date.slice(5, 7))}月
            {Number(upcoming.date.slice(8))}日
            {upcoming.time ? ` ${upcoming.time}` : ''}
          </span>
          <span>{upcoming.title}</span>
        </button>
      )}
      {!snapshot.ready && (
        <p className="cal-status" role="status">
          正在打开月历…
        </p>
      )}
      {snapshot.warning && (
        <p className="cal-warning" role="status">
          {snapshot.warning}
        </p>
      )}
    </div>
  );
}

function Status() {
  const { snapshot } = useData();
  const today = useLocalDay();
  const count = snapshot.tasks.filter(
    (task) => !task.deletedAt && task.date === today && !task.completed,
  ).length;
  return (
    <>
      <span className="latin">{String(count).padStart(2, '0')}</span>
      <span>今日安排</span>
    </>
  );
}

export const calendarPlugin: PluginDefinition = {
  manifest,
  Provider,
  View,
  Status,
};
