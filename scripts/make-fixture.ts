/* Generates one real Plan (JSON + mp3s) with the same pipeline the app runs.
 *
 *   npm run proxy            # in another terminal, with .env filled in
 *   npm run fixture -- "Paris" --short
 *
 * Writes public/plans/<id>/plan.json and public/plans/<id>/audio/*.mp3.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { net } from '../src/plan/net'
import { planTour } from '../src/plan/pipeline'

const args = process.argv.slice(2)
const query = args.find(a => !a.startsWith('--'))
const mode = args.includes('--short') ? 'short' : 'full'
if (!query) { console.error('usage: npm run fixture -- "<place>" [--short]'); process.exit(1) }

net.apiBase = process.env.PROXY_URL ?? 'http://127.0.0.1:8787'
net.headers = { 'User-Agent': 'orion-hackathon/0.1 (fixture script)' }

const health = await fetch(`${net.apiBase}/api/health`).then(r => r.json() as Promise<{ keys: Record<string, boolean> }>).catch(() => null)
if (!health) { console.error(`Proxy not reachable at ${net.apiBase}. Run: npm run proxy`); process.exit(1) }
const missing = Object.entries(health.keys).filter(([, ok]) => !ok).map(([k]) => k)
if (missing.length) console.warn(`Warning: proxy is missing keys for: ${missing.join(', ')}`)

const plan = await planTour(query, {
  mode,
  onEvent: e => { if (e.type === 'crew') console.log(`[${e.agent}${e.kind === 'tool' ? ' (tool)' : ''}] ${e.state}: ${e.detail}`) },
  saveAudio: async (planId, name, bytes) => {
    const dir = join('public', 'plans', planId, 'audio')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, name), Buffer.from(bytes))
    return `/plans/${planId}/audio/${name}`
  },
})

const out = join('public', 'plans', plan.id)
await mkdir(out, { recursive: true })
await writeFile(join(out, 'plan.json'), JSON.stringify(plan, null, 1))
console.log(`\nwrote ${out}/plan.json (${plan.stops.length} stops, ${plan.legs.length} legs)`)
