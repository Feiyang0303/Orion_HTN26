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
import * as Sentry from '@sentry/node'
import { loadEnv, scrub } from './shared.mjs'
import { handleWiki } from './wiki.mjs'
import { handleOverpass } from './overpass.mjs'

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
const readJson = req => new Promise((resolve, reject) => {
  let s = ''
  req.on('data', c => { s += c }).on('end', () => { try { resolve(JSON.parse(s || '{}')) } catch (e) { reject(new HttpError(400, 'bad JSON body')) } }).on('error', reject)
})

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
    return { text: choice?.message?.content ?? '', usage, model: data.model ?? model }
  })
  json(res, 200, out)
}

/* ---- TTS ---------------------------------------------------------------- */
async function tts(req, res) {
  const key = requireEnv('ELEVENLABS_API_KEY')
  const voice = requireEnv('ELEVENLABS_VOICE_ID')
  const { text } = await readJson(req)
  if (!text) throw new HttpError(400, 'text required')
  const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': key, accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: env('ELEVENLABS_MODEL') || 'eleven_flash_v2_5' }),
  })
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
    keys: { openai: !!env('OPENAI_API_KEY'), elevenlabs: !!env('ELEVENLABS_API_KEY') && !!env('ELEVENLABS_VOICE_ID'), routes: !!routesKey() },
  }),
  'GET /api/wiki': handleWiki,
  'POST /api/overpass': (req, res) => handleOverpass(req, res, readJson),
  'POST /api/llm': llm,
  'POST /api/tts': tts,
  'POST /api/routes/matrix': routesMatrix,
  'POST /api/routes/walk': routesWalk,
}

createServer(async (req, res) => {
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
}).listen(PORT, '127.0.0.1', () => console.log(`orion proxy on :${PORT}`))
