import type { Leg, Plan, Stop, Target, Transport, Waypoint, Wish } from '../types'
import { HHMM, MINS } from '../types'
import type { Agent, CrewEvent } from './events'
import { geocode, locate } from './geocode'
import { notable, photoFor, wikiSource, type Article } from './wikipedia'
import { scout, type Kind, type Pick } from './scout'
import { bestOrder, legsFor } from './router'
import { arrivals, audit, visitMinutes, windowOf } from './timekeeper'
import { critic } from './critic'
import { narrate, withAudio, type Mode } from './narrator'
import { estimateSec, speak } from './tts'
import { metresBetween, slug } from './geo'

/* The whole planning run, in the order the book fills in. The same function
   serves the live app and scripts/make-fixture.ts, so a cached plan and a live
   one cannot drift apart.

   The desk decides more than the search box used to:
     wants      places the person named. Geocoded, never dropped, never
                overruled by the Critic — they are the reason for the day.
     interests  steer the Scout's remaining choices.
     pace       multiplies the Timekeeper's per-kind visit lengths.
     hours      are the window the day has to fit inside.
     transport  is the travel mode the Router prices and draws with.
     from       is where the day begins; it is not a stop, so it gets its own
                leg (the approach) and pushes every arrival later. */

export type PipelineOptions = {
  mode?: Mode
  onEvent?: (e: CrewEvent) => void
  /** Where a beat's mp3 goes; returns the URL the browser will play it from.
      Browser: a blob URL. Fixture script: a file under public/plans/<id>/. */
  saveAudio: (planId: string, name: string, bytes: ArrayBuffer) => Promise<string>
  signal?: AbortSignal
}

const RADIUS_M = 2500        // compact area around the search point
const TARGET_RADIUS_M = 300  // what a guide can point at from a stop
const WANT_MATCH_M = 260     // how near an article must sit to be *this* place
const PLAN_VERSION = 2
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

/* A named place has to be timed too, and the Scout never saw it. The name is
   the only evidence there is, so the guess is made from the name and nothing
   else — the same rule the book's marginal sketches follow. */
const KIND_RULES: [RegExp, Kind][] = [
  [/cathedral|church|basilica|chapel|abbey|minster|synagogue|mosque|temple|monastery/i, 'church'],
  [/museum|gallery|collection|pinacoteca|kunsthalle/i, 'museum'],
  [/market|bazaar|arcade|halles|mercado/i, 'market'],
  [/park|garden|common|arboretum|botanic|meadow/i, 'park'],
  [/bridge|viaduct|aqueduct/i, 'bridge'],
  [/tower|viewpoint|lookout|belvedere|hill|peak|summit/i, 'viewpoint'],
  [/square|plaza|piazza|place |platz/i, 'plaza'],
  [/street|avenue|boulevard|promenade|quay|lane/i, 'street'],
  [/monument|memorial|statue|column|obelisk|arch/i, 'monument'],
]
const guessKind = (name: string): Kind => KIND_RULES.find(([r]) => r.test(name))?.[1] ?? 'other'

type Chosen = {
  id: string
  name: string
  lat: number
  lon: number
  kind: Kind
  why: string
  asked: boolean
  article: Article | null
}

const fromPick = (p: Pick): Chosen => ({
  id: slug(p.article.title), name: p.article.title, lat: p.article.lat, lon: p.article.lon,
  kind: p.kind, why: p.why, asked: false, article: p.article,
})

