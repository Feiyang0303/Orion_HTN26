import type { LatLon, Photo, Source } from '../types'
import { getJson } from './net'

/* Everything the crew is allowed to know comes through here: Wikipedia
 * geosearch for "what is near this point", page intros for what those things
 * are, and Commons for the photo and its credit. */

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
  const geo = await getJson<{ query?: { geosearch: GeoHit[] } }>(api('en.wikipedia.org', {
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
  for (let i = 0; i < ids.length; i += 50) {
    const res = await getJson<{ query?: { pages: { pageid: number; pageviews?: Record<string, number | null> }[] } }>(api('en.wikipedia.org', {
      action: 'query', pageids: ids.slice(i, i + 50).join('|'), prop: 'pageviews', pvipdays: '30',
    }))
    for (const p of res.query?.pages ?? []) out.set(p.pageid, Object.values(p.pageviews ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0))
  }
  return out
}

type Page = { pageid: number; extract?: string; fullurl: string; pageimage?: string }

async function intros(ids: number[]) {
  const out = new Map<number, { extract: string; url: string; image: { file: string } | null }>()
  for (let i = 0; i < ids.length; i += 20) {   // extracts allow 20 pages per request
    const res = await getJson<{ query?: { pages: Page[] } }>(api('en.wikipedia.org', {
      action: 'query', pageids: ids.slice(i, i + 20).join('|'),
      prop: 'extracts|pageimages|info', inprop: 'url', exintro: '1', explaintext: '1', exsentences: '4',
      exlimit: 'max', piprop: 'name',
    }))
    for (const p of res.query?.pages ?? []) {
      out.set(p.pageid, { extract: (p.extract ?? '').trim(), url: p.fullurl, image: p.pageimage ? { file: p.pageimage } : null })
    }
  }
  return out
}

const stripHtml = (s?: string) => (s ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim()

/** The article's lead image with author and licence from Commons. Null if it has none. */
export async function photoFor(a: Article): Promise<Photo | null> {
  if (!a.image) return null
  const res = await getJson<{ query?: { pages: { imageinfo?: { thumburl?: string; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }[] } }>(
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
