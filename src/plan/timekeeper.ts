import type { Pace, Transport, Wish } from '../types'
import { MINS, PACE_FACTOR } from '../types'
import type { Kind } from './scout'

/* TIMEKEEPER (code). How long a visit takes is a lookup, not a model's guess,
   and the day either fits the window the person gave or it does not. */

const VISIT_MIN: Record<Kind, number> = {
  viewpoint: 15, monument: 15, plaza: 15, street: 20, bridge: 10,
  church: 25, park: 30, market: 40, museum: 30, other: 15,
}

/** Minutes at a stop of this kind, at this pace. Rounded to five so the book
    prints a number a person would say out loud. */
export const visitMinutes = (kind: Kind, pace: Pace = 'steady') =>
  Math.max(10, Math.round(VISIT_MIN[kind] * PACE_FACTOR[pace] / 5) * 5)

export type DayWindow = { startMin: number; endMin: number }
export const DEFAULT_WINDOW: DayWindow = { startMin: 10 * 60, endMin: 18 * 60 }

/** The window the desk asked for. An end before the start means past midnight,
    which nobody means, so it is read as a full day instead. */
export function windowOf(wish: Pick<Wish, 'startAt' | 'endAt'>): DayWindow {
  const startMin = MINS(wish.startAt || '10:00')
  const endMin = MINS(wish.endAt || '18:00')
  return endMin > startMin ? { startMin, endMin } : { startMin, endMin: startMin + 8 * 60 }
}

/** How long a single leg may be before it is not a compact day any more.
    Walking twenty-five minutes between two stops is a slog; the same distance
    on a bicycle or a tram is not, so the ceiling moves with the transport. */
const LEG_CEILING_SEC: Record<Transport, number> = {
  walk: 25 * 60, cycle: 20 * 60, transit: 35 * 60, drive: 30 * 60,
}

/** Total minutes for the day, and any hard complaints (empty = it fits). */
export function audit(
  visitMins: number[], legSecs: number[],
  window = DEFAULT_WINDOW, transport: Transport = 'walk',
) {
  const travelMin = legSecs.reduce((a, b) => a + b, 0) / 60
  const totalMin = visitMins.reduce((a, b) => a + b, 0) + travelMin
  const complaints: string[] = []
  const span = window.endMin - window.startMin
  if (totalMin > span) complaints.push(`the day takes ${Math.round(totalMin)} min but the window is ${span} min`)
  const ceiling = LEG_CEILING_SEC[transport]
  legSecs.forEach((s, i) => {
    if (s > ceiling) complaints.push(`leg ${i + 1} is a ${Math.round(s / 60)} min journey, too long for a compact day`)
  })
  return { totalMin, walkMin: travelMin, complaints }
}

/** Arrival times, walked forward from the start of the window. `approachSec`
    is the hop from a given starting point to the first stop; it happens before
    the first arrival, not at it. */
export function arrivals(
  visitMins: number[], legSecs: number[], window: DayWindow, approachSec = 0,
): string[] {
  let clock = window.startMin + approachSec / 60
  return visitMins.map((stay, i) => {
    const at = clock
    clock += stay + (legSecs[i] ?? 0) / 60
    return hhmm(at)
  })
}

const hhmm = (mins: number) =>
  `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(Math.round(mins) % 60).padStart(2, '0')}`