export async function planTour(wish: Wish, opts: PipelineOptions): Promise<Plan> {
  const { mode = 'full', onEvent = () => {}, saveAudio, signal } = opts
  const say = (agent: Agent, kind: 'tool' | 'agent', state: 'working' | 'done' | 'reworking' | 'failed', detail: string) =>
    onEvent({ type: 'crew', agent, kind, state, detail })

  const transport: Transport = wish.transport ?? 'walk'
  const window = windowOf(wish)
  const room = mode === 'short' ? 3 : 5

  /* ---- 1. names to points ------------------------------------------------ */

  say('Geocode', 'tool', 'working', `Looking up ${wish.city}`)
  const origin = await geocode(wish.city, signal)
  const planId = `${slug(origin.name)}-${mode}-v${PLAN_VERSION}`

  const wants = wish.wants.map(w => w.trim()).filter(Boolean)
  const found: Waypoint[] = []
  const missing: string[] = []
  for (const w of wants) {
    const hit = await locate(w, origin, signal)
    if (hit) found.push(hit); else missing.push(w)
  }
  const from = wish.from.trim() ? await locate(wish.from.trim(), origin, signal) : null
  say('Geocode', 'tool', missing.length ? 'failed' : 'done',
    missing.length
      ? `Could not find ${missing.join(', ')} near ${origin.name}`
      : `${origin.name}${found.length ? `, and ${found.length} place${found.length === 1 ? '' : 's'} you named` : ''}`)

  /* ---- 2. what the person named, matched to what Wikipedia knows --------- */

  say('Scout', 'agent', 'working', `Reading about places near ${origin.name}`)
  const catalogue = (await notable(origin, RADIUS_M, 40)).filter(a => a.extract.length > 80)

  const taken = new Set<number>()
  const asked: Chosen[] = await Promise.all(found.map(async (w): Promise<Chosen> => {
    // The article for a named place, if there is one standing on the same spot.
    let article = catalogue.find(a => !taken.has(a.pageId) && metresBetween(a, w) < WANT_MATCH_M) ?? null
    if (!article) {
      const near = await notable(w, WANT_MATCH_M, 1, 20).catch(() => [])
      article = near[0] ?? null
    }
    if (article) taken.add(article.pageId)
    return {
      id: slug(w.name), name: article?.title ?? w.name, lat: w.lat, lon: w.lon,
      kind: guessKind(article?.title ?? w.name), why: 'you asked for it by name',
      asked: true, article,
    }
  }))

  const pool = catalogue.filter(a => !taken.has(a.pageId))
  const toFind = Math.max(0, room - asked.length)
  if (!asked.length && pool.length < 2) {
    throw new Error(`Wikipedia knows too little about the area around ${origin.name} to plan a day.`)
  }

  /* ---- 3. Scout -> Router -> Timekeeper -> Critic, one rework at most ----- */

  let chosen: Chosen[] = []
  let legs: Leg[] = []
  let approach: Leg | null = null
  let complaints: string[] = []
  let picks: Pick[] = []

  for (let attempt = 0; attempt < 2; attempt++) {
    const last = attempt === 1
    if (toFind && pool.length) {
      say('Scout', 'agent', attempt ? 'reworking' : 'working',
        attempt ? 'Choosing again to fix: ' + complaints.join('; ')
                : `Choosing ${toFind} more from the ${pool.length} most-read places nearby`)
      picks = await scout(pool, {
        count: toFind, interests: wish.interests, fixed: asked.map(a => a.name),
        complaints, previous: picks.map(p => p.article.title),
      })
      say('Scout', 'agent', 'done', picks.map(p => p.article.title).join(' · '))
    } else if (!attempt) {
      say('Scout', 'agent', 'done', 'The day is the places you named.')
    }

    const all = [...asked, ...picks.map(fromPick)]
    if (!all.length) throw new Error('Nothing to plan: no places were found or chosen.')

    say('Router', 'tool', 'working', `Measuring real ${transport === 'walk' ? 'walking' : transport} times`)
    const points = [...(from ? [from] : []), ...all]
    const routed = await bestOrder(points, transport, !!from)
    // The starting point is pinned at the head and is not a stop.
    const seq = routed.order.filter(i => !(from && i === 0)).map(i => from ? i - 1 : i)
    chosen = seq.map(i => all[i])

    const chain = [...(from ? [{ id: 'from', lat: from.lat, lon: from.lon }] : []), ...chosen]
    const allLegs = await legsFor(chain, transport)
    approach = from ? allLegs[0] ?? null : null
    legs = from ? allLegs.slice(1) : allLegs
    const km = (legs.reduce((s, l) => s + l.distanceM, 0) + (approach?.distanceM ?? 0)) / 1000
    say('Router', 'tool', legs.some(l => l.estimated) ? 'failed' : 'done',
      legs.some(l => l.estimated)
        ? `${km.toFixed(1)} km, but some legs are straight-line estimates — the router did not answer`
        : `${km.toFixed(1)} km of real ground`)

    const visits = chosen.map(c => visitMinutes(c.kind, wish.pace))
    const t = audit(visits, legs.map(l => l.durationSec), window, transport)
    say('Timekeeper', 'tool', t.complaints.length ? 'failed' : 'done',
      t.complaints.join('; ') || `${Math.round(t.totalMin)} min in all, ${Math.round(t.walkMin)} of them travelling, inside ${wish.startAt}–${wish.endAt}`)
    complaints = t.complaints

    if (!complaints.length && picks.length) {
      say('Critic', 'agent', 'working', 'Reviewing the day')
      const review = await critic(summarise(chosen, legs, wish, window))
      // A place the person named is not the Critic's to reject.
      const fair = review.complaints.filter(c => !chosen.some(s => s.asked && c.toLowerCase().includes(s.name.toLowerCase())))
      say('Critic', 'agent', fair.length ? 'failed' : 'done', fair.join('; ') || 'Approved')
      complaints = fair
    }
    if (!complaints.length || last || !toFind || !pool.length) break
  }

  /* ---- 4. the clock ------------------------------------------------------ */

  const visits = chosen.map(c => visitMinutes(c.kind, wish.pace))
  const clock = arrivals(visits, legs.map(l => l.durationSec), window, approach?.durationSec ?? 0)

  /* ---- 5. per stop, in parallel: targets -> narration -> voice, and photo - */

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

    let drafts: { text: string; targetId?: string }[] = []
    if (a || targets.length) {
      try {
        drafts = (await narrate({ name: c.name, extract: a?.extract ?? '' }, targets, mode)).beats
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

    const stop: Stop = {
      id: c.id, name: c.name, lat: c.lat, lon: c.lon,
      blurb: a ? firstSentence(a.extract) : c.why,
      photo, sources: a ? [wikiSource(a)] : [], targets, beats,
      visitMin: visits[index], arrival: clock[index], fits: fitFor(c, wish), asked: c.asked,
    }
    onEvent({ type: 'stop', index, stop })
    return stop
  }))
  say('Narrator', 'agent', 'done', `${stops.length} pages written`)

  const plan: Plan = {
    id: planId, city: origin.name, origin: { lat: origin.lat, lon: origin.lon }, mode, stops, legs,
    wish, from: from ? { asked: from.asked, name: from.name, lat: from.lat, lon: from.lon, ...(from.alternatives ? { alternatives: from.alternatives } : {}) } : null,
    approach, epigraph: epigraphFor(stops, legs, approach, window),
    generatedAt: new Date().toISOString(),
    provenance: {
      router: 'code', timekeeper: 'code',
      scout: picks.length ? 'llm' : 'you named every stop',
      critic: picks.length ? 'llm + code checks' : 'code checks',
      narrator: 'llm', tts: 'elevenlabs:mp3_44100_128',
    },
  }
  onEvent({ type: 'plan', plan })
  return plan
}

