import { report, observeCrew } from '../telemetry'
import type { Leg, Plan, Stop, Target, Wish } from '../types'
import { HHMM, MINS, TRANSPORT_LABEL } from '../types'
import type { Agent, CrewEvent } from './events'
import { verdict } from './events'
import { geocode, locate } from './geocode'
import { notable, photoFor, warmStopSources, wikiSource, type Article } from './wikipedia'
import { bestOrder, legsFor, travelSecs } from './router'
import { schedule, windowOf } from './timekeeper'
import { narrate, withAudio, writeBridges, writePreface, type Draft, type Mode, type StopContext } from './narrator'
import { estimateSec, speak } from './tts'
import { auditText, repair, tally, unsupportedIn } from './auditor'
import { findStops, matchWant, roomFor, tripRadius, type Candidate, type Skeleton } from './crew'
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
const MAX_TTS_CONCURRENT = 6

export type PipelineOptions = {
  onEvent?: (e: CrewEvent) => void
  /** Stops already written on an earlier pass, by id. A revision that moves
      one place must not re-narrate and re-voice the four that did not move. */
  written?: Map<string, Stop>
  /** Where a beat's mp3 goes; returns the URL the browser will play it from.
      Browser: a blob URL. Fixture script: a file under public/plans/<id>/. */
  saveAudio: (planId: string, name: string, bytes: ArrayBuffer) => Promise<string>
  /** Speak now. The app leaves this off and voices a day when it flies;
      the paper journal never needs the clips. */
  voice?: boolean
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

const voiceQueue = limiter(MAX_TTS_CONCURRENT)

/** The book. Targets, narration and voice per stop, in parallel, plus the
    photo — then the clock over the finished set. */
export async function writePages(skeleton: Skeleton, opts: PipelineOptions): Promise<Plan> {
  const { wish, mode, origin, from, stops: chosen, legs, approach, back = null } = skeleton
  const { saveAudio } = opts
  const onEvent = observeCrew(opts.onEvent ?? (() => {}))
  const say = (agent: Agent, kind: 'tool' | 'agent', state: 'working' | 'done' | 'reworking' | 'failed', detail: string) =>
    onEvent({ type: 'crew', agent, kind, state, detail })

  const planId = `${slug(origin.name)}-${mode}-v${PLAN_VERSION}`
  const window = windowOf(wish)
  const clock = schedule(chosen.map(c => c.visitMin), legs.map(l => l.durationSec), window, approach?.durationSec ?? 0, wish.meals)
  if (clock.breaks.length) {
    say('Timekeeper', 'tool', 'done',
      clock.breaks.map(b => `${b.minutes} min kept clear for ${b.label} after ${chosen[b.after]?.name}`).join('; '))
  }

  say('Narrator', 'agent', 'working', `Writing ${chosen.length} pages`)
  let voiceFailed = false
  const speakNow = opts.voice === true

  /* Wikipedia first: the opening note needs article/target counts, not the
     spoken draft, so it can start as soon as the sources are in. */
  const pages = await Promise.all(chosen.map(async (c, index) => {
    const before = opts.written?.get(c.id)
    if (before) return { c, index, before, targets: before.targets, photo: before.photo }
    const a = c.article
    const [near, photo] = await Promise.all([
      notable({ lat: c.lat, lon: c.lon }, TARGET_RADIUS_M, 10, 60).catch(() => []),
      a ? photoFor(a).catch(() => null) : Promise.resolve(null),
    ])
    const targets: Target[] = near
      .filter(n => n.pageId !== a?.pageId && n.extract.length > 60)
      .slice(0, 6).map(toTarget)
    return { c, index, before: null as Stop | null, targets, photo }
  }))

  const totalKm = (legs.reduce((s, l) => s + l.distanceM, 0) + (approach?.distanceM ?? 0)) / 1000
  say('Narrator', 'agent', 'working', 'Writing the opening note')
  const prefaceP = writePreface({
    city: origin.name, startAt: wish.startAt, endsAt: clock.endsAt, windowEnd: wish.endAt,
    party: wish.party, pace: wish.pace, budget: wish.budget,
    transport: [...new Set([...(approach ? [approach] : []), ...legs, ...(back ? [back] : [])].map(l => l.transport))].join(' and ') || wish.transport,
    interests: wish.interests, from: from?.name, approachMin: approach ? approach.durationSec / 60 : undefined,
    meals: clock.breaks.map(b => ({ label: b.label, minutes: b.minutes, after: chosen[b.after]?.name ?? '' })),
    totalKm,
    stops: pages.map(({ c, index, before, targets }) => ({
      name: c.name, arrival: clock.arrivals[index], stayMin: c.visitMin, why: before?.fits ?? c.why,
      asked: c.asked, askedAs: c.askedAs, movedM: c.movedM,
      hasArticle: !!(before?.sources.length || c.article),
      targets: targets.length,
      legMinToNext: legs[index] ? legs[index].durationSec / 60 : undefined,
      legEstimated: legs[index]?.estimated,
    })),
  })

  const stops: Stop[] = await Promise.all(pages.map(async ({ c, index, before, targets, photo }): Promise<Stop> => {
    if (before) {
      const brk = clock.breaks.find(b => b.after === index)
      const stop: Stop = { ...before, visitMin: c.visitMin, arrival: clock.arrivals[index], ...(brk ? { breakMin: brk.minutes } : { breakMin: undefined }) }
      onEvent({ type: 'stop', index, stop })
      return stop
    }
    const a = c.article
    const ctx: StopContext = {
      city: origin.name, index, total: chosen.length,
      arrival: clock.arrivals[index], visitMin: c.visitMin,
      previous: index ? chosen[index - 1].name : from?.name,
      legMin: index ? legs[index - 1]?.durationSec / 60 : approach ? approach.durationSec / 60 : undefined,
      transport: index ? legs[index - 1]?.transport : approach?.transport,
      party: wish.party, interests: wish.interests,
      last: index === chosen.length - 1,
    }

    let drafts: Draft[] = []
    if (a || targets.length) {
      try {
        drafts = (await narrate({ name: c.name, extract: a?.extract ?? '' }, targets, mode, ctx)).beats
      } catch (e) {
        report(e, 'narrator.stop', { level: 'warning', extra: { stop: c.name } })
        say('Narrator', 'agent', 'failed', `${c.name}: ${(e as Error).message}`)
      }
    }

    /* The Auditor: every sentence traced to the text the Narrator was given. A
       model told to use only the text still adds a plausible detail now and then,
       so a draft with sentences that cannot be traced is sent back once, told
       exactly which; whatever still cannot be traced is taken out before it is
       voiced. What reaches the listener is what the sources support. */
    const docs = [
      ...(a ? [{ text: a.extract, source: wikiSource(a) }] : []),
      ...targets.map(t => ({ text: t.summary, source: t.source })),
    ]
    const names = [c.name, ...targets.map(t => t.name)]
    const audit = (list: Draft[]) => list.map(d => ({ ...d, claims: auditText(d.text, docs, names) }))
    drafts = audit(drafts)
    const first = tally(drafts)
    const weak = unsupportedIn(drafts)
    if (weak.length) {
      say('Auditor', 'tool', 'failed', `${c.name}: ${weak.length} statement${weak.length === 1 ? '' : 's'} not in the source — sent back to the narrator`)
      onEvent(verdict('Auditor', c.id, weak.map((text, i) => ({ id: `${c.id}-${i}`, text: `${c.name}: ${text}`, owner: 'Narrator' }))))
      try { drafts = audit((await narrate({ name: c.name, extract: a?.extract ?? '' }, targets, mode, ctx, weak)).beats) } catch { /* keep the first draft; it is repaired below */ }
    }
    drafts = drafts.flatMap(d => repair(d) ?? [])
    const traced = tally(drafts)
    if (first.total) {
      const leftover = unsupportedIn(drafts)
      onEvent(verdict('Auditor', c.id, leftover.map((text, i) => ({ id: `${c.id}-${i}`, text: `${c.name}: ${text}`, owner: 'Narrator' }))))
      say('Auditor', 'tool', leftover.length ? 'failed' : 'done',
        `${c.name}: ${first.traced} of ${first.total} statements traced at first` +
        (weak.length ? `, ${traced.traced} of ${traced.total} after the rewrite` : ''))
    }

    const beats = speakNow
      ? await Promise.all(drafts.map((d, i) => voiceQueue(async () => {
        try {
          const { bytes, durationSec } = await speak(d.text)
          return withAudio(d, await saveAudio(planId, `${c.id}-${i}.mp3`, bytes), durationSec)
        } catch (e) {
          if (!voiceFailed) { voiceFailed = true; say('Voice', 'agent', 'failed', String((e as Error).message)) }
          return withAudio(d, null, +estimateSec(d.text).toFixed(2))
        }
      })))
      : drafts.map(d => withAudio(d, null, +estimateSec(d.text).toFixed(2)))

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

  /* The seams. Written last, because a bridge is about the two pages it joins,
     and voiced like any other beat so the flight plays it without knowing it
     is different. A leg whose line could not be written simply stays quiet. */
  let spanned: Leg[] = legs
  if (legs.length) {
    say('Narrator', 'agent', 'working', `Writing ${legs.length} transition${legs.length === 1 ? '' : 's'}`)
    const lines = await writeBridges(origin.name, legs.map((l, i) => ({
      from: stops[i]?.name ?? '', to: stops[i + 1]?.name ?? '',
      transport: TRANSPORT_LABEL[l.transport].toLowerCase(),
      minutes: Math.round(l.durationSec / 60),
      km: +(l.distanceM / 1000).toFixed(1),
      fromAbout: stops[i]?.blurb, about: stops[i + 1]?.blurb,
    }))).catch(() => legs.map(() => ''))
    spanned = await Promise.all(legs.map(async (l, i): Promise<Leg> => {
      const text = (lines[i] ?? '').trim()
      if (!text) return l
      const quiet = (): Leg => ({ ...l, bridge: withAudio({ text }, null, +estimateSec(text).toFixed(2)) })
      if (!speakNow) return quiet()
      return voiceQueue(async () => {
        try {
          const { bytes, durationSec } = await speak(text)
          return { ...l, bridge: withAudio({ text }, await saveAudio(planId, `leg-${i}.mp3`, bytes), durationSec) }
        } catch (e) {
          if (!voiceFailed) { voiceFailed = true; say('Voice', 'agent', 'failed', String((e as Error).message)) }
          return quiet()
        }
      })
    }))
    const written = spanned.filter(l => l.bridge).length
    say('Narrator', 'agent', written ? 'done' : 'failed',
      written ? `${written} of ${legs.length} legs have something said on the way` : 'The legs are flown in silence')
  }

  const preface = await prefaceP
  say('Narrator', 'agent', preface ? 'done' : 'failed', preface ? 'The opening note is written' : 'No opening note — the counted line stands alone')

  const plan: Plan = {
    id: planId, city: origin.name, origin: { lat: origin.lat, lon: origin.lon }, mode, stops, legs: spanned,
    wish, from, approach, back,
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
  const { mode = 'full', signal } = opts
  const onEvent = observeCrew(opts.onEvent ?? (() => {}))
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

  const taken = new Set<number>()
  const fixed: Candidate[] = []
  for (const w of found) fixed.push(await matchWant(w, taken, wish))

  const extra = await findStops({
    city: origin.name, origin, radiusM: tripRadius(1), wish, mode, fixed, count: roomFor(mode, fixed.length), onEvent,
    legSecs: all => travelSecs(all, wish),
  })

  const all = [...fixed, ...extra]
  if (!all.length) throw new Error('Nothing to plan: no places were found or chosen.')
  void warmStopSources(all)

  say('Router', 'tool', 'working', `Measuring real ${wish.transport} times`)
  const points = [...(from ? [from] : []), ...all]
  const routed = await bestOrder(points, wish.transport, wish.budget, !!from)
  const seq = routed.order.filter(i => !(from && i === 0)).map(i => from ? i - 1 : i)
  const stops = seq.map(i => all[i])
  const chain = [...(from ? [{ id: 'from', lat: from.lat, lon: from.lon }] : []), ...stops]
  const allLegs = await legsFor(chain, wish.transport, wish.budget)
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
  /* The browser's sentence segmenter knows "St. Mary" and "553.3 m (1,815 ft)"
     are not sentence ends; the regex it replaces did not, and printed pages
     that ended at "Basilica of St." */
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter
  if (Seg) { for (const { segment } of new Seg('en', { granularity: 'sentence' }).segment(clean)) return segment.trim() || clean }
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
