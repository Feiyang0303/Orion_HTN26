import type { LatLon, Source } from '../types'
import { metresBetween } from './geo'
import { nearby } from './geocode'

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

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
/* Short, on purpose. Overpass in a dense city can take a minute, and a person
   is waiting; past this the answer comes from Nominatim instead. */
const TIMEOUT_MS = 12_000

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
  /* All mirrors at once; the first good answer wins and the rest are
     abandoned. Asking them in turn meant three timeouts in a row when the
     first was busy, and a person was waiting through every one of them. */
  const guards = MIRRORS.map(() => new AbortController())
  const onAbort = () => guards.forEach(g => g.abort())
  signal?.addEventListener('abort', onAbort)
  const timer = setTimeout(onAbort, TIMEOUT_MS)
  const attempt = async (url: string, guard: AbortController): Promise<Element[]> => {
    const res = await fetch(url, {
      method: 'POST', signal: guard.signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    })
    if (!res.ok) throw new Error(`${res.status}`)
    const body = await res.json() as { elements?: Element[] }
    if (!body.elements?.length) throw new Error('empty')
    return body.elements
  }
  try {
    const won = await Promise.any(MIRRORS.map((url, i) => attempt(url, guards[i])))
    onAbort()
    return won
  } catch {
    return []
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
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

/* The same places, asked of Nominatim when Overpass will not answer. It knows
   fewer tags (stars, website and phone survive; cuisine sometimes) but it
   knows the names and the doors, which is what matters. */
async function viaNominatim(what: string[], centre: LatLon, radiusM: number, kindOf: (k: string) => string, signal?: AbortSignal): Promise<OsmPlace[]> {
  const seen = new Set<string>()
  const out: OsmPlace[] = []
  for (const w of what) {
    const rows = await nearby(w, centre, radiusM, 30, signal).catch(() => [])
    for (const r of rows) {
      const key = r.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: r.osmId, name: r.name, kind: kindOf(r.kind), tags: { name: r.name, ...r.tags },
        lat: r.lat, lon: r.lon, distM: metresBetween(centre, r),
        source: { kind: 'nominatim', label: `OpenStreetMap: ${r.name}`, url: `https://www.openstreetmap.org/${r.osmId[0] === 'w' ? 'way' : r.osmId[0] === 'r' ? 'relation' : 'node'}/${r.osmId.slice(1)}` },
      })
    }
  }
  return out.sort((a, b) => a.distM - b.distM)
}

/** Places to sleep near a point. `kinds` are OSM tourism values. */
export async function beds(
  centre: LatLon, radiusM: number, kinds: string[] = ['hotel', 'hostel', 'guest_house', 'apartment'], signal?: AbortSignal,
): Promise<OsmPlace[]> {
  const filters = kinds.map(k => `["tourism"="${k}"]["name"]`)
  const raw = await overpass(around(centre, radiusM, filters), signal)
  const got = shape(raw, centre, t => t.tourism ?? 'hotel')
  if (got.length) return got
  return viaNominatim(kinds.map(k => k.replace('_', ' ')), centre, radiusM, k => k.replace(' ', '_'), signal)
}

/** Places to eat near a point. */
export async function tables(
  centre: LatLon, radiusM: number, signal?: AbortSignal,
): Promise<OsmPlace[]> {
  const filters = ['restaurant', 'cafe', 'fast_food', 'bar'].map(k => `["amenity"="${k}"]["name"]`)
  const raw = await overpass(around(centre, radiusM, filters), signal)
  const got = shape(raw, centre, t => t.amenity ?? 'restaurant')
  if (got.length) return got
  return viaNominatim(['restaurant', 'cafe'], centre, radiusM, k => k, signal)
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
