/* OpenStreetMap's Overpass API, through the proxy.
 *
 * The public mirrors are the least reliable thing in the whole product: any one
 * of them can hang for a minute, refuse with a 429, or answer in two seconds,
 * and which it is changes between requests. So the browser does not talk to
 * them. It asks here, and this:
 *
 *   - asks every mirror at once and takes the first good answer
 *   - tries the whole set again once if none of them managed it
 *   - keeps every good answer on disk for a day, so a city that has been planned
 *     once is instant, and beds and tables do not depend on a server being up
 *
 *   POST /api/overpass   { query } -> { elements: [...] }
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as Sentry from '@sentry/node'

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
// A Vercel function's checkout is read-only; /tmp is the one place it may write.
const DIR = process.env.VERCEL ? '/tmp/.cache/overpass' : '.cache/overpass'
const TTL_MS = 24 * 3600 * 1000
const ATTEMPT_MS = 20_000
const UA = process.env.WIKI_USER_AGENT || 'Orion-hackathon/0.1 (https://github.com/Feiyang0303/Orion_HTN26)'

mkdirSync(DIR, { recursive: true })
const memory = new Map()
const inflight = new Map()          // the same question asked twice at once is asked once

const fileFor = query => `${DIR}/${createHash('sha1').update(query).digest('hex')}.json`
const sleep = ms => new Promise(r => setTimeout(r, ms))

function cached(query) {
  const hit = memory.get(query)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.body
  const f = fileFor(query)
  if (existsSync(f)) {
    try {
      const { at, body } = JSON.parse(readFileSync(f, 'utf8'))
      if (Date.now() - at < TTL_MS) { memory.set(query, { at, body }); return body }
    } catch { /* corrupt entry: refetch */ }
  }
  return null
}

async function race(query) {
  const guard = new AbortController()
  const timer = setTimeout(() => guard.abort(), ATTEMPT_MS)
  try {
    return await Promise.any(MIRRORS.map(async url => {
      const t0 = Date.now()
      const host = new URL(url).hostname
      const res = await fetch(url, {
        method: 'POST', signal: guard.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA, accept: 'application/json' },
        body: 'data=' + encodeURIComponent(query),
      })
      if (!res.ok) { console.log(`[overpass] ${host} → ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`); throw new Error(`${host} answered ${res.status}`) }
      const text = await res.text()
      JSON.parse(text)                       // an HTML error page with a 200 is not an answer
      console.log(`[overpass] ${host} → 200 in ${((Date.now() - t0) / 1000).toFixed(1)}s (${Math.round(text.length / 1024)} KB)`)
      return text
    }))
  } finally { clearTimeout(timer); guard.abort() }
}

async function ask(query) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await race(query) }
    catch { console.log(`[overpass] every mirror failed (attempt ${attempt + 1})`); if (attempt === 0) await sleep(1500) }
  }
  Sentry.captureMessage('every Overpass mirror failed twice', 'error')
  return null
}

export async function handleOverpass(req, res, readJson) {
  const { query } = await readJson(req)
  if (typeof query !== 'string' || !query.trim()) { res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"query required"}'); return }
  let body = cached(query)
  const hit = !!body
  if (!body) {
    let p = inflight.get(query)
    if (!p) { p = ask(query).finally(() => inflight.delete(query)); inflight.set(query, p) }
    body = await p
    if (body) {
      const entry = { at: Date.now(), body }
      memory.set(query, entry)
      try { writeFileSync(fileFor(query), JSON.stringify(entry)) } catch { /* read-only checkout: uncached */ }
    }
  }
  if (!body) { res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"OpenStreetMap did not answer in time"}'); return }
  res.writeHead(200, { 'content-type': 'application/json', 'x-cache': hit ? 'hit' : 'miss' }).end(body)
}
