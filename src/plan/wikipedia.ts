import type { LatLon, Photo, Source } from '../types'
import { getJson, net } from './net'
import { metresBetween } from './geo'

/* Everything the crew is allowed to know comes through here: Wikipedia
 * geosearch for "what is near this point", page intros for what those things
 * are, and Commons for the photo and its credit. */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Through the proxy's polite, caching front (scripts/wiki.mjs) when it is there,
    straight to the source (with backoff on 429) when it is not. */
async function wikiGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  try { return await getJson<T>(`${net.apiBase}/api/wiki?u=${encodeURIComponent(url)}`, signal) }
  catch (e) {
    const gone = e instanceof TypeError || / (404|501)$/.test((e as Error).message)      // no proxy route: an older proxy, or none running
    if (!gone) throw e
  }
  for (let i = 0; ; i++) {
    try { return await getJson<T>(url, signal) }
    catch (e) { if (i >= 3 || !/ 429$/.test((e as Error).message)) throw e; await sleep(1200 * 2 ** i) }
  }
}

/** Run `fn` over `items`, at most `n` at a time, keeping order. */
async function limited<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); await sleep(120) }   // a small stagger: bursts get 429s
  }))
  return out
}

export type Article = LatLon & {
  pageId: number; title: string; distM: number
  extract: string; url: string; image: { file: string } | null
}

const api = (host: string, params: Record<string, string>) =>
  `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })

export const wikiSource = (a: Pick<Article, 'title' | 'url'>): Source => ({ kind: 'wikipedia', label: `Wikipedia: ${a.title}`, url: a.url })

type GeoHit = { pageid: number; title: string; lat: number; lon: number; dist: number }

/** The most-read geotagged articles within radiusM, with intros. Nearest-first
    is useless in a dense city (the closest fifty are minor mansions and
    ministries), so a wide pool is ranked by 30 days of Wikipedia pageviews and
    only the top `keep` are fetched in full. Result is ordered by views. */
export async function notable(centre: LatLon, radiusM: number, keep: number, pool = 250): Promise<Article[]> {
  const geo = await wikiGet<{ query?: { geosearch: GeoHit[] } }>(api('en.wikipedia.org', {
    action: 'query', list: 'geosearch', gscoord: `${centre.lat}|${centre.lon}`,
    gsradius: String(Math.min(radiusM, 10000)), gslimit: String(pool), gsnamespace: '0',
  }))
  const hits = geo.query?.geosearch ?? []
  const views = await pageviews(hits.map(h => h.pageid))
  const top = [...hits].sort((a, b) => (views.get(b.pageid) ?? 0) - (views.get(a.pageid) ?? 0)).slice(0, keep)
  const details = await intros(top.map(h => h.pageid))
  return top.flatMap(h => {
    const d = details.get(h.pageid)
    return d?.extract ? [{ pageId: h.pageid, title: h.title, lat: h.lat, lon: h.lon, distM: h.dist, ...d }] : []
  })
}

async function pageviews(ids: number[]) {
  const out = new Map<number, number>()
  const chunks = Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ids.slice(i * 50, i * 50 + 50))
  await limited(chunks, 3, async chunk => {
    const res = await wikiGet<{ query?: { pages: { pageid: number; pageviews?: Record<string, number | null> }[] } }>(api('en.wikipedia.org', {
      action: 'query', pageids: chunk.join('|'), prop: 'pageviews', pvipdays: '30',
    }))
    for (const p of res.query?.pages ?? []) out.set(p.pageid, Object.values(p.pageviews ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0))
  })
  return out
}

type Page = { pageid: number; extract?: string; fullurl: string; pageimage?: string }

async function intros(ids: number[]) {
  const out = new Map<number, { extract: string; url: string; image: { file: string } | null }>()
  const chunks = Array.from({ length: Math.ceil(ids.length / 20) }, (_, i) => ids.slice(i * 20, i * 20 + 20))   // extracts allow 20 pages per request
  await limited(chunks, 3, async chunk => {
    const res = await wikiGet<{ query?: { pages: Page[] } }>(api('en.wikipedia.org', {
      action: 'query', pageids: chunk.join('|'),
      prop: 'extracts|pageimages|info', inprop: 'url', exintro: '1', explaintext: '1', exsentences: '4',
      exlimit: 'max', piprop: 'name',
    }))
    for (const p of res.query?.pages ?? []) {
      out.set(p.pageid, { extract: (p.extract ?? '').trim(), url: p.fullurl, image: p.pageimage ? { file: p.pageimage } : null })
    }
  })
  return out
}

const stripHtml = (s?: string) => (s ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim()

/** The article's lead image with author and licence from Commons. Null if it has none. */
export async function photoFor(a: Article): Promise<Photo | null> {
  if (!a.image) return null
  const res = await wikiGet<{ query?: { pages: { imageinfo?: { thumburl?: string; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }[] } }>(
    api('commons.wikimedia.org', {
      action: 'query', titles: `File:${a.image.file}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '900',
    }))
  const info = res.query?.pages[0]?.imageinfo?.[0]
  if (!info?.thumburl) return null
  const meta = info.extmetadata ?? {}
  const author = stripHtml(meta.Artist?.value) || 'Unknown author'
  const licence = stripHtml(meta.LicenseShortName?.value)
  return { url: info.thumburl, credit: licence ? `${author}, ${licence}` : author, pageUrl: info.descriptionurl }
}


