const P: Record<string, JSX.Element> = {
  home: <path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4c2.2.8 3.5 2.7 3.5 5.6" /></>,
  rupee: <path d="M6 4h12M6 9h12M9 4c5 0 7 2 7 5s-2 5-7 5l7 6" />,
  tag: <><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><circle cx="8" cy="8" r="1.5" /></>,
  refresh: <path d="M20 11a8 8 0 0 0-14.5-4M4 5v4h4M4 13a8 8 0 0 0 14.5 4M20 19v-4h-4" />,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
  logout: <path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="M16 16l5 5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>,
  more: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  check: <path d="M5 12l5 5 9-10" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  archive: <path d="M3 5h18v4H3zM5 9v11h14V9M10 13h4" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>,
  send: <path d="M21 3L3 11l7 3 3 7z" />,
  back: <path d="M15 5l-7 7 7 7" />,
}

export function Icon({ name, size = 20 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  )
}

// The brand mark: a fluted stone pillar.
export function PillarMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--ink)" />
      <rect x="20" y="9" width="24" height="7" rx="1.5" fill="var(--chalk)" />
      <rect x="25" y="16" width="14" height="32" fill="var(--accent)" />
      <path d="M30 16v32M34 16v32" stroke="var(--ink)" strokeOpacity=".35" strokeWidth="1.2" />
      <rect x="20" y="48" width="24" height="7" rx="1.5" fill="var(--chalk)" />
    </svg>
  )
}
