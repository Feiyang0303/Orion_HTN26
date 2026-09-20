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
/** The meals that cost the day's hours anything: dinner after a day that ends at six is the evening's business. */
export const mealsInside = (meals: Meal[], w: { endMin: number }) => meals.filter(m => MEAL[m].after < w.endMin - 30)

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
  /** How long is actually spent at each stop. The same as what was asked for
      unless the day had to be squeezed to fit its hours — see `trimmedMin`. */
  stays: number[]
  /** Minutes taken out of the stops to bring the day back inside its window.
      0 when nothing had to give. The book prints it rather than hiding it. */
  trimmedMin: number
  /** True when the day still ends after the hour asked for, even squeezed.
      Then there are simply too many places in it, and saying so is the only
      honest thing left. */
  overruns: boolean
}

/* A stop can be shortened but not to nothing: below this it is a photograph,
   not a visit, and the plan would be lying about what the day contains. */
const FLOOR_MIN = 25
/* And no stop gives up more than this share of itself, so a day that is
   wildly too full overruns and says so instead of quietly turning four
   galleries into four coffee breaks. */
const MOST_GIVEN_UP = 0.4

/** The clock, walked forward. `approachSec` is the hop from a given starting
    point to the first stop; it happens before the first arrival, not at it. */
export function schedule(
  visitMins: number[], legSecs: number[], window: DayWindow, approachSec = 0, meals: Meal[] = [],
): Schedule {
  /* The clock used to be walked forward and whatever hour it landed on was
     the answer, so a day asked to end at six could be handed back ending at
     twenty to ten. The hours a person gives are not a suggestion: the stops
     are squeezed, within reason, until the day fits inside them. Travel and
     meals cannot be squeezed — a leg takes as long as it takes — so only the
     stays give. */
  const walk = (stays: number[]) => {
    const pending = meals.slice().sort((a, b) => MEAL[a].after - MEAL[b].after)
    const breaks: Schedule['breaks'] = []
    let clock = window.startMin + approachSec / 60
    const arrivals = stays.map((stay, i) => {
      const at = clock
      clock += stay
      const due = pending[0]
      if (due && clock >= MEAL[due].after && i < stays.length - 1) {
        breaks.push({ after: i, minutes: MEAL[due].min, label: MEAL[due].label })
        clock += MEAL[due].min
        pending.shift()
      }
      clock += (legSecs[i] ?? 0) / 60
      return HHMM(at)
    })
    return { arrivals, breaks, endMin: clock }
  }

  const asked = visitMins.map(m => Math.round(m))
  /** Every stay scaled by `k`, but never under its own floor. */
  const squeeze = (k: number) => asked.map(m => Math.max(Math.min(m, FLOOR_MIN), Math.round(m * k)))

  let stays = asked
  let run = walk(stays)
  if (run.endMin > window.endMin) {
    /* The gentlest squeeze that fits, found by bisection on the scale. The
       invariant is that `lo` is a scale already checked to fit, so the answer
       is always a day that was actually walked and actually fitted — which
       matters because this is not smooth: a stop at its floor stops giving,
       and a meal break can land on the other side of a stop once the clock
       moves under it. */
    const most = 1 - MOST_GIVEN_UP
    const fits = (k: number) => walk(squeeze(k)).endMin <= window.endMin
    let k = most
    if (fits(most)) {
      let lo = most, hi = 1
      for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid }
      k = lo
    }
    // Squeezed as far as it is allowed to go and still too long: take it anyway,
    // because it is closer, and let `overruns` say the day has too much in it.
    const fitted = squeeze(k)
    const best = walk(fitted)
    if (best.endMin < run.endMin) { stays = fitted; run = best }
  }

  const trimmedMin = asked.reduce((n, m, i) => n + (m - stays[i]), 0)
  return {
    arrivals: run.arrivals, breaks: run.breaks, endsAt: HHMM(run.endMin),
    stays, trimmedMin, overruns: run.endMin > window.endMin,
  }
}

export const arrivals = (v: number[], l: number[], w: DayWindow, a = 0, m: Meal[] = []) => schedule(v, l, w, a, m).arrivals

/** How many minutes of visiting a day has room for, after meals and a guess
    at travel. Used to decide how many places a day should hold *before* the
    scout is asked, so it is asked for a number that can actually fit. */
export function visitBudgetMin(wish: Wish, travelGuessMin = 90) {
  const w = windowOf(wish)
  // Only a meal that falls inside the hours costs the hours anything: dinner
  // after a day that ends at six is the evening's business, not the day's.
  const inside = mealsInside(wish.meals, w)
  return Math.max(60, w.endMin - w.startMin - mealMinutes(inside) - travelGuessMin)
}
