import type { LatLon, Leg, Transport } from '../types'
import { postJson } from './net'
import { decodePolyline, metresBetween } from './geo'

/* ROUTER (code, not an LLM). Real travel times from Google Routes, the best
   visiting order by brute force, then a real polyline per leg.
 *
 * When the router cannot answer — no key, no route, a transit query at three
 * in the morning — the leg is not abandoned: it becomes a straight line priced
 * at the transport's own speed, and it is marked `estimated` so every surface
 * that draws or prints it can say so. */

type Matrix = { distanceM: (number | null)[][]; durationSec: (number | null)[][] }

/** Metres per second, for the honest fallback only. */
const SPEED: Record<Transport, number> = { walk: 1.35, cycle: 4.2, transit: 6.5, drive: 9 }
/** Streets are not straight. Multiplier from crow-flies to plausible ground. */
const DETOUR = 1.32

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) { yield items; return }
  for (let i = 0; i < items.length; i++) {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest]
  }
}

const guessSec = (a: LatLon, b: LatLon, transport: Transport) =>
  (metresBetween(a, b) * DETOUR) / SPEED[transport]

/** Order of point indices minimising total travel time, start and end free.
    `fixedFirst` pins index 0 in place, which is what a given starting point
    means. Falls back to straight-line times when the matrix is unavailable. */
export async function bestOrder(
  points: LatLon[], transport: Transport = 'walk', fixedFirst = false,
): Promise<{ order: number[]; totalSec: number; estimated: boolean }> {
  if (points.length > 8) throw new Error('brute-force routing is only for fewer than 9 stops')
  let m: Matrix | null = null
  try { m = await postJson<Matrix>('routes/matrix', { points, transport }) } catch { m = null }

  const sec = (i: number, j: number) =>
    m?.durationSec[i]?.[j] ?? guessSec(points[i], points[j], transport)

  const movable = points.map((_, i) => i).filter(i => !(fixedFirst && i === 0))
  let best: number[] | null = null, bestSec = Infinity
  for (const tail of permutations(movable)) {
    const order = fixedFirst ? [0, ...tail] : tail
    let total = 0
    for (let i = 1; i < order.length && total < bestSec; i++) total += sec(order[i - 1], order[i])
    if (total < bestSec) { bestSec = total; best = order }
  }
  if (!best) throw new Error('These places cannot be connected.')
  return { order: best, totalSec: bestSec, estimated: !m }
}

/** One leg per consecutive pair. A leg that the router will not answer for is
    still a leg — a straight line, priced, and labelled as a guess. */
export async function legsFor(
  stops: { id: string; lat: number; lon: number }[], transport: Transport = 'walk',
): Promise<Leg[]> {
  return Promise.all(stops.slice(1).map(async (to, i) => {
    const from = stops[i]
    try {
      const r = await postJson<{ encodedPolyline: string; distanceM: number; durationSec: number }>(
        'routes/walk', { from, to, transport })
      return {
        fromStopId: from.id, toStopId: to.id, polyline: decodePolyline(r.encodedPolyline),
        distanceM: r.distanceM, durationSec: r.durationSec, transport, estimated: false,
      }
    } catch {
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

/** Kept for the old name; the flythrough imports nothing from here. */
export const walkingLegs = legsFor
