import type { Leg, LatLon } from '../types'
import { postJson } from './net'
import { decodePolyline } from './geo'

/* ROUTER (code, not an LLM). Real walking distances from Google Routes, the
   best visiting order by brute force, then a walking polyline per leg. */

type Matrix = { distanceM: (number | null)[][]; durationSec: (number | null)[][] }

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) { yield items; return }
  for (let i = 0; i < items.length; i++) {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest]
  }
}

/** Order of point indices minimising total walking time, start and end free. */
export async function bestOrder(points: LatLon[]): Promise<{ order: number[]; totalSec: number }> {
  if (points.length > 8) throw new Error('brute-force routing is only for fewer than 9 stops')
  const m = await postJson<Matrix>('routes/matrix', { points })
  let best: number[] | null = null, bestSec = Infinity
  for (const order of permutations(points.map((_, i) => i))) {
    let sec = 0
    for (let i = 1; i < order.length && sec < bestSec; i++) sec += m.durationSec[order[i - 1]][order[i]] ?? Infinity
    if (sec < bestSec) { bestSec = sec; best = order }
  }
  if (!best) throw new Error('These places cannot be connected on foot.')
  return { order: best, totalSec: bestSec }
}

export async function walkingLegs(stops: { id: string; lat: number; lon: number }[]): Promise<Leg[]> {
  return Promise.all(stops.slice(1).map(async (to, i) => {
    const from = stops[i]
    const r = await postJson<{ encodedPolyline: string; distanceM: number; durationSec: number }>('routes/walk', { from, to })
    return { fromStopId: from.id, toStopId: to.id, polyline: decodePolyline(r.encodedPolyline), distanceM: r.distanceM, durationSec: r.durationSec }
  }))
}
