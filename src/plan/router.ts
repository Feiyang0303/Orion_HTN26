import { breadcrumb } from '../telemetry'
import type { Budget, LatLon, Leg, Transport, TransportWish, Wish } from '../types'
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
  /** The day comes back to where it started, so the journey home is part of
      what the order costs. Without this the optimiser is free to finish on the
      far side of the city, which costs nothing on an open path and three
      quarters of an hour on a real evening. */
  loop = false,
): Promise<{ order: number[]; totalSec: number; estimated: boolean; minutes: number[][]; transport: Transport }> {
  let far = 0
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) far = Math.max(far, metresBetween(points[i], points[j]))
  let transport = modeFor(wish, budget, far / 2)

  /* The order is only as good as the times it is chosen from, and a city with
     no transit data answers the matrix with a grid of nulls — every cell then
     falls back to a crow-flies guess and the day is ordered as if the streets
     were straight. So an empty answer is asked again in a mode the city can
     actually answer for, exactly as a leg is. */
  const usable = (g: Matrix | null) => {
    if (!g) return false
    let have = 0, want = 0
    for (let i = 0; i < points.length; i++) for (let j = 0; j < points.length; j++) {
      if (i === j) continue
      want++
      if (g.durationSec[i]?.[j] != null) have++
    }
    return want === 0 || have >= want / 2
  }
  const askMatrix = async (mode: Transport) => {
    try { return await postJson<Matrix>('routes/matrix', { points, transport: mode }) } catch { return null }
  }
  let m: Matrix | null = await askMatrix(transport)
  if (!usable(m)) {
    for (const alt of FALLBACK[transport]) {
      const g = await askMatrix(alt)
      if (usable(g)) {
        breadcrumb('router', `no ${transport} times in this city; the order is measured by ${alt}`, {})
        m = g; transport = alt; break
      }
    }
  }
  if (!usable(m)) { m = null; breadcrumb('router', 'matrix unavailable; using estimated times', { transport }) }
  const sec = (i: number, j: number) => m?.durationSec[i]?.[j] ?? guessSec(points[i], points[j], transport)

  const movable = points.map((_, i) => i).filter(i => !(fixedFirst && i === 0))
  const home = loop && fixedFirst ? 0 : -1        // the point the day returns to, if it returns to one
  const backHome = (order: number[]) => home < 0 ? 0 : sec(order[order.length - 1], home)
  const cost = (order: number[]) => {
    let t = 0
    for (let i = 1; i < order.length; i++) t += sec(order[i - 1], order[i])
    return t + backHome(order)
  }
  let best: number[] | null = null, bestSec = Infinity

  if (movable.length <= 8) {
    // Small enough to try every order.
    for (const tail of permutations(movable)) {
      const order = fixedFirst ? [0, ...tail] : tail
      const total = cost(order)
      if (total < bestSec) { bestSec = total; best = order }
    }
  } else {
    /* A full day can be a dozen places. Nearest-neighbour from the start,
       then 2-opt until no swap helps: not provably optimal, but within a few
       minutes of it on a city's worth of points, and instant. */
    const start = fixedFirst ? 0 : movable[0]
    const left = new Set(movable.filter(i => i !== start))
    const order = [start]
    while (left.size) {
      const here = order[order.length - 1]
      let next = -1, nd = Infinity
      for (const j of left) { const d = sec(here, j); if (d < nd) { nd = d; next = j } }
      order.push(next); left.delete(next)
    }
    let improved = true
    while (improved) {
      improved = false
      /* `k` runs to the last index when the day loops, because reversing a tail
         that ends the day is exactly the move that stops it ending far from
         the bed — the one improvement an open path can never see. */
      const last = order.length - (home < 0 ? 2 : 1)
      for (let i = fixedFirst ? 1 : 0; i <= last; i++) {
        for (let k = i + 1; k <= last; k++) {
          const a = order[i - 1] ?? order[i], b = order[i], c = order[k]
          const d = order[k + 1] ?? (home < 0 ? -1 : home)
          if (d < 0) continue
          const before = (i ? sec(a, b) : 0) + sec(c, d)
          const after = (i ? sec(a, c) : 0) + sec(b, d)
          if (after + 1e-6 < before) { order.splice(i, k - i + 1, ...order.slice(i, k + 1).reverse()); improved = true }
        }
      }
    }
    best = order; bestSec = cost(order)
  }
  if (!best) throw new Error('These places cannot be connected.')
  const minutes = points.map((_, i) => points.map((__, j) => i === j ? 0 : sec(i, j) / 60))
  return { order: best, totalSec: bestSec, estimated: !m, minutes, transport }
}

