/* Generates one real Plan (JSON + mp3s) with the same pipeline the app runs.
 *
 *   npm run proxy            # in another terminal, with .env filled in
 *   npm run fixture -- "Paris" --short [--want "Louvre" --want "Pont Neuf"]
 *                          [--from "Gare du Nord"] [--pace gentle|steady|full]
 *                          [--transport walk|cycle|transit|drive]
 *                          [--hours 09:30-18:00] [--interests "History,Views"]
 *                          [--party solo|couple|family|easy] [--budget free|modest|any]
 *                          [--meals lunch,dinner] [--days 3]
 *                          [--diet "vegetarian"]
 *
 * Writes public/plans/<id>/plan.json and public/plans/<id>/audio/*.mp3.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Wish } from '../src/types'
import { net } from '../src/plan/net'
import { planTour } from '../src/plan/pipeline'

const args = process.argv.slice(2)
const query = args.find(a => !a.startsWith('--'))
const mode = args.includes('--short') ? 'short' : 'full'
if (!query) { console.error('usage: npm run fixture -- "<place>" [--short] [--want "X"]...'); process.exit(1) }

/** Every value of a repeated flag, in order. */
const all = (flag: string) => args.flatMap((a, i) => a === `--${flag}` && args[i + 1] ? [args[i + 1]] : [])
const one = (flag: string, fallback: string) => all(flag)[0] ?? fallback
const [startAt, endAt] = one('hours', '09:30-18:00').split('-')

const wish: Wish = {
  city: query,
  wants: all('want'),
  from: one('from', ''),
  startAt: startAt || '09:30',
  endAt: endAt || '18:00',
  interests: one('interests', '').split(',').map(s => s.trim()).filter(Boolean),
  pace: one('pace', 'steady') as Wish['pace'],
  transport: one('transport', 'walk') as Wish['transport'],
  party: one('party', 'solo') as Wish['party'],
  budget: one('budget', 'modest') as Wish['budget'],
  meals: one('meals', '').split(',').map(s => s.trim()).filter(Boolean) as Wish['meals'],
  days: Number(one('days', '1')) || 1,
  diet: one('diet', ''),
}

net.apiBase = process.env.PROXY_URL ?? 'http://127.0.0.1:8787'
net.headers = { 'User-Agent': 'orion-hackathon/0.1 (fixture script)' }

const health = await fetch(`${net.apiBase}/api/health`).then(r => r.json() as Promise<{ keys: Record<string, boolean> }>).catch(() => null)
if (!health) { console.error(`Proxy not reachable at ${net.apiBase}. Run: npm run proxy`); process.exit(1) }
const missing = Object.entries(health.keys).filter(([, ok]) => !ok).map(([k]) => k)
if (missing.length) console.warn(`Warning: proxy is missing keys for: ${missing.join(', ')}`)

const plan = await planTour(wish, {
  mode,
  voice: true,
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
