/* Everything drawn on the pages.
 *
 * All of it is line work on a 24-unit square in `currentColor`, the same
 * grammar the memory album's stickers use — one hand, one weight of nib, so a
 * tram ticket and a pressed fern belong on the same page. Nothing here is a
 * photograph or an emoji: the book is ink on paper and a colour glyph would be
 * the single plastic object in it.
 *
 * Which marks appear is decided in `decor.ts`, from the itinerary. Nothing in
 * this file decides anything.
 */

const PEN = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.15,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const
}

export type MarkName =
  | 'tower' | 'church' | 'museum' | 'bridge' | 'park' | 'market' | 'water'
  | 'castle' | 'station' | 'theatre' | 'hill' | 'statue'
  | 'fern' | 'olive' | 'maple' | 'palm' | 'bloom'
  | 'compass' | 'key' | 'clock' | 'moon' | 'sun'

/** A landmark sketch, chosen by what the place is called. */
export const MARK: Record<MarkName, React.ReactNode> = {
  tower: <><path d="M9 21 L9.9 8 h4.2 L15 21 Z"/><path d="M10 12h4M9.6 16.4h4.8"/><path d="M10.6 8 L12 4 L13.4 8"/><path d="M12 4 V1.8"/></>,
  church: <><path d="M6 21 V10 h12 v11 Z"/><path d="M6 10 L12 5.4 L18 10"/><path d="M12 5.4 V2.2 M10.6 3.4 h2.8"/><path d="M11 21 v-4.6 a1 1 0 0 1 2 0 V21"/><path d="M9 13h1.6M13.4 13H15"/></>,
  museum: <><path d="M3.4 9.4 L12 4.2 L20.6 9.4"/><path d="M4.6 9.4 V18 M9 9.4 V18 M15 9.4 V18 M19.4 9.4 V18"/><path d="M3 18 h18 M2.4 21 h19.2"/></>,
  bridge: <><path d="M2 16 h20"/><path d="M2 16 C7 7 17 7 22 16"/><path d="M6.2 16 v-4.2M9.6 16 v-6.2M14.4 16 v-6.2M17.8 16 v-4.2"/><path d="M3 16 v4 M21 16 v4"/></>,
  park: <><path d="M12 20 v-6"/><path d="M12 14 C7.4 14 5.6 10.6 7 8 C6 4.8 9.2 2.6 12 4.4 C14.8 2.6 18 4.8 17 8 C18.4 10.6 16.6 14 12 14 Z"/><path d="M4 20 h16"/></>,
  market: <><path d="M4 9 h16 v11 H4 Z"/><path d="M4 9 L6 4.4 h12 L20 9"/><path d="M8 9 l.8-4.6M16 9 l-.8-4.6M12 9 V4.4"/><path d="M9 20 v-5.4 h6 V20"/></>,
  water: <><path d="M2.6 8.6 c2.4-2.4 4.4-2.4 6.6 0 s4.2 2.4 6.6 0 4.2-2.4 5.6 0"/><path d="M2.6 13.4 c2.4-2.4 4.4-2.4 6.6 0 s4.2 2.4 6.6 0 4.2-2.4 5.6 0"/><path d="M2.6 18.2 c2.4-2.4 4.4-2.4 6.6 0 s4.2 2.4 6.6 0 4.2-2.4 5.6 0"/></>,
  castle: <><path d="M4 21 V8 h2.4 V5.6 h2.4 V8 h6.4 V5.6 h2.4 V8 H20 v13 Z"/><path d="M10.4 21 v-5.6 h3.2 V21"/><path d="M7.4 11.6 h2 M14.6 11.6 h2"/></>,
  station: <><path d="M6.4 3.6 h11.2 v12 H6.4 Z" /><path d="M6.4 9 h11.2"/><path d="M6.4 15.6 L4.4 20 M17.6 15.6 L19.6 20"/><path d="M9 12.6 h.1 M15 12.6 h.1"/><path d="M3 20 h18"/></>,
  theatre: <><path d="M5 5.4 C5 14 7.4 19.4 12 20.6 C16.6 19.4 19 14 19 5.4"/><path d="M5 5.4 C9 3.6 15 3.6 19 5.4"/><path d="M9 9.4 c.8-1 1.8-1 2.6 0M12.4 9.4 c.8-1 1.8-1 2.6 0"/><path d="M9.4 14 c1.8 1.8 3.4 1.8 5.2 0"/></>,
  hill: <><path d="M1.8 19.6 L8.6 7.6 L12.4 14 L14.6 11 L22.2 19.6 Z"/><path d="M6.6 11.6 L8.6 12.8 L10.6 11.6"/><path d="M1 19.6 h22"/></>,
  statue: <><path d="M12 8.6 a2 2 0 1 0 0-4 a2 2 0 0 0 0 4Z"/><path d="M12 8.6 V15 M9 11 l3-1.4 3 1.4"/><path d="M10.4 15 L9.4 19 M13.6 15 L14.6 19"/><path d="M7 19 h10 v2 H7 Z"/></>,

  /* Pressed between the pages. Which one depends on where in the world the city
     is, because a pressed palm frond from Helsinki would be a lie. */
  fern: <><path d="M12 21.4 C12 13 13.6 7 19.4 3.2"/>{Array.from({ length: 7 }, (_, i) => {
    const t = i / 7, x = 12 + t * 7, y = 20 - t * 16
    return <path key={i} d={`M${x.toFixed(1)} ${y.toFixed(1)} c-2.4-.6-3.6-2.2-3.4-4.2 2 .4 3.2 2 3.4 4.2Z`} />
  })}</>,
  olive: <><path d="M4.4 18.6 C9 12.4 15 8.2 20.4 6.4"/><path d="M8.6 15 c-.6-2.4.6-4 3-4.4 .4 2.4-.8 4-3 4.4Z"/><path d="M13.4 11.2 c-.6-2.4.6-4 3-4.4 .4 2.4-.8 4-3 4.4Z"/><circle cx="10.6" cy="16.8" r="1.5"/><circle cx="16.4" cy="12.2" r="1.5"/></>,
  maple: <><path d="M12 21.6 V15"/><path d="M12 15 L8 16 L9 13 L4.4 11.4 L7 10 L4 6.6 L8.4 7.4 L8 4.2 L11 6.2 L12 2.4 L13 6.2 L16 4.2 L15.6 7.4 L20 6.6 L17 10 L19.6 11.4 L15 13 L16 16 Z"/></>,
  palm: <><path d="M12 21.6 C12.6 16 12.4 12 11.6 8.6"/><path d="M11.6 8.6 C8.6 5.2 5.4 4.4 2.6 5.6 6 5.6 9 6.8 11.6 8.6Z"/><path d="M11.6 8.6 C14.2 5 17.6 3.8 21 4.8 17.4 5.4 14.2 6.6 11.6 8.6Z"/><path d="M11.6 8.6 C9.6 11.6 8.8 14.6 9.2 17.6 10 14.4 10.8 11.4 11.6 8.6Z"/><path d="M11.6 8.6 C14.8 10.4 16.8 12.8 17.6 15.8 15.4 13.2 13.4 10.8 11.6 8.6Z"/></>,
  bloom: <><g>{[0, 72, 144, 216, 288].map(a =>
    <ellipse key={a} cx="12" cy="6.8" rx="2.8" ry="4.6" transform={`rotate(${a} 12 11.6)`} />)}</g><circle cx="12" cy="11.6" r="1.6"/><path d="M12 13.4 V21.6 M12 17.4 c2-1 3.2-2.6 3.4-4.6"/></>,

  compass: <><circle cx="12" cy="12" r="9.2"/><path d="M12 4.4 L13.6 10.4 L19.6 12 L13.6 13.6 L12 19.6 L10.4 13.6 L4.4 12 L10.4 10.4Z"/><path d="M12 1.6 v1.6"/></>,
  key: <><circle cx="7.4" cy="7.4" r="4.2"/><circle cx="7.4" cy="7.4" r="1.3"/><path d="M10.4 10.4 L20.4 20.4"/><path d="M16.8 16.8 L14.4 19.2 M19 19 l-2 2.2"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6.4 V12 l4 2.4"/><path d="M12 3 v1.4M12 19.6 V21M3 12 h1.4M19.6 12 H21"/></>,
  moon: <><path d="M16.8 2.6 a9.6 9.6 0 1 0 4.6 13.9 A7.8 7.8 0 0 1 16.8 2.6Z"/><circle cx="5" cy="4.6" r=".9"/></>,
  sun: <><circle cx="12" cy="12" r="4.2"/>{Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2
    return <line key={i} x1={12 + Math.cos(a) * 6.6} y1={12 + Math.sin(a) * 6.6}
      x2={12 + Math.cos(a) * 9.4} y2={12 + Math.sin(a) * 9.4} />
  })}</>
}

