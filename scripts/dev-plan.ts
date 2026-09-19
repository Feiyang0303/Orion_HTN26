/* Dev runner: the real planning pipeline (default wish: steady solo walk, 10:00-18:00), with Wikipedia calls paced and
 * retried on 429 by wrapping fetch here, so src/plan stays untouched. Voice is
 * skipped (no TTS key needed); beat lengths fall back to estimates.
 *
 *   PORT=8788 npm run proxy   (with keys)
 *   PROXY_URL=http://127.0.0.1:8788 npx tsx scripts/dev-plan.ts "Paris" --short
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { net } from '../src/plan/net'
import { planTour } from '../src/plan/pipeline'

const query = process.argv.slice(2).find(a => !a.startsWith('--'))
const mode = process.argv.includes('--short') ? 'short' : 'full'
if (!query) { console.error('usage: dev-plan.ts "<place>" [--short]'); process.exit(1) }
net.apiBase = process.env.PROXY_URL ?? 'http://127.0.0.1:8787'
net.headers = { 'User-Agent': 'orion-hackathon/0.1 (dev runner)' }

const realFetch = globalThis.fetch
let chain: Promise<unknown> = Promise.resolve()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = String(input)
  if (!/wikipedia\.org|wikimedia\.org|nominatim/.test(url)) return realFetch(input, init)
  const run = async () => {                                   // one at a time, 300 ms apart, retry on 429
    for (let i = 0; ; i++) {
      const res = await realFetch(input, init)
      if (res.status !== 429 || i >= 5) { await sleep(300); return res }
      await sleep(Math.min(10000, (Number(res.headers.get('retry-after')) || 2 ** i) * 1000))
    }
  }
  const p = chain.then(run, run); chain = p.catch(() => {}); return p
}) as typeof fetch

const t0 = Date.now()
const plan = await planTour({
  city: query, wants: [], startAt: '10:00', endAt: '18:00', from: '', interests: [], pace: 'steady',
  transport: 'walk', party: 'solo', budget: 'any', meals: [], days: 1, lodging: 'any', diet: '',
}, {
  mode,
  onEvent: e => { if (e.type === 'crew') console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s [${e.agent}${e.kind === 'tool' ? ' (tool)' : ''}] ${e.state}: ${e.detail}`) },
  saveAudio: async () => { throw new Error('voice skipped') },
})
const dir = join('public', 'plans', plan.id)
await mkdir(dir, { recursive: true })
await writeFile(join(dir, 'plan.json'), JSON.stringify(plan, null, 1))
console.log(`\ntotal ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${dir}/plan.json`)
