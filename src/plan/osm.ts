import { report } from '../telemetry'
import type { LatLon, Source } from '../types'
import { metresBetween } from './geo'

/* OpenStreetMap, for the things Wikipedia does not have: beds and dinner.
 *
 * Overpass is the only source here that can be slow or simply refuse, so every
 * call is bounded, tries a second mirror, and returns an empty list rather
 * than throwing — a trip with no restaurant suggestions is a smaller failure
 * than a trip that did not get made.
 *
 * What comes back is what OSM was told: a name, a position, sometimes a
 * cuisine, sometimes opening hours, sometimes a star rating a hotel put on
 * itself. There are no ratings and no prices, because OSM has none, and the
 * book would rather print nothing than a number nobody measured.
 */

// Public mirrors come and go, and any one of them can hang for a minute, so all
// of them are asked at once and the first good answer wins.
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const BUDGET_MS = 12_000

/** Every mirror failed or ran out of time. Different from "there is nothing
    here": callers must not tell someone a city has no hotels because a server
    was slow. */
export class OverpassDown extends Error {
  constructor() { super('OpenStreetMap did not answer in time') }
}

export type OsmPlace = LatLon & {
  id: string
  name: string
  /** The tag that matched: hotel, hostel, restaurant, cafe… */
  kind: string
  tags: Record<string, string>
  distM: number
  source: Source
}

type Element = {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number; lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

async function overpass(query: string, signal?: AbortSignal): Promise<Element[]> {
  const guard = new AbortController()
  const timer = setTimeout(() => guard.abort(), BUDGET_MS)
  const onAbort = () => guard.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    return await Promise.any(MIRRORS.map(async url => {
      const mirror = new URL(url).hostname
      try {
        const res = await fetch(url, {
          method: 'POST', signal: guard.signal,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
        })
        if (!res.ok) throw new Error(`${mirror} answered ${res.status}`)
        return ((await res.json()) as { elements?: Element[] }).elements ?? []
      } catch (e) {
        // A mirror that loses the race is aborted on purpose; that is not a fault.
        if (!signal?.aborted) report(e, 'osm.overpass', { level: 'warning', extra: { mirror, timedOut: guard.signal.aborted } })   // report() ignores the AbortError of a mirror that simply lost
        throw e
      }
    }))
  } catch (e) {
    if (signal?.aborted) throw e
    report(new Error('every Overpass mirror failed'), 'osm.overpass.exhausted', { level: 'error' })
    throw new OverpassDown()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    guard.abort()                      // cancel the mirrors that lost
  }
}

const osmSource = (e: Element): Source => ({
  kind: 'nominatim',   // the OSM family; the label says which part
  label: `OpenStreetMap: ${e.tags?.name ?? e.type}`,
  url: `https://www.openstreetmap.org/${e.type}/${e.id}`,
})

function shape(elements: Element[], centre: LatLon, kindOf: (t: Record<string, string>) => string): OsmPlace[] {
  const seen = new Set<string>()
  return elements.flatMap(e => {
    const tags = e.tags ?? {}
    const name = tags.name?.trim()
    const lat = e.lat ?? e.center?.lat
    const lon = e.lon ?? e.center?.lon
    if (!name || lat == null || lon == null) return []          // an unnamed cafe helps nobody
    const key = name.toLowerCase()
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      id: `${e.type[0]}${e.id}`, name, kind: kindOf(tags), tags,
      lat, lon, distM: metresBetween(centre, { lat, lon }), source: osmSource(e),
    }]
  }).sort((a, b) => a.distM - b.distM)
}

const around = (centre: LatLon, radiusM: number, filters: string[]) =>
  `[out:json][timeout:10];(${filters.map(f => `node${f}(around:${radiusM},${centre.lat},${centre.lon});way${f}(around:${radiusM},${centre.lat},${centre.lon});`).join('')});out center tags 120;`

/** Places to sleep near a point. `kinds` are OSM tourism values. */
export async function beds(
  centre: LatLon, radiusM: number, kinds: string[] = ['hotel', 'hostel', 'guest_house', 'apartment'], signal?: AbortSignal,
): Promise<OsmPlace[]> {
  const filters = kinds.map(k => `["tourism"="${k}"]["name"]`)
  const raw = await overpass(around(centre, radiusM, filters), signal)
  return shape(raw, centre, t => t.tourism ?? 'hotel')
}

/** Places to eat near a point. */
export async function tables(
  centre: LatLon, radiusM: number, signal?: AbortSignal,
): Promise<OsmPlace[]> {
  const filters = ['restaurant', 'cafe', 'fast_food', 'bar'].map(k => `["amenity"="${k}"]["name"]`)
  const raw = await overpass(around(centre, radiusM, filters), signal).catch(e => { if (e instanceof OverpassDown) return []; throw e })
  return shape(raw, centre, t => t.amenity ?? 'restaurant')
}

/** One line per place for a model to choose from: everything OSM actually
    said, and nothing else. */
export const describe = (p: OsmPlace) => {
  const t = p.tags
  const bits = [
    `${Math.round(p.distM)} m away`,
    t.cuisine && `cuisine: ${t.cuisine}`,
    t.stars && `${t.stars} stars (self-declared)`,
    t.diet_vegetarian && `vegetarian: ${t.diet_vegetarian}`,
    t.diet_vegan && `vegan: ${t.diet_vegan}`,
    t.opening_hours && `hours: ${t.opening_hours}`,
    t.outdoor_seating === 'yes' && 'outdoor seating',
    t.wheelchair && `wheelchair: ${t.wheelchair}`,
    t['addr:street'] && `on ${t['addr:street']}`,
  ].filter(Boolean)
  return `${p.id} | ${p.name} | ${p.kind} | ${bits.join(' · ')}`
}

export const addressOf = (p: OsmPlace) => {
  const t = p.tags
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ')
  return [street, t['addr:city']].filter(Boolean).join(', ')
}
