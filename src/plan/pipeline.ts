import { report, observeCrew } from '../telemetry'
import type { Beat, Direction, Leg, Plan, Stop, Target, Wish } from '../types'
import { HHMM, MINS, TRANSPORT_LABEL } from '../types'
import type { Agent, CrewEvent } from './events'
import { geocode, locate } from './geocode'
import { notable, photoFor, warmStopSources, wikiSource, type Article } from './wikipedia'
import { bestOrder, legsFor, travelSecs } from './router'
import { schedule, windowOf } from './timekeeper'
import { narrate, withAudio, writeBridges, writeClosing, writeOpening, writePreface, type Draft, type Mode, type StopContext } from './narrator'
import { estimateSec, speak } from './tts'
import { findStops, matchWant, roomFor, tripRadius, type Candidate, type Skeleton } from './crew'
import { slug } from './geo'
import { sentences, withoutNameAsides } from './sentences'

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
const MAX_TTS_CONCURRENT = 4      // the voice account allows only a few at once; the proxy waits out the rest, but asking for fewer means less waiting

export type PipelineOptions = {
  onEvent?: (e: CrewEvent) => void
  /** Stops already written on an earlier pass, by id. A revision that moves
      one place must not re-narrate and re-voice the four that did not move. */
  written?: Map<string, Stop>
  /** Where a beat's mp3 goes; returns the URL the browser will play it from.
      Browser: a blob URL. Fixture script: a file under public/plans/<id>/. */
  saveAudio: (planId: string, name: string, bytes: ArrayBuffer) => Promise<string>
  /** Speak now, as the pages are written. The app does: a plan has its voice before anyone flies it, so a flight
      (and a headset, which is sent the saved trip) starts at once with the real narration. It costs the speech of
      days that may never be flown; a revision speaks only what it rewrote (`written`). Whatever this misses, because
      a clip failed or the trip is older than this, is spoken when its day first flies (tts.voiceDay). */
  voice?: boolean
  /** How the Director gets to look at the city (the app gives fly/directing's `direct`). It resolves with where each
      shot of the day should be taken from: everything, or what had been chosen when `until` settled, or null if the
      city could not be looked at. Without it (the fixture script has no city to look at) nothing is directed here. */
  direct?: (plan: Plan, opts: { until: Promise<unknown>; note?: (subject: string, nth: number, total: number) => void }) => Promise<Direction | null>
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
  const { wish, mode, origin, from, stops: chosen, legs, approach, back = null, day } = skeleton
  const dayNumber = day?.number ?? 1, dayCount = day?.count ?? 1
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
  /* What was given up, said out loud. A day quietly squeezed is a day that
     lies about how long you get at the places in it. */
  if (clock.trimmedMin) {
    say('Timekeeper', 'tool', clock.overruns ? 'failed' : 'done',
      `${clock.trimmedMin} min trimmed from the stops to end by ${wish.endAt}` +
      (clock.overruns ? `, and it still runs to ${clock.endsAt} — there are too many places in this day` : ''))
  } else if (clock.overruns) {
    say('Timekeeper', 'tool', 'failed', `The day runs to ${clock.endsAt}, past the ${wish.endAt} you asked for`)
  }

  say('Narrator', 'agent', 'working', `Writing ${chosen.length} pages`)
  if (opts.voice === true) say('Voice', 'agent', 'working', 'Recording each line as it is written')
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
      .filter(n => n.pageId !== a?.pageId && n.extract.length > 60 && !isEvent(n.title))
      .slice(0, 6).map(toTarget)
    return { c, index, before: null as Stop | null, targets, photo }
  }))

  // The whole loop: out from the bed, between the places, and back. The journal always counted it this way; the trip's
  // header, the day's own line and what the guide says at the end did not count the way back, and the numbers disagreed.
  const totalKm = (legs.reduce((s, l) => s + l.distanceM, 0) + (approach?.distanceM ?? 0) + (back?.distanceM ?? 0)) / 1000
  say('Narrator', 'agent', 'working', 'Writing the opening note')
  const prefaceP = writePreface({
    city: origin.name, startAt: wish.startAt, endsAt: clock.endsAt, windowEnd: wish.endAt,
    party: wish.party, pace: wish.pace, budget: wish.budget,
    transport: [...new Set([...(approach ? [approach] : []), ...legs, ...(back ? [back] : [])].map(l => l.transport))].join(' and ') || wish.transport,
    interests: wish.interests, from: from?.name, approachMin: approach ? approach.durationSec / 60 : undefined,
    meals: clock.breaks.map(b => ({ label: b.label, minutes: b.minutes, after: chosen[b.after]?.name ?? '' })),
    totalKm,
    stops: pages.map(({ c, index, before, targets }) => ({
      name: c.name, arrival: clock.arrivals[index], stayMin: clock.stays[index], why: before?.fits ?? c.why,
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
      const stop: Stop = { ...before, visitMin: clock.stays[index], arrival: clock.arrivals[index], ...(brk ? { breakMin: brk.minutes } : { breakMin: undefined }) }
      onEvent({ type: 'stop', index, stop })
      return stop
    }
    const a = c.article
    const ctx: StopContext = {
      city: origin.name, index, total: chosen.length,
      arrival: clock.arrivals[index], visitMin: clock.stays[index],
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
      visitMin: clock.stays[index], arrival: clock.arrivals[index], fits: c.why, asked: c.asked,
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
      km: +(l.distanceM / 1000).toFixed(1), how: l.how,
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

  /* The two ends. Both are said over a held camera, so both are kept short: the opening used to carry the forecast and
     what to wear, and it was the longest wait of the day. The journal has the weather, for anyone who wants it. */
  const transportWords = [...new Set([...(approach ? [approach] : []), ...legs, ...(back ? [back] : [])]
    .map(l => TRANSPORT_LABEL[l.transport].toLowerCase()))].join(' and ') || TRANSPORT_LABEL[wish.transport === 'auto' ? 'walk' : wish.transport].toLowerCase()

  say('Narrator', 'agent', 'working', 'Writing the welcome and the goodbye')
  const [openingText, closingText] = await Promise.all([
    writeOpening({
      city: origin.name, number: dayNumber, count: dayCount, title: day?.title,
      stops: stops.map(st => st.name), startAt: HHMM(window.startMin), endsAt: clock.endsAt,
      transport: transportWords, party: wish.party, interests: wish.interests, from: from?.name,
    }).catch(() => ''),
    writeClosing({
      city: origin.name, number: dayNumber, count: dayCount, title: day?.title,
      last: stops[stops.length - 1]?.name ?? '', stopCount: stops.length,
      km: totalKm, endsAt: clock.endsAt, nextTitle: day?.nextTitle, back: back ? from?.name : undefined,
    }).catch(() => ''),
  ])
  const voiceEnd = async (text: string, name: string): Promise<Beat | undefined> => {
    if (!text) return undefined
    if (!speakNow) return withAudio({ text }, null, +estimateSec(text).toFixed(2))
    return voiceQueue(async () => {
      try {
        const { bytes, durationSec } = await speak(text)
        return withAudio({ text }, await saveAudio(planId, name, bytes), durationSec)
      } catch {
        return withAudio({ text }, null, +estimateSec(text).toFixed(2))
      }
    })
  }
  const [opening, closing] = await Promise.all([voiceEnd(openingText, 'opening.mp3'), voiceEnd(closingText, 'closing.mp3')])
  say('Narrator', 'agent', opening || closing ? 'done' : 'failed',
    opening && closing ? `The day has its welcome, and closes ${dayCount > 1 ? `as day ${dayNumber} of ${dayCount}` : 'on its own'}`
      : 'One of the two ends could not be written')

  /* The Voice records each line as it is written, and said so only when a line failed: on the stage it stood idle
     through the whole of its own work. It says what it is doing, and how it went. */
  if (speakNow) {
    const lines = [...stops.flatMap(st => st.beats), ...spanned.flatMap(l => l.bridge ? [l.bridge] : []), ...(opening ? [opening] : []), ...(closing ? [closing] : [])]
    const recorded = lines.filter(b => b.audioUrl).length
    say('Voice', 'agent', recorded === lines.length ? 'done' : 'failed', recorded === lines.length
      ? `${recorded} lines recorded`
      : `${recorded} of ${lines.length} lines recorded; the rest are spoken when the day is flown`)
  }

  const preface = await prefaceP
  say('Narrator', 'agent', preface ? 'done' : 'failed', preface ? 'The opening note is written' : 'No opening note — the counted line stands alone')

  const plan: Plan = {
    id: planId, city: origin.name, origin: { lat: origin.lat, lon: origin.lon }, mode, stops, legs: spanned,
    wish, from, approach, back,
    ...(opening ? { opening } : {}), ...(closing ? { closing } : {}),
    epigraph: epigraphFor(stops, totalKm, window, clock.endsAt), preface,
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

/* Wikipedia pins events to the ground they happened on, so "Siege of Lisbon" and "1755 Lisbon earthquake" turn up as
   things standing near a castle. A guide can point the camera at a building; it cannot point it at a siege, and the
   Director was being sent to walk round one. Judged from the title, which is the only evidence there is. */
const EVENT = /^(?:\d{3,4}\s|(?:First|Second|Third)\s)?(?:Siege|Battle|Treaty|Massacre|Assassination|Bombing|Sack|Fall|Capture|Conquest|Coronation|Trial|Execution|Riots?|Uprising|Revolt|Raid|Occupation|Liberation|Great Fire)\s(?:of|at|on)\b|^\d{3,4}\s|\b(?:earthquake|massacre|riots?|bombings?|shooting|attacks?|uprising|revolt|revolution|election|protests?|disaster|crash|derailment|explosion|stampede)$/i
const isEvent = (title: string) => EVENT.test(title.replace(/\s*\(.*\)$/, '').trim())

const toTarget = (a: Article): Target => ({
  id: `w${a.pageId}`, name: a.title, lat: a.lat, lon: a.lon, summary: a.extract, source: wikiSource(a),
})

/* Split by plan/sentences, which knows "St. Mary" and "U.S. Route 9" are not sentence ends; printed pages used to
   end at "the Basilica of St." */
const firstSentence = (s: string) => sentences(withoutNameAsides(s))[0] ?? s.replace(/\s+/g, ' ').trim()

/** One line under the title, counted rather than written: every number in it
    is a field of this plan. */
function epigraphFor(stops: Stop[], km: number, w: { startMin: number }, endsAt: string) {
  if (!stops.length) return ''
  return `${stops.length} places, ${km.toFixed(1)} km, ${HHMM(w.startMin)} to ${endsAt}.`
}

export { MINS }