/* ---- the wide catalogue ------------------------------------------------------
   `notable` asks Wikipedia for the N *nearest* articles, so in a dense city
   its radius is a fiction: the nearest 400 in central Paris are all within
   about a kilometre, and the Louvre, the Eiffel Tower and Notre-Dame never make
   the list. The wide catalogue asks Wikidata instead: everything with a
   coordinate within the radius, ranked by how many language editions of
   Wikipedia have an article about it. That is a far better notability signal
   than pageviews, and it is one request, not thirty.

   Wikidata takes ~30 s on a dense city, so this is cached per city, started the
   moment the desk recognises the city (nobody fills the form in faster), kept on
   disk by the proxy so a repeat city is instant, and backed by the cheap
   geosearch-and-pageviews route if Wikidata is slow or refuses. */

export const WIDE_RADIUS_M = 9500
const WIDE_KEEP = 140
const NOT_A_PLACE = /^(list of|timeline of|\d+(st|nd|rd|th) arrondissement|arrondissements? of|districts? of|quartiers? of)/i

/** Wikidata holds things with coordinates that are not places to stand: a
    language, an agency, a war. Wikipedia's first sentence says what a thing is
    ("X is a Romance language"), which is cheaper and surer than walking the
    class tree, so that is what is read. */
export const NOT_A_DESTINATION = new RegExp(
  '\\b(?:is|was|are|were)\\s+(?:(?:a|an|the)\\s+(?:[\\w\\u00C0-\\u024F-]+\\s+){0,3}?|one of the\\s+(?:[\\w\\u00C0-\\u024F-]+\\s+){0,4}?)' +
  '(?:language|organi[sz]ation|agency|treaty|agreement|war|battle|massacre|attack|election|championship|tournament|' +
  'company|corporation|party|country|department|region|commune|municipality|cit(?:y|ies)|town|village|arrondissement|canton|' +
  'film|album|song|novel|series|newspaper|magazine|footballer|writer|painter|composer|politician|physicist|singer|' +
  'actor|actress|philosopher|architect|mathematician|empire|republic|dynasty|conference|exhibition|festival|event|games|' +
  'crisis|revolution|uprising|university|government|olympics|cup|shooting|bombing|riot|siege|affair|scandal|fire|disaster|' +
  'law|act|policy|group|band|state)s?\\b', 'i')

function offset(p: LatLon, metres: number, bearingDeg: number): LatLon {
  const R = 6371000, d = metres / R, b = bearingDeg * Math.PI / 180
  const la = p.lat * Math.PI / 180, lo = p.lon * Math.PI / 180
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b))
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2))
  return { lat: la2 * 180 / Math.PI, lon: lo2 * 180 / Math.PI }
}

const wideCache = new Map<string, Promise<Article[]>>()

/** How long the notability route gets before the cheap route takes over. The
    query itself keeps running in the proxy and caches its answer, so it is not
    wasted: the next plan for this city is instant. Scripts that warm the cache
    can afford to wait it out. */
export const wideConfig = { sparqlMs: 22_000 }

const cell = (v: number) => +(Math.round(v / 0.05) * 0.05).toFixed(2)   // ~5 km: geocoders disagree by less than that, and the radius is 9.5 km

/** Cached per city cell. Failures are not cached, so a retry really retries. */
export function wideCatalogue(origin: LatLon): Promise<Article[]> {
  const centre = { lat: cell(origin.lat), lon: cell(origin.lon) }
  const key = `${centre.lat},${centre.lon}`
  let p = wideCache.get(key)
  if (!p) { p = buildWide(centre, key).catch(e => { wideCache.delete(key); throw e }); wideCache.set(key, p) }
  return p
}

async function buildWide(origin: LatLon, key: string): Promise<Article[]> {
  const good = byNotability(origin).then(list => (list.length >= 12 ? list : Promise.reject(new Error('too few'))))
  good.then(list => wideCache.set(key, Promise.resolve(list)), () => {})     // if it lands late, later callers get the better list
  const late = new Promise<never>((_, no) => setTimeout(() => no(new Error('slow')), wideConfig.sparqlMs))
  try { return await Promise.race([good, late]) }
  catch { return byPageviews(origin) }                                        // Wikidata slow or refusing
}

const sparql = (c: LatLon, km: number) => `SELECT ?title ?lat ?lon ?links WHERE {
  SERVICE wikibase:around { ?item wdt:P625 ?loc .
    bd:serviceParam wikibase:center "Point(${c.lon} ${c.lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${km}" . }
  ?item wikibase:sitelinks ?links . FILTER(?links > 12)
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title .
  BIND(geof:latitude(?loc) AS ?lat) BIND(geof:longitude(?loc) AS ?lon)
} ORDER BY DESC(?links) LIMIT 220`

