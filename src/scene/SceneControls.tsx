import { useEffect, useId, useRef } from 'react';
import Icon from '../components/Icons';
import type { ScenePhase, SceneSettings } from './types';
import './SceneControls.css';

export type SceneControlsProps = {
  settings: SceneSettings;
  onChange: (next: SceneSettings) => void;
  reduced: boolean;
  onClose: () => void;
  phase: ScenePhase;
};

const phases: { id: ScenePhase; label: string; description: string }[] = [
  { id: 'dawn', label: '清晨', description: '微光初醒' },
  { id: 'day', label: '白天', description: '云海澄明' },
  { id: 'dusk', label: '黄昏', description: '余晖漫游' },
  { id: 'night', label: '夜晚', description: '灯火与星' },
];

function PhaseIcon({ phase }: { phase: ScenePhase }) {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 36 36"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {phase === 'night' ? (
        <>
          <path d="M25.6 22.7A11 11 0 0 1 13.3 7.1 11 11 0 1 0 25.6 22.7Z" />
          <path d="M25.8 6.3v5.2M23.2 8.9h5.2M29.5 17v2.8M28.1 18.4h2.8" />
        </>
      ) : phase === 'day' ? (
        <>
          <circle cx="18" cy="18" r="6.4" />
          <path d="M18 4.8v3M18 28.2v3M4.8 18h3M28.2 18h3M8.7 8.7l2.1 2.1M25.2 25.2l2.1 2.1M8.7 27.3l2.1-2.1M25.2 10.8l2.1-2.1" />
        </>
      ) : (
        <>
          <path d="M9.7 21.5a8.4 8.4 0 0 1 16.6 0M6 23.5h24M11 28h14" />
          <path d="M18 5v3M6.5 12l2.2 1.6M27.3 13.6l2.2-1.6" />
          {phase === 'dawn' ? (
            <path d="M18 19V12M15.4 14.6 18 12l2.6 2.6" />
          ) : (
            <path d="M18 12v7M15.4 16.4 18 19l2.6-2.6" />
          )}
        </>
      )}
    </svg>
  );
}

function SceneSwitch({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <button
      type="button"
      className="scene-control-row"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onClick={onChange}
    >
      <span className="scene-control-copy">
        <span id={`${id}-title`} className="scene-control-label">{title}</span>
        <span id={`${id}-description`} className="scene-control-description">{description}</span>
      </span>
      <span className="scene-control-switch" data-checked={checked} aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

export default function SceneControls({
  settings,
  onChange,
  reduced,
  onClose,
  phase,
}: SceneControlsProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const activeLabel = phases.find((item) => item.id === phase)?.label ?? '白天';

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', closeWithEscape);
    return () => document.removeEventListener('keydown', closeWithEscape);
  }, [onClose]);

  return (
    <aside
      className="scene-controls"
      data-scene-controls
      role="dialog"
      aria-modal="false"
      aria-label="场景设置"
    >
      <header className="scene-controls-header">
        <div className="scene-controls-heading">
          <span className="scene-controls-emblem"><Icon name="orbit" size={22} /></span>
          <div>
            <span className="scene-controls-kicker">OBSERVATORY</span>
            <h2>窗外的世界</h2>
          </div>
        </div>
        <button
          ref={closeRef}
          className="scene-controls-close"
          type="button"
          onClick={onClose}
          aria-label="关闭场景设置"
          title="关闭场景设置"
        >
          <Icon name="close" size={20} />
        </button>
      </header>

      <div className="scene-controls-body">
        <section className="scene-controls-time" aria-label="窗外时段">
          <SceneSwitch
            title="跟随当地时间"
            description="让窗外和你一起，经过一天。"
            checked={settings.timeMode === 'auto'}
            onChange={() => onChange({
              ...settings,
              timeMode: settings.timeMode === 'auto' ? 'fixed' : 'auto',
              fixedPhase: phase,
            })}
          />
          <div className="scene-phase-options" role="group" aria-label="固定窗外时段">
            {phases.map((item) => {
              const selected = settings.timeMode === 'fixed' && settings.fixedPhase === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="scene-phase-option"
                  data-phase={item.id}
                  aria-pressed={selected}
                  aria-label={`固定为${item.label}，${item.description}`}
                  onClick={() => onChange({ ...settings, timeMode: 'fixed', fixedPhase: item.id })}
                >
                  <span className="scene-phase-icon"><PhaseIcon phase={item.id} /></span>
                  <span>{item.label}</span>
                  <span className="scene-phase-selection" aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <p className="scene-phase-help">选择一个时段，让喜欢的光线多停留一会儿。</p>
        </section>

        <section className="scene-controls-motion" aria-label="场景动态">
          <SceneSwitch
            title="场景动态"
            description="轻缓的云海、光线与远处的航行。"
            checked={settings.motion}
            onChange={() => onChange({ ...settings, motion: !settings.motion })}
          />
          <SceneSwitch
            title="偶遇窗外景象"
            description="偶尔经过的舰船，或夜空中的流星。"
            checked={settings.events}
            onChange={() => onChange({ ...settings, events: !settings.events })}
          />
        </section>

        {reduced && (
          <p className="scene-controls-notice">
            <Icon name="pause" size={16} />
            <span>系统已开启减少动态，当前以静态画面呈现。你的动态偏好会保留。</span>
          </p>
        )}

        <p className="scene-controls-status" role="status" aria-live="polite">
          <span className="scene-controls-status-light" aria-hidden="true" />
          {settings.timeMode === 'auto' ? '随当地时间' : '固定时段'}
          <span aria-hidden="true">·</span>
          {activeLabel}
          <span aria-hidden="true">·</span>
          {!settings.motion || reduced ? '静静停留' : settings.events ? '等待下一次偶遇' : '云海缓行'}
        </p>
      </div>
    </aside>
  );
}
