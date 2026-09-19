import { useMemo } from 'react'
import { MARK, type MarkName } from './Marks'
import { markFor } from './decor'
import type { LatLon, Plan, Transport } from '../../types'

/* Two drawings of the same day, and they are not the same drawing.
 *
 * `RouteSheet` is the one on the paper: numbered stops laid out along a hand
 * drawn line, with the travel time written beside each hop. It is a *diagram*.
 * Its line says "then this, then this" and claims nothing about the ground —
 * which is exactly why it is allowed to curve prettily and space the stops
 * evenly no matter how far apart they really are.
 *
 * `RouteMap` is the one that claims to be the world, so it is drawn only from
 * the polylines the router returned. An estimated leg is drawn as a faint
 * dotted bearing and said to be a guess. A straight line between two points,
 * drawn confidently across a river and through a railway cutting, is the most
 * expensive lie a travel app can tell.
 */

const PEN = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.15,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

/* The mark in the margin beside a travel time. Drawn, not an emoji: the book is
   ink on paper and a colour glyph would be the one plastic thing on the page. */
export const TRANSPORT_MARK: Record<Transport, string> = {
  walk: 'M3 20 L7 13 L6 8 L9 4 M7 13 L12 15 M9 4 L13 7 M6 20 L11 15',
  cycle: 'M5 17 m-3.4 0 a3.4 3.4 0 1 0 6.8 0 a3.4 3.4 0 1 0 -6.8 0 M19 17 m-3.4 0 a3.4 3.4 0 1 0 6.8 0 a3.4 3.4 0 1 0 -6.8 0 M5 17 L10 8 L15 8 M10 8 L14 17',
  drive: 'M3 15 L4.6 10 H17.4 L19 15 M3 15 H21 V18 H3 Z M6 18 v1.6 M18 18 v1.6',
  transit: 'M6 4 H18 V15 H6 Z M6 15 L4.5 19 M18 15 L19.5 19 M6 9 H18 M8.6 12.6 h.1 M15.4 12.6 h.1',
}

/* ------------------------------------------------------- the drawn diagram */

export function RouteSheet({ plan, active, onPick }: {
  plan: Plan
  active?: number
  onPick?: (index: number) => void
}) {
  const stops = plan.stops
  const W = 640, H = 300

  /* A lane that meanders down the page rather than a straight rule — the line a
     hand draws when it is joining things up, not a chart axis. The wobble is
     derived from the stop count, so the same day always draws the same line. */
  const points = useMemo(() => stops.map((s, i) => {
    const t = stops.length === 1 ? 0.5 : i / (stops.length - 1)
    // Inset enough that the *name* fits, not just the disc.
    const x = 86 + t * (W - 172)
    const ease = Math.sin(t * Math.PI)
    const y = H / 2 - 22 + Math.sin(t * Math.PI * (stops.length > 4 ? 2.2 : 1.4)) * 44 * (0.35 + ease * 0.65)
    return { x, y, s }
  }), [stops])

  const path = useMemo(() => {
    if (points.length < 2) return ''
    let d = `M${points[0].x} ${points[0].y}`
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]
      const mx = (a.x + b.x) / 2
      d += ` C${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`
    }
    return d
  }, [points])

  if (!stops.length) return <p className="jr-empty">The line will be drawn once there are stops to join.</p>

  return (
    <svg className="jr-sheet" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`The day through ${stops.length} stops`}>
      <path className="jr-sheet-line" d={path} {...PEN} strokeWidth={1.4} strokeDasharray="7 6" />
      {points.map(({ x, y, s }, i) => {
        const next = points[i + 1]
        const leg = plan.legs[i]
        return (
          <g key={s.id}>
            {next && leg && (
              <g className="jr-sheet-leg" transform={`translate(${(x + next.x) / 2 - 12} ${(y + next.y) / 2 - 34})`}>
                <path d={TRANSPORT_MARK[leg.transport]} {...PEN} strokeWidth={1} transform="scale(.72)" />
                <text x="9" y="30" className="jr-sheet-min">{Math.round(leg.durationSec / 60)}′</text>
              </g>
            )}
            <g className={`jr-sheet-stop ${active === i ? 'is-active' : ''}`}
              transform={`translate(${x} ${y})`}
              onClick={onPick ? () => onPick(i) : undefined}
              role={onPick ? 'button' : undefined} tabIndex={onPick ? 0 : undefined}
              onKeyDown={onPick ? e => { if (e.key === 'Enter') onPick(i) } : undefined}>
              <circle r="15" className="jr-sheet-disc" />
              <text className="jr-sheet-no" y="5" textAnchor="middle">{i + 1}</text>
              <g transform="translate(-11 -42)" className="jr-sheet-icon">
                <svg viewBox="0 0 24 24" width="22" height="22" {...PEN} strokeWidth={1}>
                  {MARK[markFor(s.name, i) as MarkName]}
                </svg>
              </g>
              <text className="jr-sheet-name" y="32" textAnchor="middle">{trim(s.name, 18)}</text>
              {s.arrival && <text className="jr-sheet-time" y="45" textAnchor="middle">{s.arrival}</text>}
            </g>
          </g>
        )
      })}
    </svg>
  )
}

