import { Vector3 } from 'three'
import type { Transport } from '../types'

/* How a route sits on the city, and how each way of travelling looks.
 *
 * Heights come from rays dropped onto photogrammetry, which is a model of
 * whatever is on top: a tree that overhangs the street, an awning, a bridge deck.
 * One such hit among points 30 m apart is a spike in the line. Real streets do not
 * jump twenty metres in thirty, so the heights are cleaned before anything uses
 * them: the same points feed the map lines, the flight camera and the headset's flight. */

const MAX_SLOPE = .3          // metres of height per metre along the route: steeper than any street

/** The same points with their heights made believable: outliers replaced by the median of
    their neighbours, then the slope limited, then a light average. x and z are untouched. */
export function smoothHeights(pts: Vector3[]): Vector3[] {
  const n = pts.length
  if (n < 3) return pts.map(p => p.clone())
  const y = pts.map(p => p.y)
  const median = y.map((_, i) => {
    const w = y.slice(Math.max(0, i - 2), Math.min(n, i + 3)).sort((a, b) => a - b)
    return w[w.length >> 1]
  })
  const run = (from: number, to: number, step: number) => {
    for (let i = from; i !== to; i += step) {
      const d = Math.hypot(pts[i].x - pts[i - step].x, pts[i].z - pts[i - step].z) * MAX_SLOPE
      median[i] = Math.min(median[i - step] + d, Math.max(median[i - step] - d, median[i]))
    }
  }
  run(1, n, 1); run(n - 2, -1, -1)
  return pts.map((p, i) => new Vector3(p.x, (median[Math.max(0, i - 1)] + median[i] * 2 + median[Math.min(n - 1, i + 1)]) / 4, p.z))
}

export type LegStyle = {
  /** The ribbon laid along the street: its width on the ground in metres, and the least it may
      look on screen in pixels, so a route is still a route from two kilometres up. */
  widthM: number
  minPx: number
  /** World metres of mark and gap along it, or null for an unbroken ribbon. */
  dash: { on: number; off: number } | null
  /** A wider, fainter one under it. */
  glow: boolean
  opacity: number
  /** How fast light moves along it in the direction of travel, and the comet with it, metres a second. */
  flowMps: number
  /** For 3D tubes: radius as a fraction of the drawing unit, and bead spacing if drawn as beads. */
  tube: number
  beads: number | null
}

/** Walking is footsteps, cycling long dashes, transit a ribbon and driving a wide road of light.
    A leg that is only an estimate is drawn broken and faint, so a guess never looks like a route. */
export function legStyle(transport: Transport, estimated = false): LegStyle {
  const base: Record<Transport, LegStyle> = {
    walk: { widthM: 5, minPx: 5.5, dash: { on: 8, off: 5 }, glow: false, opacity: .95, flowMps: 18, tube: .0022, beads: .0075 },
    cycle: { widthM: 5, minPx: 5.8, dash: { on: 30, off: 8 }, glow: false, opacity: .95, flowMps: 45, tube: .0026, beads: .016 },
    transit: { widthM: 9, minPx: 8.5, dash: null, glow: true, opacity: .95, flowMps: 90, tube: .0034, beads: null },
    drive: { widthM: 11, minPx: 9.5, dash: null, glow: true, opacity: .95, flowMps: 70, tube: .0042, beads: null },
  }
  const s = base[transport] ?? base.walk      // old plans on disk predate the field
  return estimated ? { ...s, dash: { on: 14, off: 16 }, glow: false, opacity: .45, beads: s.beads ?? .012 } : s
}
