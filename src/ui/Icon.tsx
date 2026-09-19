/* A small set of line icons, all drawn on the same 24px grid with the same
   stroke, so they read as one hand. Anything the UI needs an icon for is here. */
const PATHS = {
  walk: <><circle cx="13" cy="4.6" r="1.6" /><path d="M12 8.2l-1.5 4.3 3 2.2 1 5.3M10.5 12.5l-2.7 1.7M12 8.2l3.2 2.6 2.3.4M10.7 14.6l-1.4 5.2" /></>,
  cycle: <><circle cx="6" cy="16.5" r="3.4" /><circle cx="18" cy="16.5" r="3.4" /><path d="M6 16.5l3.6-7.3h5.2l3.2 7.3M9.6 9.2l3.2 7.3M14.8 9.2l.8-2.2h2" /></>,
  transit: <><rect x="5" y="3" width="14" height="14" rx="3.2" /><path d="M5 11.5h14M8.5 20.5L7 22M15.5 20.5L17 22" /><circle cx="8.8" cy="14.2" r=".7" /><circle cx="15.2" cy="14.2" r=".7" /></>,
  drive: <><path d="M4.5 15l1.6-5.2a2 2 0 0 1 1.9-1.4h8a2 2 0 0 1 1.9 1.4L19.5 15M4 15h16v3.2H4z" /><circle cx="7.6" cy="18.2" r="1.3" /><circle cx="16.4" cy="18.2" r="1.3" /></>,
  fork: <><path d="M7 3v6.5a2.2 2.2 0 0 0 4.4 0V3M9.2 3v18M17 3.2c-2.4 1.6-2.6 6.3 0 8.3V21" /></>,
  moon: <path d="M20 14.2A8 8 0 1 1 9.8 4a6.2 6.2 0 0 0 10.2 10.2z" />,
  bed: <><path d="M3.5 19V7.5M3.5 15h17v4M20.5 15v-2.2a3 3 0 0 0-3-3H11V15" /><circle cx="7" cy="12" r="1.6" /></>,
  arrow: <path d="M7 17L17 7M9 7h8v8" />,
  send: <path d="M4 12l16-8-6 16-2.6-6.4z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
} as const

export type IconName = keyof typeof PATHS

export default function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  )
}