const trim = (s: string, n: number) => s.length > n ? `${s.slice(0, n - 1)}…` : s

/* ------------------------------------------------------------- the real map */

export function RouteMap({ plan, height = 260 }: { plan: Plan; height?: number }) {
  const legs = useMemo(() => {
    const out: { pts: LatLon[]; estimated: boolean }[] = []
    if (plan.approach && plan.from && plan.stops[0]) out.push(geom(plan.approach.polyline, plan.approach.estimated, plan.from, plan.stops[0]))
    plan.legs.forEach((l, i) => {
      const a = plan.stops[i], b = plan.stops[i + 1]
      if (a && b) out.push(geom(l.polyline, l.estimated, a, b))
    })
    return out
  }, [plan])

  const marks = useMemo(() => [
    ...(plan.from ? [{ lat: plan.from.lat, lon: plan.from.lon, label: '·' }] : []),
    ...plan.stops.map((s, i) => ({ lat: s.lat, lon: s.lon, label: String(i + 1) })),
  ], [plan])

  const box = useMemo(() => {
    const all = [...legs.flatMap(l => l.pts), ...marks]
    if (!all.length) return null
    const lons = all.map(p => p.lon), lats = all.map(p => p.lat)
    const west = Math.min(...lons), east = Math.max(...lons)
    const south = Math.min(...lats), north = Math.max(...lats)
    const padX = Math.max(0.0008, (east - west) * 0.12), padY = Math.max(0.0008, (north - south) * 0.12)
    return { west: west - padX, east: east + padX, south: south - padY, north: north + padY }
  }, [legs, marks])

  if (!box) return <p className="jr-empty">The road appears once the router answers.</p>

  const W = 560, H = height
  // Web-Mercator in the vertical: at city scale a plate carrée map of a
  // northern city is visibly squashed, and this costs four lines.
  const myOf = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2))
  const y0 = myOf(box.south), y1 = myOf(box.north)
  const X = (lon: number) => ((lon - box.west) / (box.east - box.west || 1)) * W
  const Y = (lat: number) => H - ((myOf(lat) - y0) / (y1 - y0 || 1)) * H
  const toPath = (pts: LatLon[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.lon).toFixed(1)} ${Y(p.lat).toFixed(1)}`).join(' ')
  const anyEstimated = legs.some(l => l.estimated)

  return (
    <figure className="jr-map">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The day on the ground">
        {legs.map((l, i) => (
          <path key={i} d={toPath(l.pts)} {...PEN}
            className={l.estimated ? 'jr-map-guess' : 'jr-map-road'}
            strokeWidth={l.estimated ? 1 : 2.1}
            strokeDasharray={l.estimated ? '3 5' : undefined} />
        ))}
        {marks.map((m, i) => (
          <g key={i} transform={`translate(${X(m.lon).toFixed(1)} ${Y(m.lat).toFixed(1)})`}>
            <circle r="9" className="jr-map-disc" />
            <text y="4" textAnchor="middle" className="jr-map-no">{m.label}</text>
          </g>
        ))}
      </svg>
      <figcaption>
        {anyEstimated
          ? 'Solid lines are the road as the router returned it. Dotted ones are straight-line guesses — those legs were not routed.'
          : 'Drawn from the route geometry the router returned, not from straight lines between the stops.'}
      </figcaption>
    </figure>
  )
}

/** A leg's geometry, or the honest two-point bearing when there is none. A
    returned geometry has to plausibly join these two points: a decoder that
    slips, or a service answering about somewhere else, puts one coordinate in
    another hemisphere and stretches the box until the city is four pixels wide. */
function geom(polyline: LatLon[], estimated: boolean, a: LatLon, b: LatLon) {
  const ok = polyline.length >= 2 && polyline.every(p =>
    Math.abs(p.lat - (a.lat + b.lat) / 2) < 0.6 && Math.abs(p.lon - (a.lon + b.lon) / 2) < 0.8)
  return ok && !estimated
    ? { pts: polyline, estimated: false }
    : { pts: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }], estimated: true }
}
