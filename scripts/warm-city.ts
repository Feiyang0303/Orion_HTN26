/* Fill the proxy's disk cache for a city, so that planning it later is instant.
 * Run it for the cities you will demo, on a connection you trust:
 *
 *   npm run proxy                       # in another terminal
 *   npm run warm -- Paris Kyoto Toronto
 *
 * It geocodes each name, then builds the wide catalogue, which is the slow part
 * (Wikidata, ~30 s on a dense city) and which the proxy caches for 7 days.
 */
import { net } from '../src/plan/net'
import { geocode } from '../src/plan/geocode'
import { wideCatalogue, wideConfig } from '../src/plan/wikipedia'

wideConfig.sparqlMs = 150_000      // warming can wait as long as Wikidata needs; that is the point
net.apiBase = process.env.PROXY_URL ?? 'http://127.0.0.1:8787'
net.headers = { 'User-Agent': 'orion-hackathon/0.1 (warm-city)' }
const health = await fetch(`${net.apiBase}/api/health`).then(r => r.ok).catch(() => false)
if (!health) { console.error(`Proxy not reachable at ${net.apiBase}. Run: npm run proxy`); process.exit(1) }

for (const name of process.argv.slice(2)) {
  const t = Date.now()
  try {
    const place = await geocode(name)
    const list = await wideCatalogue(place)
    console.log(`${name}: ${list.length} places in ${((Date.now() - t) / 1000).toFixed(1)}s — ${list.slice(0, 6).map(a => a.title).join(', ')}`)
  } catch (e) { console.log(`${name}: FAILED — ${(e as Error).message}`) }
}
