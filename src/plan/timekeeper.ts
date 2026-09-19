import type { Meal, Pace, Party, Transport, Wish } from '../types'
import { HHMM, MINS, PACE_FACTOR } from '../types'
import type { Kind } from './scout'

/* TIMEKEEPER (code). How long a visit takes starts as a lookup, may be adjusted
   by the scout within bounds, and is never a model's unbounded guess; the day
   either fits the window the person gave or it does not; and a day that walks
   you into a cathedral at one o'clock with no lunch is a timetable, not a
   plan.

   These are minutes for a *real* day out, not for a camera hold. A museum is
   two hours. The flythrough paces itself from the narration and ignores this
   number entirely, which is what lets the same Plan be both. */

const VISIT_MIN: Record<Kind, number> = {
  viewpoint: 30, monument: 30, plaza: 30, street: 45, bridge: 15,
  church: 45, park: 60, market: 60, museum: 120, other: 40,
}
/** How far a per-place estimate may move from the table. */
const BOUNDS: Record<Kind, [number, number]> = {
  viewpoint: [15, 60], monument: [15, 75], plaza: [15, 60], street: [20, 90], bridge: [10, 30],
  church: [20, 90], park: [30, 150], market: [30, 120], museum: [60, 240], other: [15, 120],
}

/* Who is travelling changes how long a place takes as much as the pace does.
   Children do not leave a park in thirty minutes; someone taking it easy needs
   the sitting-down time nobody ever puts in a plan. */
const PARTY_FACTOR: Record<Party, number> = { solo: 0.9, couple: 1, family: 1.25, easy: 1.2 }

/** Minutes at a stop of this kind, for this pace and this party. `estimate`
    is the scout's own figure for this particular place, honoured only inside
    the kind's bounds. Rounded to five so the book prints a number a person
    would say out loud. */
export function visitMinutes(kind: Kind, pace: Pace = 'steady', party: Party = 'solo', estimate?: number) {
  const [lo, hi] = BOUNDS[kind]
  const base = estimate && Number.isFinite(estimate) ? Math.min(hi, Math.max(lo, estimate)) : VISIT_MIN[kind]
  return Math.max(10, Math.round(base * PACE_FACTOR[pace] * PARTY_FACTOR[party] / 5) * 5)
}

export type DayWindow = { startMin: number; endMin: number }
export const DEFAULT_WINDOW: DayWindow = { startMin: 10 * 60, endMin: 18 * 60 }

/** The window the desk asked for. An end before the start means past midnight,
    which nobody means, so it is read as a full day instead. */
export function windowOf(wish: Pick<Wish, 'startAt' | 'endAt'>): DayWindow {
  const startMin = MINS(wish.startAt || '10:00')
  const endMin = MINS(wish.endAt || '18:00')
  return endMin > startMin ? { startMin, endMin } : { startMin, endMin: startMin + 8 * 60 }
}

/* When a meal is taken, and how long it is kept clear for. The break is placed
   after the first stop the clock leaves later than this hour — never in the
   middle of a stop, because you cannot half-visit a bridge. */
const MEAL: Record<Meal, { after: number; min: number; label: string }> = {
  lunch: { after: 12 * 60 + 30, min: 60, label: 'lunch' },
  dinner: { after: 18 * 60 + 30, min: 75, label: 'dinner' },
}
export const mealMinutes = (meals: Meal[]) => meals.reduce((s, m) => s + MEAL[m].min, 0)

/** How long a single leg may be before it is not a compact day any more. */
const LEG_CEILING_SEC: Record<Transport, number> = {
  walk: 30 * 60, cycle: 25 * 60, transit: 45 * 60, drive: 40 * 60,
}

/** Total minutes for the day, and any hard complaints (empty = it fits). */
export function audit(
  visitMins: number[], legSecs: number[],
  window = DEFAULT_WINDOW, transports: Transport[] | Transport = 'walk', meals: Meal[] = [],
) {
  const travelMin = legSecs.reduce((a, b) => a + b, 0) / 60
  const eating = mealMinutes(meals)
  const totalMin = visitMins.reduce((a, b) => a + b, 0) + travelMin + eating
  const complaints: string[] = []
  const span = window.endMin - window.startMin
  if (totalMin > span) {
    complaints.push(`the day takes ${Math.round(totalMin)} min${eating ? ` (including ${eating} for meals)` : ''} but the window is ${span} min`)
  }
  legSecs.forEach((s, i) => {
    const t = Array.isArray(transports) ? transports[i] ?? 'walk' : transports
    if (s > LEG_CEILING_SEC[t]) complaints.push(`leg ${i + 1} is a ${Math.round(s / 60)} min journey by ${t}, too long for a compact day`)
  })
  return { totalMin, walkMin: travelMin, mealMin: eating, complaints, slackMin: span - totalMin }
}

export type Schedule = {
  arrivals: string[]
  breaks: { after: number; minutes: number; label: string }[]
  endsAt: string
}

/** The clock, walked forward. `approachSec` is the hop from a given starting
    point to the first stop; it happens before the first arrival, not at it. */
export function schedule(
  visitMins: number[], legSecs: number[], window: DayWindow, approachSec = 0, meals: Meal[] = [],
): Schedule {
  const pending = meals.slice().sort((a, b) => MEAL[a].after - MEAL[b].after)
  const breaks: Schedule['breaks'] = []
  let clock = window.startMin + approachSec / 60
  const arrivals = visitMins.map((stay, i) => {
    const at = clock
    clock += stay
    const due = pending[0]
    if (due && clock >= MEAL[due].after && i < visitMins.length - 1) {
      breaks.push({ after: i, minutes: MEAL[due].min, label: MEAL[due].label })
      clock += MEAL[due].min
      pending.shift()
    }
    clock += (legSecs[i] ?? 0) / 60
    return HHMM(at)
  })
  return { arrivals, breaks, endsAt: HHMM(clock) }
}

export const arrivals = (v: number[], l: number[], w: DayWindow, a = 0, m: Meal[] = []) => schedule(v, l, w, a, m).arrivals

/** How many minutes of visiting a day has room for, after meals and a guess
    at travel. Used to decide how many places a day should hold *before* the
    scout is asked, so it is asked for a number that can actually fit. */
export function visitBudgetMin(wish: Wish, travelGuessMin = 60) {
  const w = windowOf(wish)
  return Math.max(60, w.endMin - w.startMin - mealMinutes(wish.meals) - travelGuessMin)
}