type Row = { title: { value: string }; lat: { value: string }; lon: { value: string }; links: { value: string } }

export async function byNotability(origin: LatLon): Promise<Article[]> {
  const url = 'https://query.wikidata.org/sparql?' + new URLSearchParams({ format: 'json', query: sparql(origin, WIDE_RADIUS_M / 1000) })
  const res = await wikiGet<{ results: { bindings: Row[] } }>(url, AbortSignal.timeout(65_000))
  return articlesFrom(origin, res.results.bindings)
}

/** Turn ranked Wikidata rows into articles with real intros, dropping what is
    not somewhere to stand. Exported so it can be tested without the network. */
export async function articlesFrom(origin: LatLon, rows: Row[], fetchIntros = introsByTitle): Promise<Article[]> {
  const seen = new Set<string>()
  const ranked = rows.flatMap(r => {
    const title = r.title.value
    if (seen.has(title) || NOT_A_PLACE.test(title)) return []
    seen.add(title)
    return [{ title, lat: +r.lat.value, lon: +r.lon.value }]
  }).slice(0, 190)
  const details = await fetchIntros(ranked.map(r => r.title))
  const out: Article[] = []
  for (const r of ranked) {
    const d = details.get(r.title)
    if (!d?.extract || d.extract.length < 80 || NOT_A_DESTINATION.test(d.extract.slice(0, 320))) continue
    out.push({ pageId: d.pageId, title: r.title, lat: r.lat, lon: r.lon, distM: metresBetween(origin, r), extract: d.extract, url: d.url, image: d.image })
  }
  return out.slice(0, WIDE_KEEP)
}

type Intro = { pageId: number; extract: string; url: string; image: { file: string } | null }

/** Intros for articles by title, as they are named in Wikidata (redirects and
    normalisation followed, and mapped back to the title that was asked for). */
async function introsByTitle(titles: string[]): Promise<Map<string, Intro>> {
  const out = new Map<string, Intro>()
  const chunks = Array.from({ length: Math.ceil(titles.length / 20) }, (_, i) => titles.slice(i * 20, i * 20 + 20))
  await limited(chunks, 2, async chunk => {
    const res = await wikiGet<{ query?: { normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[]; pages: (Page & { title: string })[] } }>(api('en.wikipedia.org', {
      action: 'query', titles: chunk.join('|'), redirects: '1',
      prop: 'extracts|pageimages|info', inprop: 'url', exintro: '1', explaintext: '1', exsentences: '4', exlimit: 'max', piprop: 'name',
    }))
    const q = res.query
    const hop = (t: string) => { const n = q?.normalized?.find(x => x.from === t)?.to ?? t; return q?.redirects?.find(x => x.from === n)?.to ?? n }
    const byTitle = new Map((q?.pages ?? []).map(p => [p.title, p]))
    for (const t of chunk) {
      const p = byTitle.get(hop(t))
      if (p) out.set(t, { pageId: p.pageid, extract: (p.extract ?? '').trim(), url: p.fullurl, image: p.pageimage ? { file: p.pageimage } : null })
    }
  })
  return out
}

/** The fallback: seven overlapping circles, ranked by 30 days of pageviews. Slower and
    shallower than the Wikidata route, but it needs nothing that can time out for a minute. */
async function byPageviews(origin: LatLon): Promise<Article[]> {
  const centres = [origin, ...[0, 60, 120, 180, 240, 300].map(b => offset(origin, WIDE_RADIUS_M * 0.6, b))]
  const circle = Math.round(WIDE_RADIUS_M * 0.45)
  const lists = await limited(centres, 3, async c => {
    const geo = await wikiGet<{ query?: { geosearch: GeoHit[] } }>(api('en.wikipedia.org', {
      action: 'query', list: 'geosearch', gscoord: `${c.lat}|${c.lon}`, gsradius: String(circle), gslimit: '200', gsnamespace: '0',
    }))
    return geo.query?.geosearch ?? []
  })
  const byId = new Map<number, GeoHit>()
  for (const h of lists.flat()) if (!byId.has(h.pageid) && !NOT_A_PLACE.test(h.title)) byId.set(h.pageid, h)
  const hits = [...byId.values()]
  const views = await pageviews(hits.map(h => h.pageid))
  const top = hits.sort((a, b) => (views.get(b.pageid) ?? 0) - (views.get(a.pageid) ?? 0)).slice(0, WIDE_KEEP)
  const details = await intros(top.map(h => h.pageid))
  return top.flatMap(h => {
    const d = details.get(h.pageid)
    return d?.extract && !NOT_A_DESTINATION.test(d.extract.slice(0, 320)) ? [{ pageId: h.pageid, title: h.title, lat: h.lat, lon: h.lon, distM: metresBetween(origin, h), ...d }] : []
  })
}
