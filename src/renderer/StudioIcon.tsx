import type { ReactNode } from 'react';

const paths = {
  play: <path d="M8 4.5v15l12-7.5z" />,
  pause: <path d="M8 5v14m8-14v14" />,
  previous: <path d="M19 5v14L9 12zM5 5v14" />,
  backFive: <><path d="M4.5 10A8 8 0 1 1 6 18M4.5 5v5h5" /><text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" fontSize="9" fontWeight="700">5</text></>,
  forwardTen: <><path d="M19.5 10A8 8 0 1 0 18 18m1.5-13v5h-5" /><text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8" fontWeight="700">10</text></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  zoomIn: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15 15 5 5M8 10.5h5m-2.5-2.5v5" /></>,
  zoomOut: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15 15 5 5M8 10.5h5" /></>,
  folder: <path d="M3 6h7l2 2h9v11H3z" />,
  save: <><path d="M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-8h8v8" /></>,
  copy: <><rect x="8" y="8" width="12" height="13" rx="1.5" /><path d="M16 5V3H3v13h2" /></>,
  audio: <><path d="M9 17V5l10-2v12" /><circle cx="6" cy="17.5" r="3" /><circle cx="16" cy="15.5" r="3" /></>,
  lyrics: <><path d="M4 5h16M4 10h11M4 15h16M4 20h9" /></>,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16m10-16v16M3 10h4m10 0h4M3 15h4m10 0h4" /></>,
  export: <><path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5" /></>,
  display: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m4 17 5-5 4 3 3-4 5 5" /><circle cx="9" cy="8" r="1" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19m0-14-1.4 1.4M6.4 17.6 5 19" /><circle cx="12" cy="12" r="8" /></>,
  palette: <><path d="M12 3a9 9 0 0 0 0 18h1.5a2.5 2.5 0 0 0 0-5H13a2 2 0 0 1 0-4h4a4 4 0 0 0 3.5-6.1A9 9 0 0 0 12 3z" /><circle cx="7.5" cy="11" r=".7" /><circle cx="10" cy="7" r=".7" /><circle cx="15" cy="7" r=".7" /></>,
  microphone: <><rect x="9" y="2.5" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>,
  history: <><path d="M4 5v5h5" /><path d="M4 10a8 8 0 1 1 0 5m8-7v5h4" /></>,
  file: <><path d="M6 2h8l4 4v16H6zM14 2v5h4M12 11v7M8.5 14.5h7" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  volume: <><path d="M3 9h4l5-4v14l-5-4H3zM15 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" /></>,
} satisfies Record<string, ReactNode>;

export type StudioIconName = keyof typeof paths;

export function StudioIcon({ name }: { name: StudioIconName }) {
  return <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