/* ------------------------------------------------------------------ helpers */

const toTarget = (a: Article): Target => ({
  id: `w${a.pageId}`, name: a.title, lat: a.lat, lon: a.lon, summary: a.extract, source: wikiSource(a),
})

const firstSentence = (s: string) => {
  const clean = s.replace(/\s+/g, ' ').trim()
  const cut = clean.split(/(?<=[.!?])\s+(?=[A-Z"“(])/)[0]
  return cut || clean
}

/** The one line the page prints under "here because". A named place says so;
    anything else quotes the Scout, and the interests only get the credit when
    the person actually gave some. */
function fitFor(c: Chosen, wish: Wish) {
  if (c.asked) return 'you asked for it by name'
  return c.why || (wish.interests.length ? wish.interests[0].toLowerCase() : 'the shape of the day')
}

function summarise(chosen: Chosen[], legs: Leg[], wish: Wish, w: { startMin: number; endMin: number }) {
  const lines = chosen.map((c, i) =>
    `${i + 1}. ${c.id} | ${c.name} | kind: ${c.kind} | ${visitMinutes(c.kind, wish.pace)} min there | ${c.asked ? 'ASKED FOR BY NAME — not yours to reject' : c.why}` +
    (legs[i] ? `\n   then ${Math.round(legs[i].durationSec / 60)} min ${wish.transport} (${Math.round(legs[i].distanceM)} m)` : ''))
  return `Day window: ${HHMM(w.startMin)} to ${HHMM(w.endMin)}, ${wish.transport}.` +
    (wish.interests.length ? `\nThe person asked for: ${wish.interests.join(', ')}.` : '') +
    `\n${lines.join('\n')}`
}

/** One line under the title, counted rather than written: every number in it
    is a field of this plan. */
function epigraphFor(stops: Stop[], legs: Leg[], approach: Leg | null, w: { startMin: number; endMin: number }) {
  if (!stops.length) return ''
  const km = (legs.reduce((s, l) => s + l.distanceM, 0) + (approach?.distanceM ?? 0)) / 1000
  const last = stops[stops.length - 1]
  const ends = HHMM(MINS(last.arrival) + last.visitMin)
  return `${stops.length} places, ${km.toFixed(1)} km, ${HHMM(w.startMin)} to ${ends}.`
}
