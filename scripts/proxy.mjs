/* Tiny server that holds every secret. The browser (and the fixture script)
 * talk to /api/*; Vite forwards it here. A missing key makes only the routes
 * that need it answer 501 (naming the variable), so the rest keeps working.
 *
 *   GET  /api/health          which keys are configured (booleans only)
 *   POST /api/llm             { role: 'scout'|'critic'|'narrator', system, user, maxTokens } -> { text }
 *   POST /api/tts             { text } -> audio/mpeg (ElevenLabs, mp3_44100_128)
 *   POST /api/routes/matrix   { points: LatLon[], transport? } -> { distanceM: (number|null)[][], durationSec: (number|null)[][] }
 *   POST /api/routes/walk     { from: LatLon, to: LatLon, transport? } -> { encodedPolyline, distanceM, durationSec }
 */
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { randomBytes } from 'node:crypto'
import * as Sentry from '@sentry/node'
import { loadEnv, scrub } from './shared.mjs'
import { handleWiki } from './wiki.mjs'
import { handleOverpass } from './overpass.mjs'
import { tripRoutes } from './trips.mjs'

loadEnv()   // also done by instrument.mjs when preloaded; harmless twice
const env = name => process.env[name] || ''
const PORT = Number(env('PORT') || 8787)
const DEFAULT_MODELS = { scout: 'gpt-4o', critic: 'gpt-4o', narrator: 'gpt-4o' }
const routesKey = () => env('GOOGLE_ROUTES_KEY') || env('VITE_GOOGLE_MAPS_KEY')

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const requireEnv = name => { const v = env(name); if (!v) throw new HttpError(501, `${name} is not set on the proxy.`); return v }

const json = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
const readJson = (req, max = 5e6) => new Promise((resolve, reject) => {
  let s = ''
  req.on('data', c => { s += c; if (s.length > max) { reject(new HttpError(413, 'too large')); req.destroy() } }).on('end', () => { try { resolve(JSON.parse(s || '{}')) } catch (e) { reject(new HttpError(400, 'bad JSON body')) } }).on('error', reject)
})

const readBuf = (req, max = 20e6) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0
  req.on('data', c => { n += c.length; if (n > max) { reject(new HttpError(413, 'too large')); req.destroy() } else chunks.push(c) })
    .on('end', () => resolve(Buffer.concat(chunks))).on('error', reject)
})
const trips = tripRoutes({ json, readJson: (req, max) => readJson(req, max), readBuf, HttpError })

/* ---- Where a headset finds this machine ---- */
/** The machine's address on the local network, for the link a headset opens. */
function lan(_req, res) {
  const ips = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address)
  json(res, 200, { ips })
}

/* ---- LLM ---------------------------------------------------------------- */
async function llm(req, res) {
  const key = requireEnv('OPENAI_API_KEY')
  const { role, system, user, maxTokens = 2000 } = await readJson(req)
  const model = env(`LLM_MODEL_${String(role).toUpperCase()}`) || DEFAULT_MODELS[role] || ''
  if (!model) throw new HttpError(501, `LLM_MODEL_${String(role).toUpperCase()} is not set on the proxy.`)
  // Reasoning models only: gpt-4o rejects reasoning_effort. Narrator stays low on those models.
  const effort = env(`LLM_EFFORT_${String(role).toUpperCase()}`) || (role === 'narrator' && /(?:^o\d|gpt-5)/i.test(model) ? 'low' : '')
  // One model call, in Sentry's AI conventions, with what it cost: this is what
  // the AI Agents view and the token dashboards read.
  // The response is sent after the span ends: the request's own transaction closes
  // when the response goes out, and a span still open by then is dropped.
  const out = await Sentry.startSpan({
    name: `chat ${model}`, op: 'gen_ai.chat',
    attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.system': 'openai', 'gen_ai.request.model': model, 'gen_ai.agent.name': String(role), 'gen_ai.request.max_tokens': maxTokens },
  }, async span => {
    const t0 = Date.now()
    /* Reasoning models spend the completion budget on thinking first, so a budget
       that suits a plain model can run out before a single word of the answer.
       That used to fail the whole stage; now it gets one retry with three times
       the room, which the trace records, so how often it happens is visible. */
    const ask = async budget => {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, max_completion_tokens: budget,
          response_format: { type: 'json_object' },
          ...(effort ? { reasoning_effort: effort } : {}),
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      })
      return { upstream: r, data: await r.json() }
    }
    let { upstream, data } = await ask(maxTokens)
    const retried = upstream.ok && data.choices?.[0]?.finish_reason === 'length'
    if (retried) ({ upstream, data } = await ask(Math.min(16000, maxTokens * 3)))
    span.setAttribute('gen_ai.retried_with_larger_budget', retried)
    const usage = data.usage ?? {}
    span.setAttributes({
      'gen_ai.response.model': data.model ?? model,
      'gen_ai.usage.input_tokens': usage.prompt_tokens ?? 0,
      'gen_ai.usage.output_tokens': usage.completion_tokens ?? 0,
      'gen_ai.usage.total_tokens': usage.total_tokens ?? 0,
      'gen_ai.usage.output_tokens.reasoning': usage.completion_tokens_details?.reasoning_tokens ?? 0,
      'gen_ai.response.finish_reason': data.choices?.[0]?.finish_reason ?? 'error',
    })
    Sentry.logger.info('llm call', { role: String(role), model, ms: Date.now() - t0, status: upstream.status, input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? 0, finish: data.choices?.[0]?.finish_reason ?? 'error', retried })
    if (!upstream.ok) throw new HttpError(502, data?.error?.message ?? `openai ${upstream.status}`)
    const choice = data.choices?.[0]
    if (choice?.finish_reason === 'length') throw new HttpError(502, 'model ran out of output tokens even with three times the budget')
    return { text: choice?.message?.content ?? '', usage, model: data.model ?? model, retried }
  })
  json(res, 200, out)
}

