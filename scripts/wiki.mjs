/* A polite, caching front for Wikipedia and Wikimedia Commons.
 *
 * Those services rate-limit per IP, erratically: fine at one request a second,
 * then a run of 429s for a minute. Fifty requests fired from a browser tab trip
 * it every time. So all of them go through here instead:
 *
 *   - one request at a time per host, with a small gap between them
 *   - 429/503 waited out (Retry-After if given) and retried
 *   - every good answer cached on disk (.cache/wiki, 7 days), so a city that has
 *     been planned once is instant
 *
 *   GET /api/wiki?u=<encoded upstream url>
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as Sentry from '@sentry/node'     // a no-op until instrument.mjs has initialised it

const DIR = '.cache/wiki'
const TTL_MS = 7 * 24 * 3600 * 1000
const UA = process.env.WIKI_USER_AGENT || 'Orion-hackathon/0.1 (https://github.com/Feiyang0303/Orion_HTN26)'
const ALLOWED = [
  /^https:\/\/(en\.wikipedia\.org|commons\.wikimedia\.org)\/w\/api\.php\?/,
]
const GAP_MS = 250

mkdirSync(DIR, { recursive: true })
const memory = new Map()
const lanes = new Map()          // one chain of work per upstream host

const sleep = ms => new Promise(r => setTimeout(r, ms))
const fileFor = url => `${DIR}/${createHash('sha1').update(url).digest('hex')}.json`

function cached(url) {
  const hit = memory.get(url)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.body
  const f = fileFor(url)
  if (existsSync(f)) {
    try {
      const { at, body } = JSON.parse(readFileSync(f, 'utf8'))
      if (Date.now() - at < TTL_MS) { memory.set(url, { at, body }); return body }
    } catch { /* corrupt entry: refetch */ }
  }
  return null
}

function inLane(host, work) {
  const prev = lanes.get(host) ?? Promise.resolve()
  const run = prev.then(async () => { const r = await work(); await sleep(GAP_MS); return r })
  lanes.set(host, run.catch(() => {}))
  return run
}

/* Every upstream attempt is a line on the console and, when Sentry is on, a
   span and a log with the same fields. Wikidata in particular can answer in
   12 s, refuse with 429, or say nothing for a minute, and which of those it is
   was invisible until this. */
async function fetchUpstream(url) {
  const host = new URL(url).hostname
  const kind = new URL(url).searchParams.get('prop') ?? new URL(url).searchParams.get('list') ?? 'query'
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now()
    let status = 0, told = null, bytes = 0, outcome = 'ok'
    try {
      const res = await Sentry.startSpan({ op: 'http.client', name: `wiki ${host} ${kind}`, attributes: { 'http.request.method': 'GET', 'server.address': host, attempt } }, async span => {
        const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(58_000) })
        span.setAttribute('http.response.status_code', r.status)
        status = r.status
        told = r.headers.get('retry-after')
        return r
      })
      if (res.ok) { const text = await res.text(); bytes = text.length; return text }
      outcome = 'refused'
      if ((res.status === 429 || res.status === 503) && attempt < 5) {
        const wait = Math.min(20_000, (Number(told) > 0 ? Number(told) : 1.5 * 2 ** attempt) * 1000)
        note(host, kind, attempt, status, Date.now() - t0, `retry-after=${told ?? '-'} waiting ${Math.round(wait / 1000)}s`, outcome)
        await sleep(wait)
        continue
      }
      const err = new Error(`${host} answered ${res.status}`)
      err.status = res.status === 429 ? 503 : 502
      throw err
    } catch (e) {
      if (outcome === 'ok') outcome = e?.name === 'TimeoutError' ? 'timeout' : 'error'
      note(host, kind, attempt, status, Date.now() - t0, e?.name === 'TimeoutError' ? 'no answer in 58s' : String(e?.message ?? e), outcome)
      throw e
    } finally {
      if (outcome === 'ok') note(host, kind, attempt, status, Date.now() - t0, `${Math.round(bytes / 1024)} KB`, outcome)
    }
  }
}

const note = (host, kind, attempt, status, ms, detail, outcome) => {
  console.log(`[wiki] ${host} ${kind} attempt ${attempt + 1} → ${status || '-'} ${outcome} in ${(ms / 1000).toFixed(1)}s (${detail})`)
  Sentry.logger?.[outcome === 'ok' ? 'info' : 'warn']?.('wiki upstream', { host, kind, attempt: attempt + 1, status, outcome, ms, detail })
}

/** The cached body, or a paced fetch. */
export async function wikiFetch(url) {
  if (!ALLOWED.some(re => re.test(url))) { const e = new Error('that host is not allowed'); e.status = 400; throw e }
  const hit = cached(url)
  if (hit) { console.log(`[wiki] cache hit ${new URL(url).hostname}`); return { body: hit, hit: true } }
  const body = await inLane(new URL(url).hostname, () => cached(url) ?? fetchUpstream(url))
  JSON.parse(body)                       // never cache something that is not JSON
  const entry = { at: Date.now(), body }
  memory.set(url, entry)
  try { writeFileSync(fileFor(url), JSON.stringify(entry)) } catch { /* a read-only checkout still works, uncached */ }
  return { body, hit: false }
}

export async function handleWiki(req, res) {
  const u = new URL(req.url, 'http://localhost').searchParams.get('u') ?? ''
  try {
    const { body, hit } = await wikiFetch(u)
    res.writeHead(200, { 'content-type': 'application/json', 'x-cache': hit ? 'hit' : 'miss' }).end(body)
  } catch (e) {
    res.writeHead(e.status ?? 502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e.message ?? e) }))
  }
}
