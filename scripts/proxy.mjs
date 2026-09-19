/* Tiny server that holds every secret. The browser (and the fixture script)
 * talk to /api/*; Vite forwards it here. A missing key makes only the routes
 * that need it answer 501 (naming the variable), so the rest keeps working.
 *
 *   GET  /api/health          which keys are configured (booleans only)
 *   POST /api/llm             { role: 'scout'|'critic'|'narrator', system, user, maxTokens } -> { text }
 *   POST /api/tts             { text } -> audio/mpeg (ElevenLabs, mp3_44100_128)
 *   POST /api/routes/matrix   { points: LatLon[] } -> { distanceM: (number|null)[][], durationSec: (number|null)[][] }
 *   POST /api/routes/walk     { from: LatLon, to: LatLon } -> { encodedPolyline, distanceM, durationSec }
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !line.trimStart().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
}

const env = name => process.env[name] || ''
const PORT = Number(env('PORT') || 8787)

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
  const model = requireEnv(`LLM_MODEL_${String(role).toUpperCase()}`)
  // The narrator is the fast, low-reasoning call; scout/critic use the model default unless overridden.
  const effort = env(`LLM_EFFORT_${String(role).toUpperCase()}`) || (role === 'narrator' ? 'low' : '')
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' },
      ...(effort ? { reasoning_effort: effort } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  })
  const data = await upstream.json()
  if (!upstream.ok) throw new HttpError(502, data?.error?.message ?? `openai ${upstream.status}`)
  const choice = data.choices?.[0]
  if (choice?.finish_reason === 'length') throw new HttpError(502, 'model ran out of output tokens (raise maxTokens)')
  json(res, 200, { text: choice?.message?.content ?? '' })
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
const secs = d => (d ? parseFloat(String(d).replace('s', '')) : 0)

async function routesMatrix(req, res) {
  const key = requireEnv('GOOGLE_ROUTES_KEY')
  const { points } = await readJson(req)
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
      travelMode: 'WALK',
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
  const key = requireEnv('GOOGLE_ROUTES_KEY')
  const { from, to } = await readJson(req)
  const upstream = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-goog-api-key': key,
      'x-goog-fieldmask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({ origin: wp(from), destination: wp(to), travelMode: 'WALK', polylineEncoding: 'ENCODED_POLYLINE' }),
  })
  const data = await upstream.json()
  if (!upstream.ok) throw new HttpError(502, data?.error?.message ?? `routes ${upstream.status}`)
  const r = data.routes?.[0]
  if (!r) throw new HttpError(502, 'no walking route found')
  json(res, 200, { encodedPolyline: r.polyline.encodedPolyline, distanceM: r.distanceMeters ?? 0, durationSec: secs(r.duration) })
}

const routes = {
  'GET /api/health': (_req, res) => json(res, 200, {
    ok: true,
    keys: { openai: !!env('OPENAI_API_KEY'), elevenlabs: !!env('ELEVENLABS_API_KEY') && !!env('ELEVENLABS_VOICE_ID'), routes: !!env('GOOGLE_ROUTES_KEY') },
  }),
  'POST /api/llm': llm,
  'POST /api/tts': tts,
  'POST /api/routes/matrix': routesMatrix,
  'POST /api/routes/walk': routesWalk,
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost')
  const handler = routes[`${req.method} ${pathname}`]
  if (!handler) return json(res, 404, { error: 'no such route' })
  try { await handler(req, res) } catch (e) { json(res, e.status ?? 500, { error: String(e?.message ?? e) }) }
}).listen(PORT, '127.0.0.1', () => console.log(`orion proxy on :${PORT}`))