/* ---- TTS ---------------------------------------------------------------- */
/* George is a default ElevenLabs voice (warm storyteller). Library voices
   like Rachel 402 on a free key; we pick from the account when unset. */
const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb'
let resolvedVoice = ''

async function listVoices(key) {
  const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } })
  const data = await r.json().catch(() => ({}))
  return data.voices ?? []
}

async function voiceId(key) {
  if (resolvedVoice) return resolvedVoice
  const set = env('ELEVENLABS_VOICE_ID')
  if (set) return (resolvedVoice = set)
  try {
    const voices = await listVoices(key)
    resolvedVoice = voices.find(v => v.voice_id === DEFAULT_VOICE)?.voice_id
      || voices.find(v => /george|storyteller|alice|educator/i.test(v.name ?? ''))?.voice_id
      || voices.find(v => v.category === 'premade' || v.category === 'default')?.voice_id
      || voices[0]?.voice_id
      || DEFAULT_VOICE
  } catch {
    resolvedVoice = DEFAULT_VOICE
  }
  return resolvedVoice
}

/* Strip the audio tags out of a line. v3 reads "[warmly] it is right there" as
   a delivery note; every other model reads it aloud, brackets and all. */
const untag = t => t.replace(/\[[^\]]{1,24}\]/g, ' ').replace(/\s{2,}/g, ' ').trim()

async function speak(key, voice, text, model, stability) {
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': key, accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: text.trim().slice(0, 5000),
      model_id: model,
      voice_settings: { stability, similarity_boost: 0.75 },
    }),
  })
}

/* The written pages are spoken by the fast model: there are dozens of them and
   they are read, not performed. The guide answering a question is one line at a
   time and wants to sound like someone talking, so it asks for `expressive`,
   which uses v3 and the audio tags the model wrote into the line.
   
   v3 is not on every account. When it is refused, rather than failing the
   answer, the same line is spoken by the fast model with the tags taken out —
   flatter, but the person still gets an answer, which matters more. */
async function tts(req, res) {
  const key = requireEnv('ELEVENLABS_API_KEY')
  const { text, expressive } = await readJson(req)
  if (!text || typeof text !== 'string') throw new HttpError(400, 'text required')
  const voice = await voiceId(key)
  const fast = env('ELEVENLABS_MODEL') || 'eleven_flash_v2_5'

  let upstream
  if (expressive) {
    // Lower stability leaves v3 room to act on the tags; at 0.45 it flattens them out.
    upstream = await speak(key, voice, text, env('ELEVENLABS_MODEL_EXPRESSIVE') || 'eleven_v3', 0.3)
    if (!upstream.ok) {
      const why = (await upstream.text()).slice(0, 160)
      console.warn(`[tts] expressive model refused (${upstream.status}: ${why}); falling back to ${fast}`)
      upstream = await speak(key, voice, untag(text), fast, 0.45)
    }
  } else {
    upstream = await speak(key, voice, untag(text), fast, 0.45)
  }

  if (!upstream.ok) throw new HttpError(502, `elevenlabs ${upstream.status}: ${(await upstream.text()).slice(0, 200)}`)
  res.writeHead(200, { 'content-type': 'audio/mpeg' }).end(Buffer.from(await upstream.arrayBuffer()))
}

