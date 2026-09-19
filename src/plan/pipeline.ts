import type { Plan, Stop, Target, Wish } from '../types'
import { HHMM, MINS } from '../types'
import type { Agent, CrewEvent } from './events'
import { geocode, locate } from './geocode'
import { notable, photoFor, wikiSource, type Article } from './wikipedia'
import { bestOrder, legsFor } from './router'
import { schedule, windowOf } from './timekeeper'
import { narrate, withAudio, writePreface, type Mode, type StopContext } from './narrator'
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
      ...(c.askedAs ? { askedAs: c.askedAs, movedM: c.movedM } : {}),
      ...(brk ? { breakMin: brk.minutes } : {}),
    }
    onEvent({ type: 'stop', index, stop })
    return stop
  }))
  say('Narrator', 'agent', 'done', `${stops.length} pages written`)

  /* The opening note. It comes last because it is about the finished day, and
     it is allowed to fail: the book prints the counted epigraph either way. */
  say('Narrator', 'agent', 'working', 'Writing the opening note')
  const totalKm = (legs.reduce((s, l) => s + l.distanceM, 0) + (approach?.distanceM ?? 0)) / 1000
  const preface = await writePreface({
    city: origin.name, startAt: wish.startAt, endsAt: clock.endsAt, windowEnd: wish.endAt,
    party: wish.party, pace: wish.pace, transport: wish.transport, budget: wish.budget,
    interests: wish.interests, from: from?.name, approachMin: approach ? approach.durationSec / 60 : undefined,
    meals: clock.breaks.map(b => ({ label: b.label, minutes: b.minutes, after: stops[b.after]?.name ?? '' })),
    totalKm,
    stops: stops.map((s, i) => ({
      name: s.name, arrival: s.arrival, stayMin: s.visitMin, why: s.fits,
      asked: s.asked, askedAs: s.askedAs, movedM: s.movedM,
      hasArticle: !!s.sources.length, targets: s.targets.length,
      legMinToNext: legs[i] ? legs[i].durationSec / 60 : undefined,
      legEstimated: legs[i]?.estimated,
    })),
  })
  say('Narrator', 'agent', preface ? 'done' : 'failed', preface ? 'The opening note is written' : 'No opening note — the counted line stands alone')

  const plan: Plan = {
    id: planId, city: origin.name, origin: { lat: origin.lat, lon: origin.lon }, mode, stops, legs,
    wish, from, approach,
    epigraph: epigraphFor(stops, legs, approach, window, clock.endsAt), preface,
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

/* ======================================================================
   The trip.

   A day was one route. A trip is several, plus the two things a day never
   needed: a bed, and dinner. The shape of the code follows that exactly —
   every day is built by the same writePages that built the single day, so a
   day of a trip and a day on its own are the same object, and src/fly can fly
   either without knowing which it has.
   ====================================================================== */

import type { Day, Stay, Trip } from '../types'
import { chooseBeds, chooseTables, shapeDays } from './trip'

/** How many places a day can hold before it stops being a day out. */
const perDay = (mode: Mode) => (mode === 'short' ? 3 : 4)

export type TripOptions = PipelineOptions & { mode?: Mode }

export async function planTrip(wish: Wish, opts: TripOptions): Promise<Trip> {
  const { mode = 'full', onEvent = () => {}, signal } = opts
  const say = (agent: Agent, kind: 'tool' | 'agent', state: 'working' | 'done' | 'failed', detail: string) =>
    onEvent({ type: 'crew', agent, kind, state, detail })
  const nDays = Math.max(1, Math.min(7, Math.round(wish.days || 1)))

  /* ---- 1. the city, and anything they pinned themselves ------------------ */

  say('Geocode', 'tool', 'working', `Looking up ${wish.city}`)
  const origin = await geocode(wish.city, signal)
  const wants = wish.wants.map(w => w.trim()).filter(Boolean)
  const found = (await Promise.all(wants.map(w => locate(w, origin, signal))))
    .filter(Boolean) as NonNullable<Awaited<ReturnType<typeof locate>>>[]
  const from = wish.from.trim() ? await locate(wish.from.trim(), origin, signal) : null
  say('Geocode', 'tool', 'done',
    `${origin.name}${found.length ? `, and ${found.length} place${found.length === 1 ? '' : 's'} you named` : ''}`)

  /* ---- 2. everything worth flying to, over the whole trip ---------------- */

  say('Scout', 'agent', 'working', `Reading about places across ${origin.name}`)
  // A trip reaches further than a day: more days means a wider area is fair.
  const catalogue = await catalogueFor(origin, Math.min(6000, 2200 + nDays * 900))
  const taken = new Set<number>()
  const fixed: Candidate[] = []
  for (const w of found) fixed.push(await matchWant(w, catalogue, taken, wish, onEvent))

  const want = nDays * perDay(mode)
  const extra = await findStops({
    catalogue, wish, mode, fixed, count: Math.max(0, want - fixed.length), onEvent,
  })
  const all = [...fixed, ...extra]
  if (!all.length) throw new Error('Nothing to plan: no places were found or chosen.')

  /* ---- 3. which places belong to which day ------------------------------- */

  say('Scout', 'agent', 'working', `Laying ${all.length} places out over ${nDays} day${nDays === 1 ? '' : 's'}`)
  const shapes = await shapeDays(all, nDays, wish)
  say('Scout', 'agent', 'done', shapes.map((d, i) => `${i + 1}. ${d.title} (${d.ids.length})`).join(' · '))

  /* ---- 4. each day: route it, write it, feed it -------------------------- */

  const byId = new Map(all.map(c => [c.id, c]))
  const days: Day[] = []
  for (const [i, shape] of shapes.entries()) {
    const chosen = shape.ids.map(id => byId.get(id)!).filter(Boolean)
    if (!chosen.length) continue

    say('Router', 'tool', 'working', `Day ${i + 1}: measuring real ${wish.transport} times`)
    // The bed is where each day starts and ends once it is known; on the first
    // pass there is no bed yet, so a given starting point stands in.
    const points = [...(from ? [from] : []), ...chosen]
    const routed = await bestOrder(points, wish.transport, !!from)
    const seq = routed.order.filter(k => !(from && k === 0)).map(k => from ? k - 1 : k)
    const ordered = seq.map(k => chosen[k])
    const chain = [...(from ? [{ id: 'from', lat: from.lat, lon: from.lon }] : []), ...ordered]
    const allLegs = await legsFor(chain, wish.transport)
    const approach = from ? allLegs[0] ?? null : null
    const legs = from ? allLegs.slice(1) : allLegs
    say('Router', 'tool', 'done',
      `Day ${i + 1}: ${((legs.reduce((s, l) => s + l.distanceM, 0)) / 1000).toFixed(1)} km`)

    const plan = await writePages({ wish, mode, origin, from, stops: ordered, legs, approach }, {
      ...opts,
      onEvent: e => onEvent(e.type === 'crew' ? { ...e, detail: `Day ${i + 1}: ${e.detail}` } : e),
    })

    say('Narrator', 'agent', 'working', `Day ${i + 1}: finding somewhere to eat`)
    const tables = await chooseTables({
      number: i + 1, title: shape.title,
      stops: plan.stops.map(s => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, arrival: s.arrival })),
    }, wish, signal)
    say('Narrator', 'agent', tables.length ? 'done' : 'failed',
      tables.length
        ? `Day ${i + 1}: ${tables.map(t => `${t.meal} at ${t.name}`).join(', ')}`
        : `Day ${i + 1}: OpenStreetMap had nothing named near those stops`)

    days.push({ ...plan, id: `${plan.id}-d${i + 1}`, number: i + 1, title: shape.title, tables })
  }
  if (!days.length) throw new Error('The trip came out empty.')

  /* ---- 5. a bed, central to all of it ------------------------------------ */

  const spread = days.flatMap(d => d.stops)
  const centre = {
    lat: spread.reduce((s, p) => s + p.lat, 0) / spread.length,
    lon: spread.reduce((s, p) => s + p.lon, 0) / spread.length,
  }
  say('Scout', 'agent', 'working', 'Looking for somewhere to sleep, central to the whole trip')
  const { stays, looked } = await chooseBeds(centre, wish, days.map(d => d.title), signal)
  say('Scout', 'agent', stays.length ? 'done' : 'failed',
    stays.length
      ? `${stays[0].name}${stays.length > 1 ? ` and ${stays.length - 1} more` : ''}, from ${looked} OpenStreetMap knows of`
      : 'OpenStreetMap lists nothing to sleep in near the middle of this trip')

  const trip: Trip = {
    id: `${slug(origin.name)}-${nDays}d-v${PLAN_VERSION}`,
    city: origin.name, origin: { lat: origin.lat, lon: origin.lon },
    wish, days, stays,
    preface: days[0]?.preface ?? '',
    generatedAt: new Date().toISOString(),
    provenance: {
      places: 'Wikipedia geosearch, chosen by a model', lodging: 'OpenStreetMap, chosen by a model',
      food: 'OpenStreetMap, chosen by a model', router: 'Google Routes',
      narrator: 'llm', tts: 'elevenlabs:mp3_44100_128',
    },
  }
  onEvent({ type: 'trip', trip })
  return trip
}

export type { Stay }
