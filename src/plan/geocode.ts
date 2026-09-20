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
  /** What kind of thing the record is: 'city', 'town', 'country', 'state'… */
  addresstype?: string
}

/* A city-state has two records of the same name and the same importance: the country and the city. The country's
   point is the middle of its territory, which for Singapore is a reservoir in a forest nearly nine kilometres from
   everything anyone flies there to see, further than a day's trip is allowed to reach, so the Scout's famous places
   were all thrown away as outside the area and the day was whatever single thing happened to stand near the
   reservoir. When a city is what was asked for, a record that is a whole country or region loses to one that is not. */
const TERRITORY = new Set(['country', 'state', 'region', 'province', 'county', 'state_district'])

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
export async function locate(query: string, near?: LatLon, signal?: AbortSignal, opts: { settlement?: boolean } = {}): Promise<Place | null> {
  const key = `${query}|${near ? `${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : ''}|${opts.settlement ? 's' : ''}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const params = new URLSearchParams({
    q: query, format: 'jsonv2', limit: '5', addressdetails: '0', namedetails: '1', 'accept-language': 'en',
  })
  // `settlement` asks for a city, town or village, so "Kyoto" is the city and not the prefecture around it.
  if (opts.settlement) params.set('featuretype', 'settlement')
  // A viewbox biases without excluding, so "the airport" can still win from
  // outside the box.
  if (near) {
    const d = 0.55
    params.set('viewbox', [near.lon - d, near.lat + d, near.lon + d, near.lat - d].join(','))
  }
  const shaped = (await search(params, signal)).map(r => ({
    name: englishName(r), full: r.display_name,
    lat: Number(r.lat), lon: Number(r.lon), importance: r.importance ?? 0,
    territory: !!opts.settlement && TERRITORY.has(r.addresstype ?? ''),
  })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon))

  if (!shaped.length) {
    if (opts.settlement) return locate(query, near, signal)      // nothing settlement-shaped: fall back to anything
    cache.set(key, null); return null
  }
  // Nearest wins when we have a centre; importance decides otherwise. Ranking
  // by importance alone puts the famous Cambridge in England when the person
  // is plainly planning a day in Massachusetts.
  shaped.sort((a, b) => near ? metresBetween(near, a) - metresBetween(near, b) : Number(a.territory) - Number(b.territory) || b.importance - a.importance)

  const best = shaped[0]
  const alternatives = shaped.slice(1)
    .filter(r => metresBetween(best, r) > 2000).slice(0, 3)
    .map(r => ({ name: `${r.name} — ${r.full.split(',').slice(1, 3).join(', ').trim()}`, lat: r.lat, lon: r.lon }))

  const out: Place = {
    asked: query, name: opts.settlement ? plainName(best.name, query) : best.name, lat: best.lat, lon: best.lon,
    region: best.full.split(',').slice(1, 3).map(s => s.trim()).join(', '),
    ...(alternatives.length ? { alternatives } : {}),
  }
  cache.set(key, out)
  return out
}

/** The city itself. Throws, because there is no plan without one. */
export async function geocode(query: string, signal?: AbortSignal): Promise<Place> {
  const hit = await locate(query, undefined, signal, { settlement: true })
  if (!hit) throw new Error(`Couldn't find a place called "${query}".`)
  return hit
}

/* Asked for London, the map answers "Greater London", and that name then heads the trip, opens the guide's welcome and
   goes on the journal's cover. When what came back is only what was typed with an administrator's qualifier on it, the
   person's own word is the name. Only then: "Mexico City" and "Kansas City" are names, and stay as they are. */
const QUALIFIED = /^(?:Greater|City of|Metropolitan City of|Municipality of|Commune of|Ville de|Città di|Stadt)\s+(.+)$|^(.+?)\s+(?:City|Metropolitan Area|Metropolis|Municipality|Prefecture|Region|District)$/i
function plainName(name: string, asked: string) {
  const m = name.match(QUALIFIED), core = (m?.[1] ?? m?.[2] ?? '').trim()
  return core && core.toLowerCase() === asked.trim().toLowerCase() ? core : name
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

/** What is at this point on the ground. Used when a pin is dropped on the map
    rather than typed: a click beside the square should come back as the
    square, not as a pair of decimals. */
export async function reverseGeocode(at: LatLon, signal?: AbortSignal): Promise<Place | null> {
  const params = new URLSearchParams({
    lat: String(at.lat), lon: String(at.lon), format: 'jsonv2', zoom: '18',
    namedetails: '1', 'accept-language': 'en',
  })
  try {
    const r = await queue(async () => {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`,
        { headers: { Accept: 'application/json', ...net.headers }, signal })
      if (!res.ok) throw new Error(`nominatim ${res.status}`)
      return res.json() as Promise<Row & { error?: string }>
    })
    if (!r || r.error) return null
    const name = englishName(r)
    return {
      asked: name, name, lat: at.lat, lon: at.lon,
      region: r.display_name.split(',').slice(1, 3).map(s => s.trim()).join(', '),
    }
  } catch { return null }
}

/** Named places of a kind within a box around a point — "hotel", "restaurant"
    — from Nominatim, with whatever extra tags it carries. The fallback when
    Overpass is slow or down, which in a dense city it often is. */
export type NearbyRow = LatLon & {
  osmId: string; name: string; kind: string; region: string
  tags: Record<string, string>
}
export async function nearby(what: string, centre: LatLon, radiusM: number, limit = 30, signal?: AbortSignal): Promise<NearbyRow[]> {
  const dLat = radiusM / 111_000
  const dLon = radiusM / (111_000 * Math.cos(centre.lat * Math.PI / 180))
  const params = new URLSearchParams({
    q: what, format: 'jsonv2', limit: String(Math.min(limit, 50)), addressdetails: '1', namedetails: '1', extratags: '1',
    'accept-language': 'en', bounded: '1',
    viewbox: [centre.lon - dLon, centre.lat + dLat, centre.lon + dLon, centre.lat - dLat].join(','),
  })
  type Full = Row & { osm_type?: string; osm_id?: number; type?: string; class?: string; extratags?: Record<string, string>; address?: Record<string, string> }
  const rows = await search(params, signal) as Full[]
  return rows.flatMap(r => {
    const lat = Number(r.lat), lon = Number(r.lon)
    const name = englishName(r)
    if (!name || !Number.isFinite(lat)) return []
    const a = r.address ?? {}
    return [{
      osmId: `${(r.osm_type ?? 'n')[0]}${r.osm_id ?? Math.round(lat * 1e5)}`, name, lat, lon,
      kind: r.type ?? what, region: r.display_name.split(',').slice(1, 3).map(s => s.trim()).join(', '),
      tags: {
        ...(r.extratags ?? {}),
        ...(a.road ? { 'addr:street': a.road } : {}), ...(a.house_number ? { 'addr:housenumber': a.house_number } : {}),
        ...(a.city || a.town ? { 'addr:city': a.city ?? a.town } : {}),
      },
    }]
  })
}