/* ---- Routes ------------------------------------------------------------- */
const wp = p => ({ location: { latLng: { latitude: p.lat, longitude: p.lon } } })
/* The desk's transport, in the Routes API's words. Anything unknown walks,
   because a wrong travel mode is a wrong day and walking is the honest floor. */
const MODE = { walk: 'WALK', cycle: 'BICYCLE', transit: 'TRANSIT', drive: 'DRIVE' }
const modeOf = t => MODE[t] || 'WALK'
const secs = d => (d ? parseFloat(String(d).replace('s', '')) : 0)

async function routesMatrix(req, res) {
  const key = routesKey()
  if (!key) throw new HttpError(501, 'GOOGLE_ROUTES_KEY is not set on the proxy.')
  const { points, transport } = await readJson(req)
  if (!Array.isArray(points) || points.length < 2) throw new HttpError(400, 'need >= 2 points')
  const upstream = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-goog-api-key': key,
      'x-goog-fieldmask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
    },
    body: JSON.stringify({
      origins: points.map(p => ({ waypoint: wp(p) })),
      destinations: points.map(p => ({ waypoint: wp(p) })),
      travelMode: modeOf(transport),
    }),
  })
  const rows = await upstream.json()
  if (!upstream.ok) throw new HttpError(502, rows?.error?.message ?? `routes ${upstream.status}`)
  const n = points.length
  const grid = () => Array.from({ length: n }, () => Array(n).fill(null))
  const distanceM = grid(), durationSec = grid()
  for (const r of rows) {
    if (r.condition !== 'ROUTE_EXISTS') continue
    distanceM[r.originIndex][r.destinationIndex] = r.distanceMeters ?? 0
    durationSec[r.originIndex][r.destinationIndex] = secs(r.duration)
  }
  json(res, 200, { distanceM, durationSec })
}

async function routesWalk(req, res) {
  const key = routesKey()
  if (!key) throw new HttpError(501, 'GOOGLE_ROUTES_KEY is not set on the proxy.')
  const { from, to, transport } = await readJson(req)
  const upstream = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-goog-api-key': key,
      'x-goog-fieldmask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({ origin: wp(from), destination: wp(to), travelMode: modeOf(transport), polylineEncoding: 'ENCODED_POLYLINE' }),
  })
  const data = await upstream.json()
  if (!upstream.ok) throw new HttpError(502, data?.error?.message ?? `routes ${upstream.status}`)
  const r = data.routes?.[0]
  if (!r) throw new HttpError(502, 'no route found')
  json(res, 200, { encodedPolyline: r.polyline.encodedPolyline, distanceM: r.distanceMeters ?? 0, durationSec: secs(r.duration) })
}

const routes = {
  'GET /api/health': (_req, res) => json(res, 200, {
    ok: true,
    // Point a Sentry Uptime monitor at this URL. It is cheap, has no secrets, and
    // fails only when the process is down — which is what uptime is for.
    sentry: !!env('SENTRY_DSN'),
    persistentTrips: trips.persistent,
    keys: { openai: !!env('OPENAI_API_KEY'), elevenlabs: !!env('ELEVENLABS_API_KEY'), routes: !!routesKey() },
  }),
  'GET /api/wiki': handleWiki,
  'POST /api/overpass': (req, res) => handleOverpass(req, res, readJson),
  ...trips.routes,
  'GET /api/lan': lan,
  'POST /api/llm': llm,
  'POST /api/tts': tts,
  'POST /api/routes/matrix': routesMatrix,
  'POST /api/routes/walk': routesWalk,
}

/** One request, start to finish. The local server below and the Vercel function (api/index.js) both call this. */
export async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost')
  const handler = routes[`${req.method} ${pathname}`]
  if (!handler) return json(res, 404, { error: 'no such route' })
  try { await handler(req, res) } catch (e) {
    const status = e.status ?? 500
    // 4xx is the caller's fault and 501 is a key that is not configured: setup, not a fault.
    if (status >= 500 && status !== 501) {
      Sentry.withScope(scope => { scope.setTag('route', pathname); scope.setTag('status', String(status)); scope.setLevel(status === 502 ? 'warning' : 'error'); Sentry.captureException(e) })
    }
    json(res, status, { error: scrub(e?.message ?? e) })
  }
}

// On Vercel the platform does the listening and api/index.js hands each request to handle().
if (!process.env.VERCEL) createServer(handle).listen(PORT, '127.0.0.1', () => console.log(`orion proxy on :${PORT}`))
