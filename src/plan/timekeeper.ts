import type { Kind } from './scout'

/* TIMEKEEPER (code). How long a visit takes is a lookup, not a model's guess,
   and the day either fits its window or it does not. */

const VISIT_MIN: Record<Kind, number> = {
  viewpoint: 15, monument: 15, plaza: 15, street: 20, bridge: 10,
  church: 25, park: 30, market: 40, museum: 30, other: 15,
}
export const visitMinutes = (kind: Kind) => VISIT_MIN[kind]

export type DayWindow = { startMin: number; endMin: number }
export const DEFAULT_WINDOW: DayWindow = { startMin: 10 * 60, endMin: 18 * 60 }

/** Total minutes for the day, and any hard complaints (empty = fits). */
export function audit(visitMins: number[], legSecs: number[], window = DEFAULT_WINDOW) {
  const walkMin = legSecs.reduce((a, b) => a + b, 0) / 60
  const totalMin = visitMins.reduce((a, b) => a + b, 0) + walkMin
  const complaints: string[] = []
  if (totalMin > window.endMin - window.startMin) complaints.push(`the day takes ${Math.round(totalMin)} min but the window is ${window.endMin - window.startMin} min`)
  legSecs.forEach((s, i) => { if (s > 25 * 60) complaints.push(`leg ${i + 1} is a ${Math.round(s / 60)} min walk, too long for a compact tour`) })
  return { totalMin, walkMin, complaints }
}
