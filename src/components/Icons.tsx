import type { ReactNode } from 'react';

export type IconName =
  | 'orbit'
  | 'today'
  | 'notes'
  | 'calendar'
  | 'space'
  | 'search'
  | 'settings'
  | 'close'
  | 'arrow'
  | 'plus'
  | 'check'
  | 'pen'
  | 'folder'
  | 'move'
  | 'resize'
  | 'icon'
  | 'card'
  | 'panel'
  | 'undo'
  | 'add';

const glyphs: Record<IconName, ReactNode> = {
  orbit: (
    <>
      <path d="M23.9 6.3C18.9 2.5 11.7 3.4 7.8 8.4C3.9 13.4 4.8 20.6 9.8 24.5C14.8 28.4 22 27.5 25.9 22.5" />
      <path d="M7.2 22.7 23.6 6.3M11.2 26.2 27.1 10.3" />
      <path d="M24.1 3.7 27.2 6.8Q27.8 7.4 27.2 8L24.1 11.1Q23.5 11.7 22.9 11.1L19.8 8Q19.2 7.4 19.8 6.8L22.9 3.7Q23.5 3.1 24.1 3.7Z" />
    </>
  ),
  today: (
    <>
      <circle cx="16" cy="16" r="6.3" />
      <path d="M16 3.5V6M16 26v2.5M3.5 16H6M26 16h2.5M7.2 7.2 9 9M23 23l1.8 1.8M7.2 24.8 9 23M23 9l1.8-1.8" />
    </>
  ),
  notes: (
    <>
      <rect x="8" y="4" width="17" height="24" rx="2.6" />
      <path d="M5.2 9h5.3M5.2 16h5.3M5.2 23h5.3M14 11h6M14 16h6M14 21h3.6" />
      <path d="M20.3 4v3Q20.3 8.5 21.8 8.5H25" />
    </>
  ),
  calendar: (
    <>
      <rect x="4.5" y="6.5" width="23" height="22" rx="2.8" />
      <path d="M4.5 12.5h23M10 3.5v6M22 3.5v6" />
      <path d="M9.5 18h3M19.5 18h3M9.5 23h3M19.5 23h3" />
    </>
  ),
  space: (
    <>
      <path d="M17.1 4.3 26.7 9.8Q27.5 10.3 27.5 11.3V21.4Q27.5 22.4 26.6 22.9L17 28.4Q16 29 15 28.4L5.4 22.9Q4.5 22.4 4.5 21.4V11.3Q4.5 10.3 5.3 9.8L14.9 4.3Q16 3.7 17.1 4.3Z" />
      <path d="M4.9 10.4 16 16.8l11.1-6.4M16 16.8v11.9M10.7 7.1 21.5 13.3" />
    </>
  ),
  search: (
    <>
      <circle cx="13.5" cy="13.5" r="8" />
      <path d="m19.3 19.3 7.2 7.2" />
    </>
  ),
  settings: (
    <>
      <path d="M13.1 4.5C13.3 3.8 13.9 3.3 14.6 3.3H17.4C18.1 3.3 18.7 3.8 18.9 4.5L19.5 6.6C20.3 6.9 21.1 7.3 21.8 7.8L23.8 7.3C24.5 7.1 25.2 7.4 25.6 8L27 10.4C27.4 11.1 27.3 11.9 26.8 12.4L25.3 14C25.4 14.6 25.5 15.3 25.5 16S25.4 17.4 25.3 18L26.8 19.6C27.3 20.1 27.4 20.9 27 21.6L25.6 24C25.2 24.6 24.5 24.9 23.8 24.7L21.8 24.2C21.1 24.7 20.3 25.1 19.5 25.4L18.9 27.5C18.7 28.2 18.1 28.7 17.4 28.7H14.6C13.9 28.7 13.3 28.2 13.1 27.5L12.5 25.4C11.7 25.1 10.9 24.7 10.2 24.2L8.2 24.7C7.5 24.9 6.8 24.6 6.4 24L5 21.6C4.6 20.9 4.7 20.1 5.2 19.6L6.7 18C6.6 17.4 6.5 16.7 6.5 16S6.6 14.6 6.7 14L5.2 12.4C4.7 11.9 4.6 11.1 5 10.4L6.4 8C6.8 7.4 7.5 7.1 8.2 7.3L10.2 7.8C10.9 7.3 11.7 6.9 12.5 6.6Z" />
      <circle cx="16" cy="16" r="4.2" />
    </>
  ),
  close: <path d="m8.5 8.5 15 15M23.5 8.5l-15 15" />,
  arrow: <path d="M11 6.5 20.5 16 11 25.5" />,
  plus: <path d="M16 6v20M6 16h20" />,
  check: <path d="m7.1 16.6 5.9 5.6 12.2-12" />,
  pen: (
    <>
      <path d="M21 5.1Q22.5 3.6 24 5.1L26.9 8Q28.4 9.5 26.9 11L12.4 25.5Q12 25.9 11.3 26L6.5 26.8Q5.1 27 5.4 25.6L6.2 20.8Q6.3 20.1 6.8 19.6Z" />
      <path d="m18.4 7.7 5.9 5.9M6.7 20.1l5.1 5.1" />
    </>
  ),
  folder: (
    <>
      <path d="M6 7H12.2Q13.2 7 13.8 7.8L16.2 10.5H26Q28 10.5 28 12.5V25Q28 27 26 27H6Q4 27 4 25V9Q4 7 6 7Z" />
      <path d="M4.6 13h22.7" />
    </>
  ),
  move: (
    <>
      <path d="M16 4.5v23M4.5 16h23" />
      <path d="m12.5 8 3.5-3.5L19.5 8M12.5 24l3.5 3.5 3.5-3.5M8 12.5 4.5 16 8 19.5M24 12.5l3.5 3.5-3.5 3.5" />
    </>
  ),
  resize: (
    <>
      <path d="M6.5 13V7.5Q6.5 6.5 7.5 6.5H13M19 25.5h5.5Q25.5 25.5 25.5 24.5V19" />
      <path d="m7 7 7 7M25 25l-7-7" />
    </>
  ),
  icon: (
    <>
      <rect x="7" y="7" width="18" height="18" rx="5" />
      <circle cx="16" cy="16" r="4" />
    </>
  ),
  card: (
    <>
      <rect x="5" y="8" width="22" height="17" rx="3" />
      <path d="M10 13h9M10 19h5" />
      <circle cx="22" cy="19" r="1.5" />
    </>
  ),
  panel: (
    <>
      <rect x="5.5" y="3" width="21" height="26" rx="2.8" />
      <path d="M5.5 10h21M10.5 16h11M10.5 22h7" />
    </>
  ),
  undo: (
    <>
      <path d="M11 8.5 5.5 14l5.5 5.5" />
      <path d="M6 14h11.5C22.2 14 26 17.4 26 22C26 23.5 25.6 24.9 24.8 26" />
    </>
  ),
  add: (
    <>
      <rect x="5" y="5" width="22" height="22" rx="4" />
      <path d="M16 11v10M11 16h10" />
    </>
  ),
};

type IconProps = {
  name: IconName;
  className?: string;
  size?: number;
};

export default function Icon({ name, className, size = 24 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyphs[name]}
    </svg>
  );
}
