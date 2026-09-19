import type { Plan, Stop, Target, Wish } from '../types'
import { HHMM, MINS } from '../types'
import type { Agent, CrewEvent } from './events'
import { geocode, locate } from './geocode'
import { notable, photoFor, wikiSource, type Article } from './wikipedia'
import { bestOrder, legsFor } from './router'
import { schedule, windowOf } from './timekeeper'
import { narrate, withAudio, type Mode, type StopContext } from './narrator'
import { estimateSec, speak } from './tts'
import { catalogueFor, findStops, matchWant, roomFor, type Candidate, type Skeleton } from './crew'
import { slug } from './geo'

/* The second half of the crew: reading up on each place, writing what the
 * guide will say, and speaking it. It runs on a Skeleton — a day whose stops,
 * order and roads are already settled, whether that was settled on the
 * planning page a step at a time or headlessly by `planTour` below.
 *
 * Splitting it here is what lets the planning page show the router working on
 * a map instead of behind a spinner, without a second copy of the logic.
 */

const TARGET_RADIUS_M = 300  // what a guide can point at from a stop
const PLAN_VERSION = 3
const MAX_TTS_CONCURRENT = 3

export type PipelineOptions = {
  onEvent?: (e: CrewEvent) => void
  /** Where a beat's mp3 goes; returns the URL the browser will play it from.
      Browser: a blob URL. Fixture script: a file under public/plans/<id>/. */
  saveAudio: (planId: string, name: string, bytes: ArrayBuffer) => Promise<string>
  signal?: AbortSignal
}

function limiter(max: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>(r => waiting.push(r))
    active++
    try { return await fn() } finally { active--; waiting.shift()?.() }
  }
}

/** The book. Targets, narration and voice per stop, in parallel, plus the
    photo — then the clock over the finished set. */
export async function writePages(skeleton: Skeleton, opts: PipelineOptions): Promise<Plan> {
  const { wish, mode, origin, from, stops: chosen, legs, approach } = skeleton
  const { onEvent = () => {}, saveAudio } = opts
  const say = (agent: Agent, kind: 'tool' | 'agent', state: 'working' | 'done' | 'reworking' | 'failed', detail: string) =>
    onEvent({ type: 'crew', agent, kind, state, detail })

  const planId = `${slug(origin.name)}-${mode}-v${PLAN_VERSION}`
  const window = windowOf(wish)
  const clock = schedule(chosen.map(c => c.visitMin), legs.map(l => l.durationSec), window, approach?.durationSec ?? 0, wish.meals)
  if (clock.breaks.length) {
    say('Timekeeper', 'tool', 'done',
      clock.breaks.map(b => `${b.minutes} min kept clear for ${b.label} after ${chosen[b.after]?.name}`).join('; '))
  }

  const voice = limiter(MAX_TTS_CONCURRENT)
  say('Narrator', 'agent', 'working', `Writing ${chosen.length} pages`)
  let voiceFailed = false

  const stops: Stop[] = await Promise.all(chosen.map(async (c, index): Promise<Stop> => {
    const a = c.article
    const here = { lat: c.lat, lon: c.lon }
    const [near, photo] = await Promise.all([
      notable(here, TARGET_RADIUS_M, 10, 60).catch(() => []),
      a ? photoFor(a).catch(() => null) : Promise.resolve(null),
    ])
    const targets: Target[] = near
      .filter(n => n.pageId !== a?.pageId && n.extract.length > 60)
      .slice(0, 6).map(toTarget)

    const ctx: StopContext = {
      city: origin.name, index, total: chosen.length,
      arrival: clock.arrivals[index], visitMin: c.visitMin,
      previous: index ? chosen[index - 1].name : from?.name,
      legMin: index ? legs[index - 1]?.durationSec / 60 : approach ? approach.durationSec / 60 : undefined,
      transport: wish.transport, party: wish.party, interests: wish.interests,
      last: index === chosen.length - 1,
    }

    let drafts: { text: string; targetId?: string }[] = []
    if (a || targets.length) {
      try {
        drafts = (await narrate({ name: c.name, extract: a?.extract ?? '' }, targets, mode, ctx)).beats
      } catch (e) {
        say('Narrator', 'agent', 'failed', `${c.name}: ${(e as Error).message}`)
      }
    }

    const beats = await Promise.all(drafts.map((d, i) => voice(async () => {
      try {
        const { bytes, durationSec } = await speak(d.text)
        return withAudio(d, await saveAudio(planId, `${c.id}-${i}.mp3`, bytes), durationSec)
      } catch (e) {
        if (!voiceFailed) { voiceFailed = true; say('Voice', 'agent', 'failed', String((e as Error).message)) }
        return withAudio(d, null, +estimateSec(d.text).toFixed(2))
      }
    })))

    const brk = clock.breaks.find(b => b.after === index)
    const stop: Stop = {
      id: c.id, name: c.name, lat: c.lat, lon: c.lon,
      blurb: a ? firstSentence(a.extract) : c.why,
      photo, sources: a ? [wikiSource(a)] : [], targets, beats,
      visitMin: c.visitMin, arrival: clock.arrivals[index], fits: c.why, asked: c.asked,
      ...(brk ? { breakMin: brk.minutes } : {}),
    }
    onEvent({ type: 'stop', index, stop })
    return stop
  }))
  say('Narrator', 'agent', 'done', `${stops.length} pages written`)

  const plan: Plan = {
    id: planId, city: origin.name, origin: { lat: origin.lat, lon: origin.lon }, mode, stops, legs,
    wish, from, approach,
    epigraph: epigraphFor(stops, legs, approach, window, clock.endsAt),
    generatedAt: new Date().toISOString(),
    provenance: {
      router: 'code', timekeeper: 'code',
      scout: chosen.every(c => c.asked) ? 'you named every stop' : 'llm',
      critic: chosen.every(c => c.asked) ? 'code checks' : 'llm + code checks',
      narrator: 'llm', tts: 'elevenlabs:mp3_44100_128',
    },
  }
  onEvent({ type: 'plan', plan })
  return plan
}

