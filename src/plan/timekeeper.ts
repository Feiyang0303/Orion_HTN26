import type { Meal, Pace, Party, Transport, Wish } from '../types'
import { HHMM, MINS, PACE_FACTOR } from '../types'
import type { Kind } from './scout'

/* TIMEKEEPER (code). How long a visit takes is a lookup, not a model's guess;
   the day either fits the window the person gave or it does not; and a day
   that walks you into a cathedral at one o'clock with no lunch is a timetable,
   not a plan. */

const VISIT_MIN: Record<Kind, number> = {
  viewpoint: 15, monument: 15, plaza: 15, street: 20, bridge: 10,
  church: 25, park: 30, market: 40, museum: 30, other: 15,
}

/* Who is travelling changes how long a place takes as much as the pace does.
   Children do not leave a park in thirty minutes; someone taking it easy needs
   the sitting-down time nobody ever puts in a plan. */
const PARTY_FACTOR: Record<Party, number> = { solo: 0.9, couple: 1, family: 1.25, easy: 1.2 }

/** Minutes at a stop of this kind, for this pace and this party. Rounded to
    five so the book prints a number a person would say out loud. */
export const visitMinutes = (kind: Kind, pace: Pace = 'steady', party: Party = 'solo') =>
  Math.max(10, Math.round(VISIT_MIN[kind] * PACE_FACTOR[pace] * PARTY_FACTOR[party] / 5) * 5)

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

/** How long a single leg may be before it is not a compact day any more.
    Walking twenty-five minutes between two stops is a slog; the same distance
    on a bicycle or a tram is not, so the ceiling moves with the transport. */
const LEG_CEILING_SEC: Record<Transport, number> = {
  walk: 25 * 60, cycle: 20 * 60, transit: 35 * 60, drive: 30 * 60,
}

/** Total minutes for the day, and any hard complaints (empty = it fits). */
export function audit(
  visitMins: number[], legSecs: number[],
  window = DEFAULT_WINDOW, transport: Transport = 'walk', meals: Meal[] = [],
) {
  const travelMin = legSecs.reduce((a, b) => a + b, 0) / 60
  const eating = mealMinutes(meals)
  const totalMin = visitMins.reduce((a, b) => a + b, 0) + travelMin + eating
  const complaints: string[] = []
  const span = window.endMin - window.startMin
  if (totalMin > span) {
    complaints.push(`the day takes ${Math.round(totalMin)} min${eating ? ` (including ${eating} for meals)` : ''} but the window is ${span} min`)
  }
  const ceiling = LEG_CEILING_SEC[transport]
  legSecs.forEach((s, i) => {
    if (s > ceiling) complaints.push(`leg ${i + 1} is a ${Math.round(s / 60)} min journey, too long for a compact day`)
  })
  return { totalMin, walkMin: travelMin, mealMin: eating, complaints }
}

export type Schedule = {
  /** 'HH:MM' per stop. */
  arrivals: string[]
  /** Minutes kept clear *after* stop i, and what for. Zero almost everywhere. */
  breaks: { after: number; minutes: number; label: string }[]
  /** When the last stop is done with. */
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
    // A meal lands in the first gap that opens after its hour, between stops.
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

/** Kept for callers that only want the times. */
export const arrivals = (v: number[], l: number[], w: DayWindow, a = 0, m: Meal[] = []) => schedule(v, l, w, a, m).arrivals
