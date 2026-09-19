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


/* ---- verifying names ---------------------------------------------------------
   The Scout names places from what it knows; nothing it says is trusted until
   it has been looked up. One batched request turns a list of English Wikipedia
   titles into real articles with coordinates, or into a reason each one was
   dropped: no such article, a disambiguation page, no coordinates, too far from
   the city, no summary to draw on, or not somewhere to stand (a language, an
   agency, a war). Whatever survives is exactly what a catalogue entry was, so
   the rest of the crew cannot tell the difference. */

/** Wikipedia's first sentence says what a thing is ("X is a Romance language"),
    which is cheaper and surer than walking a class tree. Only the noun straight
    after "is a/the" counts, so "a museum in the capital" is not "the capital". */
export const NOT_A_DESTINATION = new RegExp(
  '\\b(?:is|was|are|were)\\s+(?:(?:a|an|the)\\s+(?:[\\w\\u00C0-\\u024F-]+\\s+){0,3}?|one of the\\s+(?:[\\w\\u00C0-\\u024F-]+\\s+){0,4}?)' +
  '(?:language|organi[sz]ation|agency|treaty|agreement|war|battle|massacre|attack|election|championship|tournament|' +
  'company|corporation|party|country|department|region|commune|municipality|cit(?:y|ies)|town|village|arrondissement|canton|' +
  'film|album|song|novel|series|newspaper|magazine|footballer|writer|painter|composer|politician|physicist|singer|' +
  'actor|actress|philosopher|architect|mathematician|empire|republic|dynasty|conference|exhibition|festival|event|games|' +
  'crisis|revolution|uprising|university|government|olympics|cup|shooting|bombing|riot|siege|affair|scandal|fire|disaster|' +
  'law|act|policy|group|band|state)s?\\b', 'i')

export type Rejected = { title: string; reason: string }

type Resolved = Page & {
  title: string
  missing?: boolean
  coordinates?: { lat: number; lon: number }[]
  pageprops?: { disambiguation?: string }
}

/** `locate` supplies a point when the article has none: a famous avenue or a garden
    often has no coordinates on Wikipedia, and it is still somewhere to fly to. */
export async function resolveTitles(
  titles: string[], origin: LatLon, maxM: number, locate?: (title: string) => Promise<LatLon | null>,
): Promise<{ found: { asked: string; article: Article }[]; rejected: Rejected[] }> {
  const found: { asked: string; article: Article }[] = []
  const rejected: Rejected[] = []
  const unique = [...new Set(titles.map(t => t.trim()).filter(Boolean))]
  const chunks = Array.from({ length: Math.ceil(unique.length / 20) }, (_, i) => unique.slice(i * 20, i * 20 + 20))   // extracts allow 20 per request
  await limited(chunks, 2, async chunk => {
    const res = await wikiGet<{ query?: { normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[]; pages: Resolved[] } }>(api('en.wikipedia.org', {
      action: 'query', titles: chunk.join('|'), redirects: '1',
      prop: 'extracts|pageimages|info|coordinates|pageprops', inprop: 'url', exintro: '1', explaintext: '1', exsentences: '4', exlimit: 'max',
      piprop: 'name', colimit: 'max', coprimary: 'primary', ppprop: 'disambiguation',
    }))
    const q = res.query
    const hop = (t: string) => { const n = q?.normalized?.find(x => x.from === t)?.to ?? t; return q?.redirects?.find(x => x.from === n)?.to ?? n }
    const byTitle = new Map((q?.pages ?? []).map(p => [p.title, p]))
    for (const asked of chunk) {
      const p = byTitle.get(hop(asked))
      const no = (reason: string) => rejected.push({ title: asked, reason })
      if (!p || p.missing) { no('no such Wikipedia article'); continue }
      if (p.pageprops && 'disambiguation' in p.pageprops) { no('a disambiguation page, not one place'); continue }
      const at = p.coordinates?.[0] ?? (locate ? await locate(asked).catch(() => null) : null)
      if (!at) { no('the article has no coordinates'); continue }
      const distM = metresBetween(origin, at)
      if (distM > maxM) { no(`${(distM / 1000).toFixed(1)} km from the centre, outside the area`); continue }
      const extract = (p.extract ?? '').trim()
      if (extract.length < 80) { no('too little written about it to draw on'); continue }
      if (NOT_A_DESTINATION.test(extract.slice(0, 320))) { no('not a place to stand'); continue }
      found.push({ asked, article: { pageId: p.pageid, title: p.title, lat: at.lat, lon: at.lon, distM, extract, url: p.fullurl, image: p.pageimage ? { file: p.pageimage } : null } })
    }
  })
  return { found, rejected }
}

/** Photographs on Wikimedia Commons taken within `radiusM` of a point —
    the honest way to show a hotel that has no article: the street outside it,
    as someone actually photographed it. Nearest first, with credit. */
export async function photosNear(at: LatLon, radiusM = 120, keep = 3): Promise<Photo[]> {
  try {
    const geo = await getJson<{ query?: { geosearch: { pageid: number; title: string; dist: number }[] } }>(api('commons.wikimedia.org', {
      action: 'query', list: 'geosearch', gscoord: `${at.lat}|${at.lon}`, gsradius: String(Math.min(radiusM, 10000)),
      gslimit: '12', gsnamespace: '6',
    }))
    const hits = (geo.query?.geosearch ?? []).filter(h => /\.(jpe?g|png|webp)$/i.test(h.title)).slice(0, keep)
    if (!hits.length) return []
    const res = await getJson<{ query?: { pages: { pageid: number; imageinfo?: { thumburl?: string; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }[] } }>(
      api('commons.wikimedia.org', {
        action: 'query', pageids: hits.map(h => h.pageid).join('|'), prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '700',
      }))
    return (res.query?.pages ?? []).flatMap(p => {
      const info = p.imageinfo?.[0]
      if (!info?.thumburl) return []
      const meta = info.extmetadata ?? {}
      const author = stripHtml(meta.Artist?.value) || 'Unknown author'
      const licence = stripHtml(meta.LicenseShortName?.value)
      return [{ url: info.thumburl, credit: licence ? `${author}, ${licence}` : author, pageUrl: info.descriptionurl }]
    })
  } catch { return [] }
}