/* Every leg of a day used to be asked for at once, and one that came back
   unhappy was given up on immediately. A leg given up on is drawn as a
   straight line across the city and printed as "not routed", which is how a
   day comes out looking like two places that are not joined to the rest of it
   — usually for a moment's rate limiting on a burst of eight simultaneous
   requests. So the burst is capped and a leg is asked for again before the
   map is allowed to lie about it. */
const LEG_TRIES = 3
const LEG_CONCURRENCY = 3
const pause = (ms: number) => new Promise(r => setTimeout(r, ms))

/* What to ask for when a city has no data for the mode we wanted. This is not
 * a preference, it is the difference between a leg and a dotted line drawn
 * across the city: Google serves no transit directions in Japan at all, so
 * every train in Tokyo and Kyoto came back "no route found" and was given up
 * on. Driving is answered everywhere there are roads, and it at least follows
 * them, so a leg reaches the next place along real ground. Whatever mode the
 * answer came from is the mode the leg then says it is — the book would rather
 * tell you it priced a taxi than quietly call a taxi a train.
 */
const FALLBACK: Record<Transport, Transport[]> = {
  transit: ['drive', 'walk'],
  drive: ['walk'],
  cycle: ['walk'],
  walk: [],
}

/** 404 from the router means this city cannot answer for this mode, ever.
    Anything else is a bad moment and worth asking again. */
const neverWorks = (e: unknown) => (e as { status?: number })?.status === 404

type Point = { id: string; lat: number; lon: number }

async function routeLeg(from: Point, to: Point, wanted: Transport): Promise<Leg> {
  for (const transport of [wanted, ...FALLBACK[wanted]]) {
    for (let attempt = 0; attempt < LEG_TRIES; attempt++) {
      try {
        const r = await postJson<{ encodedPolyline: string; distanceM: number; durationSec: number; how?: string }>(
          'routes/walk', { from, to, transport })
        if (transport !== wanted) {
          breadcrumb('router', `no ${wanted} route here; this leg is ${transport}`, { from: from.id, to: to.id })
        }
        return {
          fromStopId: from.id, toStopId: to.id, polyline: decodePolyline(r.encodedPolyline),
          distanceM: r.distanceM, durationSec: r.durationSec, transport, estimated: false,
          // Which line, from which station: the guide says it on the way.
          ...(r.how ? { how: r.how } : {}),
        }
      } catch (e) {
        if (neverWorks(e)) break                                        // ask a different way, not again
        if (attempt < LEG_TRIES - 1) await pause(300 * 2 ** attempt)    // 300 ms, then 600
      }
    }
  }
  breadcrumb('router', 'leg fell back to a straight-line estimate; no mode could be routed', { from: from.id, to: to.id, transport: wanted })
  return {
    fromStopId: from.id, toStopId: to.id,
    polyline: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
    distanceM: Math.round(metresBetween(from, to) * DETOUR),
    durationSec: Math.round(guessSec(from, to, wanted)),
    transport: wanted, estimated: true,
  }
}

/** One leg per consecutive pair, each priced in the mode that suits it. */
export async function legsFor(
  stops: Point[], wish: TransportWish = 'walk', budget: Budget = 'modest',
): Promise<Leg[]> {
  const pairs = stops.slice(1).map((to, i) => ({ from: stops[i], to, transport: modeFor(wish, budget, metresBetween(stops[i], to)) }))
  const out: Leg[] = new Array(pairs.length)
  let next = 0
  const worker = async () => {
    for (let i = next++; i < pairs.length; i = next++) out[i] = await routeLeg(pairs[i].from, pairs[i].to, pairs[i].transport)
  }
  await Promise.all(Array.from({ length: Math.min(LEG_CONCURRENCY, pairs.length) }, worker))
  return out
}

export const walkingLegs = legsFor

/** Real (or estimated) travel seconds for a set of places, as the Timekeeper
    sees a trip: one compact day-cluster at a time, in the order that costs
    least. A single zigzag of every place would invent journeys nobody takes. */
export async function travelSecs(
  points: LatLon[], wish: Pick<Wish, 'transport' | 'budget' | 'days'>,
): Promise<number[]> {
  if (points.length < 2) return []
  const days = Math.max(1, wish.days || 1)
  const { order, minutes } = await bestOrder(points, wish.transport, wish.budget, false)
  const perDay = Math.ceil(order.length / days)
  const secs: number[] = []
  for (let d = 0; d < days; d++) {
    const chunk = order.slice(d * perDay, (d + 1) * perDay)
    for (let i = 1; i < chunk.length; i++) secs.push(minutes[chunk[i - 1]][chunk[i]] * 60)
  }
  return secs
}
