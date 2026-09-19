import { breadcrumb } from '../telemetry'
import type { Budget, LatLon, Leg, Transport, TransportWish } from '../types'
import { postJson } from './net'
import { decodePolyline, metresBetween } from './geo'

/* ROUTER (code, not an LLM). Real travel times from Google Routes, the best
 * visiting order by brute force, then a real polyline per leg.
 *
 * "Whatever suits" is decided here, per leg, from two things the desk actually
 * said — how far apart the places are and what the day may cost — and never
 * from a model's opinion of a city. A leg the router cannot answer for is a
 * straight line priced at the mode's own speed, marked `estimated`, so every
 * surface that draws or prints it can say so. */

type Matrix = { distanceM: (number | null)[][]; durationSec: (number | null)[][] }

/** Metres per second, for the honest fallback only. */
const SPEED: Record<Transport, number> = { walk: 1.35, cycle: 4.2, transit: 6.5, drive: 9 }
/** Streets are not straight. Multiplier from crow-flies to plausible ground. */
const DETOUR = 1.32

/* Beyond this, on foot, a leg stops being part of a day out and becomes the
   day. What replaces walking depends on the budget: free days take the bus,
   modest days take the bus, and days where cost is not the point may drive. */
const WALK_UP_TO_M: Record<Budget, number> = { free: 2200, modest: 1800, any: 1400 }
const FAR_MODE: Record<Budget, Transport> = { free: 'transit', modest: 'transit', any: 'drive' }

/** The concrete mode for one leg. */
export function modeFor(wish: TransportWish, budget: Budget, crowM: number): Transport {
  if (wish !== 'auto') return wish
  return crowM <= WALK_UP_TO_M[budget] ? 'walk' : FAR_MODE[budget]
}

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) { yield items; return }
  for (let i = 0; i < items.length; i++) {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest]
  }
}

const guessSec = (a: LatLon, b: LatLon, transport: Transport) =>
  (metresBetween(a, b) * DETOUR) / SPEED[transport]

/** Order of point indices minimising total travel time, start and end free.
    `fixedFirst` pins index 0 in place, which is what a hotel means. For
    "whatever suits" the matrix is priced on foot if the set is compact and by
    the budget's far mode otherwise — the order barely changes between them,
    and the legs are priced properly afterwards anyway. */
export async function bestOrder(
  points: LatLon[], wish: TransportWish = 'walk', budget: Budget = 'modest', fixedFirst = false,
): Promise<{ order: number[]; totalSec: number; estimated: boolean; minutes: number[][]; transport: Transport }> {
  if (points.length > 9) throw new Error('brute-force routing is only for fewer than 10 stops')
  let far = 0
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) far = Math.max(far, metresBetween(points[i], points[j]))
  const transport = modeFor(wish, budget, far / 2)

  let m: Matrix | null = null
  try { m = await postJson<Matrix>('routes/matrix', { points, transport }) } catch { m = null; breadcrumb('router', 'matrix unavailable; using estimated times', { transport }) }
  const sec = (i: number, j: number) => m?.durationSec[i]?.[j] ?? guessSec(points[i], points[j], transport)

  const movable = points.map((_, i) => i).filter(i => !(fixedFirst && i === 0))
  let best: number[] | null = null, bestSec = Infinity
  for (const tail of permutations(movable)) {
    const order = fixedFirst ? [0, ...tail] : tail
    let total = 0
    for (let i = 1; i < order.length && total < bestSec; i++) total += sec(order[i - 1], order[i])
    if (total < bestSec) { bestSec = total; best = order }
  }
  if (!best) throw new Error('These places cannot be connected.')
  const minutes = points.map((_, i) => points.map((__, j) => i === j ? 0 : sec(i, j) / 60))
  return { order: best, totalSec: bestSec, estimated: !m, minutes, transport }
}

/** One leg per consecutive pair, each priced in the mode that suits it. */
export async function legsFor(
  stops: { id: string; lat: number; lon: number }[], wish: TransportWish = 'walk', budget: Budget = 'modest',
): Promise<Leg[]> {
  return Promise.all(stops.slice(1).map(async (to, i) => {
    const from = stops[i]
    const transport = modeFor(wish, budget, metresBetween(from, to))
    try {
      const r = await postJson<{ encodedPolyline: string; distanceM: number; durationSec: number }>(
        'routes/walk', { from, to, transport })
      return {
        fromStopId: from.id, toStopId: to.id, polyline: decodePolyline(r.encodedPolyline),
        distanceM: r.distanceM, durationSec: r.durationSec, transport, estimated: false,
      }
    } catch {
      breadcrumb('router', 'leg fell back to a straight-line estimate', { from: from.id, to: to.id, transport })
      return {
        fromStopId: from.id, toStopId: to.id,
        polyline: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
        distanceM: Math.round(metresBetween(from, to) * DETOUR),
        durationSec: Math.round(guessSec(from, to, transport)),
        transport, estimated: true,
      }
    }
  }))
}

export const walkingLegs = legsFor
