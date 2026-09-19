import type { Plan, Stop, Target } from '../types'
import type { CrewEvent } from './events'
import { geocode } from './geocode'
import { notable, photoFor, wikiSource, type Article } from './wikipedia'
import { scout, type Pick } from './scout'
import { bestOrder, walkingLegs } from './router'
import { audit, visitMinutes, DEFAULT_WINDOW } from './timekeeper'
import { critic } from './critic'
import { narrate, withAudio, type Mode } from './narrator'
import { estimateSec, speak } from './tts'
import { slug } from './geo'

/* The whole planning run, in the order the book fills in. The same function
   serves the live app and scripts/make-fixture.ts, so a cached plan and a
   live one cannot drift apart. */

export type PipelineOptions = {
  mode?: Mode
  onEvent?: (e: CrewEvent) => void
  /** Where a beat's mp3 goes; returns the URL the browser will play it from.
      Browser: a blob URL. Fixture script: a file under public/plans/<id>/. */
  saveAudio: (planId: string, name: string, bytes: ArrayBuffer) => Promise<string>
  signal?: AbortSignal
}

const RADIUS_M = 2500        // compact walking area around the search point
const TARGET_RADIUS_M = 300  // what a guide can point at from a stop
const PLAN_VERSION = 1
const MAX_TTS_CONCURRENT = 3

function limiter(max: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>(r => waiting.push(r))
    active++
    try { return await fn() } finally { active--; waiting.shift()?.() }
  }
}

export async function planTour(query: string, opts: PipelineOptions): Promise<Plan> {
  const { mode = 'full', onEvent = () => {}, saveAudio } = opts
  const say = (agent: Extract<CrewEvent, { type: 'crew' }>['agent'], kind: 'tool' | 'agent', state: 'working' | 'done' | 'reworking' | 'failed', detail: string) =>
    onEvent({ type: 'crew', agent, kind, state, detail })
  const count = mode === 'short' ? 3 : 5

  const origin = await geocode(query, opts.signal)
  const planId = `${slug(origin.name)}-${mode}-v${PLAN_VERSION}`

  say('Scout', 'agent', 'working', `Reading about places near ${origin.name}`)
  const catalogue = (await notable(origin, RADIUS_M, 40)).filter(a => a.extract.length > 80)
  if (catalogue.length < count) throw new Error(`Wikipedia knows too little about the area around ${origin.name} to plan a tour.`)

  // Scout → Router → Timekeeper → Critic, with one round of rework at most,
  // so planning stays quick. The second attempt is accepted as it stands.
  let picks: Pick[] = [], order: number[] = [], legs: Plan['legs'] = []
  let complaints: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const last = attempt === 1
    say('Scout', 'agent', attempt ? 'reworking' : 'working', attempt ? 'Choosing again to fix: ' + complaints.join('; ') : `Choosing ${count} stops from the ${catalogue.length} most-read places nearby`)
    const previous = picks.map(p => p.article.title)
    picks = await scout(catalogue, count, complaints, previous)
    say('Scout', 'agent', 'done', picks.map(p => p.article.title).join(' · '))

    say('Router', 'tool', 'working', 'Measuring real walking distances')
    const routed = await bestOrder(picks.map(p => p.article))
    order = routed.order
    picks = order.map(i => picks[i])
    const ids = picks.map(p => slug(p.article.title))
    legs = await walkingLegs(picks.map((p, i) => ({ id: ids[i], lat: p.article.lat, lon: p.article.lon })))
    say('Router', 'tool', 'done', `${(legs.reduce((s, l) => s + l.distanceM, 0) / 1000).toFixed(1)} km on foot`)

    const t = audit(picks.map(p => visitMinutes(p.kind)), legs.map(l => l.durationSec))
    say('Timekeeper', 'tool', t.complaints.length ? 'failed' : 'done', t.complaints.join('; ') || `${Math.round(t.totalMin)} min in total, ${Math.round(t.walkMin)} of them walking`)
    complaints = t.complaints

    if (!complaints.length) {
      say('Critic', 'agent', 'working', 'Reviewing the plan')
      const review = await critic(summarise(picks, ids, legs))
      say('Critic', 'agent', review.ok ? 'done' : 'failed', review.ok ? 'Approved' : review.complaints.join('; '))
      complaints = review.complaints
    }
    if (!complaints.length || last) break
  }

  // Per stop, in parallel: nearby targets → narration → voice, plus the photo.
  const voice = limiter(MAX_TTS_CONCURRENT)
  say('Narrator', 'agent', 'working', `Writing ${picks.length} pages`)
  let voiceFailed = false
  const stops: Stop[] = await Promise.all(picks.map(async (pick, index): Promise<Stop> => {
    const a = pick.article
    const id = slug(a.title)
    const [near, photo] = await Promise.all([notable(a, TARGET_RADIUS_M, 10, 60), photoFor(a).catch(() => null)])
    const targets: Target[] = near
      .filter(n => n.pageId !== a.pageId && n.extract.length > 60)
      .slice(0, 6).map(toTarget)
    const { beats: drafts } = await narrate({ name: a.title, extract: a.extract }, targets, mode)

    const beats = await Promise.all(drafts.map((d, i) => voice(async () => {
      try {
        const { bytes, durationSec } = await speak(d.text)
        return withAudio(d, await saveAudio(planId, `${id}-${i}.mp3`, bytes), durationSec)
      } catch (e) {
        if (!voiceFailed) { voiceFailed = true; say('Voice', 'agent', 'failed', String((e as Error).message)) }
        return withAudio(d, null, +estimateSec(d.text).toFixed(2))
      }
    })))

    const stop: Stop = {
      id, name: a.title, lat: a.lat, lon: a.lon, blurb: pick.why, photo,
      sources: [wikiSource(a)], targets, beats, visitMin: visitMinutes(pick.kind),
    }
    onEvent({ type: 'stop', index, stop })
    return stop
  }))
  say('Narrator', 'agent', 'done', `${stops.length} pages written`)

  return {
    id: planId, city: origin.name, origin: { lat: origin.lat, lon: origin.lon }, mode, stops, legs,
    generatedAt: new Date().toISOString(),
    provenance: { router: 'code', timekeeper: 'code', scout: 'llm', critic: 'llm + code checks', narrator: 'llm', tts: `elevenlabs:mp3_44100_128` },
  }
}

const toTarget = (a: Article): Target => ({
  id: `w${a.pageId}`, name: a.title, lat: a.lat, lon: a.lon, summary: a.extract, source: wikiSource(a),
})

function summarise(picks: Pick[], ids: string[], legs: Plan['legs']) {
  const w = DEFAULT_WINDOW
  const lines = picks.map((p, i) =>
    `${i + 1}. ${ids[i]} | ${p.article.title} | kind: ${p.kind} | ${visitMinutes(p.kind)} min there | ${p.why}` +
    (legs[i] ? `\n   then ${Math.round(legs[i].durationSec / 60)} min walk (${Math.round(legs[i].distanceM)} m)` : ''))
  return `Day window: ${w.startMin / 60}:00 to ${w.endMin / 60}:00, on foot.\n${lines.join('\n')}`
}