export function Mark({ name, size = 30, className = '' }: { name: MarkName; size?: number; className?: string }) {
  return (
    <svg className={`jr-mark ${className}`} viewBox="0 0 24 24" width={size} height={size} {...PEN} aria-hidden>
      {MARK[name]}
    </svg>
  )
}

/* --------------------------------------------------------------- the paper */

/** A postage stamp: perforations cut from the paper, a landmark inside, the
    city's name below it and the day's distance where the denomination goes. */
export function Stamp({ mark, place, value, rotate = -4 }: {
  mark: MarkName; place: string; value: string; rotate?: number
}) {
  return (
    <div className="jr-stamp" style={{ '--rot': `${rotate}deg` } as React.CSSProperties}>
      <div className="jr-stamp-in">
        <svg viewBox="0 0 24 24" width="100%" height="46" {...PEN} aria-hidden>{MARK[mark]}</svg>
        <span className="jr-stamp-place">{place}</span>
        <span className="jr-stamp-value">{value}</span>
      </div>
    </div>
  )
}

/** A ticket stub, torn along its perforation, printed with the leg it paid for. */
export function Ticket({ from, to, minutes, mode, rotate = 2, colour }: {
  from: string; to: string; minutes: number; mode: string; rotate?: number; colour?: string
}) {
  return (
    <div className="jr-ticket" style={{ '--rot': `${rotate}deg`, ...(colour ? { '--c': colour } : {}) } as React.CSSProperties}>
      <div className="jr-ticket-stub">
        <span className="jr-ticket-min">{Math.round(minutes)}</span>
        <span className="jr-ticket-unit">min</span>
      </div>
      <div className="jr-ticket-body">
        <span className="jr-ticket-mode">{mode}</span>
        <span className="jr-ticket-route">{from} → {to}</span>
      </div>
    </div>
  )
}

/** A strip of tape. Two of them hold a photograph to the page. */
export function Tape({ className = '' }: { className?: string }) {
  return <span className={`jr-tape ${className}`} aria-hidden />
}
