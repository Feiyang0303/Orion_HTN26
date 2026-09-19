import type { LatLon, Waypoint } from '../types'
import { net } from './net'
import { metresBetween } from './geo'

/* Names to points, through Nominatim.
 *
 * Two rules the rest of the planner leans on:
 *  - A name is resolved *near* the city when we already have the city, because
 *    "Central Station" is a different building in every country and the city is
 *    the disambiguator the person has already given us.
 *  - Ambiguity is kept rather than resolved silently. Two candidates more than
 *    two kilometres apart is a real question, and the book asks it in the
 *    margin instead of being quietly wrong all day.
 */

export type Place = Waypoint & { region: string }

/** Nominatim asks for one request per second and means it. */
function politeQueue(minGapMs: number) {
  let chain: Promise<unknown> = Promise.resolve()
  let last = 0
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = async () => {
      const wait = Math.max(0, last + minGapMs - Date.now())
      if (wait) await new Promise(r => setTimeout(r, wait))
      last = Date.now()
      return job()
    }
    const next = chain.then(run, run)
    chain = next.catch(() => {})
    return next as Promise<T>
  }
}
const queue = politeQueue(1100)

type Row = {
  display_name: string; name?: string; lat: string; lon: string
  importance?: number; namedetails?: Record<string, string>
}

/* English first, then whatever the place calls itself. Nominatim otherwise
   answers in the browser's language, which is how a Toronto journal came back
   with a CN Tower page titled in Chinese. */
const englishName = (r: Row) =>
  r.namedetails?.['name:en']?.trim() || r.namedetails?.name?.trim() ||
  r.name?.trim() || r.display_name.split(',')[0].trim()

const cache = new Map<string, Place | null>()

async function search(params: URLSearchParams, signal?: AbortSignal): Promise<Row[]> {
  const url = 'https://nominatim.openstreetmap.org/search?' + params
  try {
    const rows = await queue(async () => {
      const res = await fetch(url, { headers: { Accept: 'application/json', ...net.headers }, signal })
      if (!res.ok) throw new Error(`nominatim ${res.status}`)
      return res.json() as Promise<Row[]>
    })
    return Array.isArray(rows) ? rows : []
  } catch { return [] }
}

/** Resolve one name, biased towards `near` when we have it. Null if nothing
    matched — the caller says so rather than inventing a coordinate. */
export async function locate(query: string, near?: LatLon, signal?: AbortSignal): Promise<Place | null> {
  const key = `${query}|${near ? `${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : ''}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const params = new URLSearchParams({
    q: query, format: 'jsonv2', limit: '5', addressdetails: '0', namedetails: '1', 'accept-language': 'en',
  })
  // A viewbox biases without excluding, so "the airport" can still win from
  // outside the box.
  if (near) {
    const d = 0.55
    params.set('viewbox', [near.lon - d, near.lat + d, near.lon + d, near.lat - d].join(','))
  }
  const shaped = (await search(params, signal)).map(r => ({
    name: englishName(r), full: r.display_name,
    lat: Number(r.lat), lon: Number(r.lon), importance: r.importance ?? 0,
  })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon))

  if (!shaped.length) { cache.set(key, null); return null }
  // Nearest wins when we have a centre; importance decides otherwise. Ranking
  // by importance alone puts the famous Cambridge in England when the person
  // is plainly planning a day in Massachusetts.
  shaped.sort((a, b) => near ? metresBetween(near, a) - metresBetween(near, b) : b.importance - a.importance)

  const best = shaped[0]
  const alternatives = shaped.slice(1)
    .filter(r => metresBetween(best, r) > 2000).slice(0, 3)
    .map(r => ({ name: `${r.name} — ${r.full.split(',').slice(1, 3).join(', ').trim()}`, lat: r.lat, lon: r.lon }))

  const out: Place = {
    asked: query, name: best.name, lat: best.lat, lon: best.lon,
    region: best.full.split(',').slice(1, 3).map(s => s.trim()).join(', '),
    ...(alternatives.length ? { alternatives } : {}),
  }
  cache.set(key, out)
  return out
}

/** The city itself. Throws, because there is no plan without one. */
export async function geocode(query: string, signal?: AbortSignal): Promise<Place> {
  const hit = await locate(query, undefined, signal)
  if (!hit) throw new Error(`Couldn't find a place called "${query}".`)
  return hit
}

/** Live suggestions under the desk's place field. Bounded to the city, nearest
    first, deduplicated. Silent on failure: a suggestion list is a convenience
    and must never be an error message. */
export async function suggest(query: string, near: LatLon, signal?: AbortSignal): Promise<Place[]> {
  if (query.trim().length < 3) return []
  const d = 0.55
  const params = new URLSearchParams({
    q: query, format: 'jsonv2', limit: '6', addressdetails: '0', namedetails: '1', 'accept-language': 'en',
    viewbox: [near.lon - d, near.lat + d, near.lon + d, near.lat - d].join(','), bounded: '1',
  })
  const seen = new Set<string>()
  return (await search(params, signal))
    .map(r => ({
      asked: query, name: englishName(r), lat: Number(r.lat), lon: Number(r.lon),
      region: r.display_name.split(',').slice(1, 3).map(s => s.trim()).join(', '),
    }))
    .filter(r => {
      const k = `${r.name}|${r.lat.toFixed(3)},${r.lon.toFixed(3)}`
      if (!Number.isFinite(r.lat) || seen.has(k)) return false
      seen.add(k); return true
    })
    .sort((a, b) => metresBetween(near, a) - metresBetween(near, b))
    .slice(0, 5)
}