/** The whole run, headless: what the fixture script and any caller without a
    planning page uses. Identical to what the page does, in one call. */
export async function planTour(wish: Wish, opts: PipelineOptions & { mode?: Mode }): Promise<Plan> {
  const { mode = 'full', onEvent = () => {}, signal } = opts
  const say = (agent: Agent, kind: 'tool' | 'agent', state: 'working' | 'done' | 'failed', detail: string) =>
    onEvent({ type: 'crew', agent, kind, state, detail })

  say('Geocode', 'tool', 'working', `Looking up ${wish.city}`)
  const origin = await geocode(wish.city, signal)
  const wants = wish.wants.map(w => w.trim()).filter(Boolean)
  const found = (await Promise.all(wants.map(w => locate(w, origin, signal)))).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof locate>>>[]
  const from = wish.from.trim() ? await locate(wish.from.trim(), origin, signal) : null
  const missing = wants.length - found.length
  say('Geocode', 'tool', missing ? 'failed' : 'done',
    missing ? `${missing} of the places you named could not be found` : `${origin.name}${found.length ? `, and ${found.length} you named` : ''}`)

  say('Scout', 'agent', 'working', `Reading about places near ${origin.name}`)
  const catalogue = await catalogueFor(origin)
  const taken = new Set<number>()
  const fixed: Candidate[] = []
  for (const w of found) fixed.push(await matchWant(w, catalogue, taken, wish))

  const extra = await findStops({
    catalogue, wish, mode, fixed, count: roomFor(mode, fixed.length), onEvent,
    legSecs: async all => (await legsFor(all.map(c => ({ id: c.id, lat: c.lat, lon: c.lon })), wish.transport)).map(l => l.durationSec),
  })

  const all = [...fixed, ...extra]
  if (!all.length) throw new Error('Nothing to plan: no places were found or chosen.')

  say('Router', 'tool', 'working', `Measuring real ${wish.transport} times`)
  const points = [...(from ? [from] : []), ...all]
  const routed = await bestOrder(points, wish.transport, !!from)
  const seq = routed.order.filter(i => !(from && i === 0)).map(i => from ? i - 1 : i)
  const stops = seq.map(i => all[i])
  const chain = [...(from ? [{ id: 'from', lat: from.lat, lon: from.lon }] : []), ...stops]
  const allLegs = await legsFor(chain, wish.transport)
  const approach = from ? allLegs[0] ?? null : null
  const legs = from ? allLegs.slice(1) : allLegs
  const km = (legs.reduce((s, l) => s + l.distanceM, 0) + (approach?.distanceM ?? 0)) / 1000
  say('Router', 'tool', legs.some(l => l.estimated) ? 'failed' : 'done',
    legs.some(l => l.estimated) ? `${km.toFixed(1)} km, some of it estimated` : `${km.toFixed(1)} km of real ground`)

  return writePages({ wish, mode, origin, from, stops, legs, approach }, opts)
}

/* ------------------------------------------------------------------ helpers */

const toTarget = (a: Article): Target => ({
  id: `w${a.pageId}`, name: a.title, lat: a.lat, lon: a.lon, summary: a.extract, source: wikiSource(a),
})

const firstSentence = (s: string) => {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.split(/(?<=[.!?])\s+(?=[A-Z"“(])/)[0] || clean
}

/** One line under the title, counted rather than written: every number in it
    is a field of this plan. */
function epigraphFor(stops: Stop[], legs: Plan['legs'], approach: Plan['approach'], w: { startMin: number }, endsAt: string) {
  if (!stops.length) return ''
  const km = (legs.reduce((s, l) => s + l.distanceM, 0) + (approach?.distanceM ?? 0)) / 1000
  return `${stops.length} places, ${km.toFixed(1)} km, ${HHMM(w.startMin)} to ${endsAt}.`
}

export { MINS }
