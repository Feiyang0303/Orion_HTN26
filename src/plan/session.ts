import { observeCrew, traced } from '../telemetry'
import type { Day, Stay, Stop, Trip, Waypoint, Wish } from '../types'
import { HHMM, MINS } from '../types'
import type { Agent, CrewEvent } from './events'
import { locate, type Place } from './geocode'
import { findStops, matchWant, tripRadius, type Candidate } from './crew'
import { chooseBeds, chooseTables, shapeDays } from './trip'
import { bestOrder, legsFor } from './router'
import { visitBudgetMin } from './timekeeper'
import { writePages, type PipelineOptions } from './pipeline'
import { askJson } from './json'
import type { Mode } from './narrator'
import { slug } from './geo'

/* The planning session: the crew, run a stage at a time, with a person
 * between the stages.
 *
 *   1. beds     three ranked places to sleep, with reasons; shuffle for more
 *   2. places   what the scout chose, laid out by day; reorder, drop, re-pick
 *   3. plan     each day routed from the bed, timed, written and fed
 *   4. revise   say what is wrong in plain words; the editor turns it into
 *               edits the code can apply, and only the days touched are redone
 *
 * The bed comes first because it is the one decision that changes every
 * other one: every day starts and ends there, so its position is what the
 * router prices against. Nothing in any stage is remembered by a model
 * between calls; the session object is the memory, and everything in it is a
 * real place with a real source.
 */

export type Session = {
  wish: Wish
  mode: Mode
  origin: Place
  /** Everything ever pinned or picked, by id, so a revision can find it. */
  known: Map<string, Candidate>
  /** Bed ids already shown, so a shuffle is a new batch. */
  offered: string[]
  bed: Stay | null
  /** Stops already written, so a revision does not re-narrate what did not move. */
  written: Map<string, Stop>
  onEvent: (e: CrewEvent) => void
  signal?: AbortSignal
}

const say = (s: Session, agent: Agent, kind: 'tool' | 'agent', state: 'working' | 'done' | 'failed', detail: string) =>
  s.onEvent({ type: 'crew', agent, kind, state, detail })

/** Stage 0: the city, which the kickoff has already resolved. Looking the name up
    again could land somewhere else ("Kyoto" the prefecture), so it is not. The
    scout names places from what it knows and each name is looked up when it is
    chosen, so nothing else has to be read first. */
function openSessionImpl(
  wish: Wish, mode: Mode, origin: Place, onEvent: (e: CrewEvent) => void, signal?: AbortSignal,
): Promise<Session> {
  const s: Session = { wish, mode, origin, known: new Map(), offered: [], bed: null, written: new Map(), onEvent: observeCrew(onEvent), signal }
  say(s, 'Geocode', 'tool', 'done', origin.name)
  return Promise.resolve(s)
}

/* ---------------------------------------------------------------- 1. stay */

/** Where to sleep, chosen once the places are known: the middle of the trip's own
    places is the centre that matters. Nothing here waits on the person; if
    OpenStreetMap is down the trip simply starts from the city and says so. */
async function stageStayImpl(s: Session, drafts: DayDraft[]): Promise<Stay[]> {
  // Each day in visiting order: the bed is priced against the mornings and
  // evenings it actually causes, not against the middle of a cloud of places.
  const days = drafts.map(d => d.stops.map(c => ({ name: c.name, lat: c.lat, lon: c.lon }))).filter(d => d.length)
  const all = days.flat()
  const centre = all.length
    ? { lat: all.reduce((a, c) => a + c.lat, 0) / all.length, lon: all.reduce((a, c) => a + c.lon, 0) / all.length }
    : { lat: s.origin.lat, lon: s.origin.lon }
  say(s, 'Scout', 'agent', 'working', s.offered.length ? 'Finding a different place to sleep' : 'Finding somewhere to sleep, close to the days')
  const { stays, down } = await chooseBeds({ days, centre }, s.wish, s.offered, s.signal)
  // Only the bed actually taken is written down as seen. The runners-up stay
  // available, so asking for another does not burn three hotels at a time.
  if (stays[0]) s.offered.push(stays[0].id)
  s.bed = stays[0] ?? null
  say(s, 'Scout', 'agent', stays.length ? 'done' : 'failed',
    stays.length ? `${stays[0].name}: ${stays[0].why}` : down ? 'OpenStreetMap did not answer, so the days start from the city centre' : 'OpenStreetMap lists nothing to sleep in near here, so the days start from the city centre')
  return stays
}

/* -------------------------------------------------------------- 2. places */

export type DayDraft = { title: string; why: string; stops: Candidate[] }

/** What the scout would do with the days: the places, already grouped. The
    count is sized to the hours, not fixed — a long day with a fast pace holds
    more than a short gentle one. */
async function stagePlacesImpl(s: Session): Promise<DayDraft[]> {
  const wish = s.wish
  const nDays = Math.max(1, Math.min(7, wish.days || 1))
  const budget = visitBudgetMin(wish)
  // Sized to the hours, with a little over: the day-shaper is told the budget
  // and will leave the surplus aside, and a scout asked for too few cannot be
  // asked for the rest without a second round of API calls.
  const perDay = Math.max(2, Math.min(7, Math.round(budget / 50) + 1))

  const taken = new Set<number>()
  const fixed: Candidate[] = []
  for (const w of wish.wants.map(x => x.trim()).filter(Boolean)) {
    const hit = await locate(w, s.origin, s.signal)
    if (hit) fixed.push(await matchWant(hit, taken, wish, s.onEvent))
  }
  const extra = await findStops({
    city: s.origin.name, origin: s.origin, radiusM: tripRadius(nDays), wish, mode: s.mode, fixed,
    count: Math.max(0, nDays * perDay - fixed.length), onEvent: s.onEvent,
  })
  const all = [...fixed, ...extra]
  for (const c of all) s.known.set(c.id, c)
  if (!all.length) throw new Error('Nothing to plan: no places were found or chosen.')

  say(s, 'Scout', 'agent', 'working', `Laying ${all.length} places out over ${nDays} day${nDays === 1 ? '' : 's'}`)
  const shapes = await shapeDays(all, nDays, wish, budget)
  const byId = new Map(all.map(c => [c.id, c]))
  const drafts: DayDraft[] = shapes.map(d => ({ title: d.title, why: d.why, stops: d.ids.map(id => byId.get(id)!).filter(Boolean) }))

  /* A day the shaper left thin is topped up, once, from what the scout did
     not choose the first time. Thin means well under the budget after travel
     is allowed for; a day that is merely not full is left alone. */
  const minutesOf = (d: DayDraft) => d.stops.reduce((n, c) => n + c.visitMin, 0)
  for (const d of drafts) {
    if (minutesOf(d) >= budget * 0.6) continue
    const want = Math.max(1, Math.min(3, Math.round((budget * 0.8 - minutesOf(d)) / 50)))
    say(s, 'Scout', 'agent', 'working', `${d.title} is light — looking for ${want} more`)
    const extra = await findStops({ city: s.origin.name, origin: s.origin, radiusM: tripRadius(nDays), wish, mode: s.mode, fixed: drafts.flatMap(x => x.stops), count: want, onEvent: () => {} }).catch(() => [])
    for (const c of extra) { s.known.set(c.id, c); d.stops.push(c) }
  }
  say(s, 'Scout', 'agent', 'done', drafts.map((d, i) => `${i + 1}. ${d.title} (${d.stops.length}, ${minutesOf(d)} min)`).join(' · '))
  return drafts
}

/** More places, for a day someone emptied or a list they did not like. */
async function morePlacesImpl(s: Session, avoid: Candidate[], count: number): Promise<Candidate[]> {
  const extra = await findStops({ city: s.origin.name, origin: s.origin, radiusM: tripRadius(s.wish.days || 1), wish: s.wish, mode: s.mode, fixed: avoid, count, onEvent: s.onEvent })
  for (const c of extra) s.known.set(c.id, c)
  return extra
}

/* ---------------------------------------------------------------- 3. plan */

const asWaypoint = (b: Stay): Waypoint => ({ asked: b.name, name: b.name, lat: b.lat, lon: b.lon })

/** One day, routed from the bed, timed, written and fed. */
async function buildDay(s: Session, draft: DayDraft, number: number, opts: PipelineOptions): Promise<Day> {
  const { wish } = s
  const from = s.bed ? asWaypoint(s.bed) : null
  if (!draft.stops.length) throw new Error(`Day ${number} has no places in it.`)

  say(s, 'Router', 'tool', 'working', `Day ${number}: measuring real travel times`)
  const points = [...(from ? [from] : []), ...draft.stops]
  const routed = await bestOrder(points, wish.transport, wish.budget, !!from)
  const seq = routed.order.filter(k => !(from && k === 0)).map(k => from ? k - 1 : k)
  const ordered = seq.map(k => draft.stops[k])
  const chain = [...(from ? [{ id: 'bed', lat: from.lat, lon: from.lon }] : []), ...ordered]
  const allLegs = await legsFor(chain, wish.transport, wish.budget)
  const approach = from ? allLegs[0] ?? null : null
  const legs = from ? allLegs.slice(1) : allLegs
  // And home again: a day is a loop from the bed, not a line that ends in the street.
  const lastStop = ordered[ordered.length - 1]
  const back = from && lastStop
    ? (await legsFor([{ id: lastStop.id, lat: lastStop.lat, lon: lastStop.lon }, { id: 'bed', lat: from.lat, lon: from.lon }], wish.transport, wish.budget))[0] ?? null
    : null
  say(s, 'Router', 'tool', 'done',
    `Day ${number}: ${(legs.reduce((a, l) => a + l.distanceM, 0) / 1000).toFixed(1)} km, ${[...new Set(legs.map(l => l.transport))].join(' and ')}`)

  const plan = await writePages({ wish, mode: s.mode, origin: s.origin, from, stops: ordered, legs, approach, back }, {
    ...opts, written: s.written, signal: s.signal,
    onEvent: e => s.onEvent(e.type === 'crew' ? { ...e, detail: `Day ${number}: ${e.detail}` } : e),
  })
  for (const st of plan.stops) s.written.set(st.id, st)

  say(s, 'Narrator', 'agent', 'working', `Day ${number}: finding somewhere to eat`)
  const tables = await chooseTables({
    number, title: draft.title,
    stops: plan.stops.map(st => ({ id: st.id, name: st.name, lat: st.lat, lon: st.lon, arrival: st.arrival, visitMin: st.visitMin })),
    bed: s.bed ? { id: s.bed.id, name: s.bed.name, lat: s.bed.lat, lon: s.bed.lon } : null,
  }, wish, s.signal)
  say(s, 'Narrator', 'agent', tables.length ? 'done' : 'failed',
    tables.length ? `Day ${number}: ${tables.map(t => `${t.meal} at ${t.name}`).join(', ')}` : `Day ${number}: OpenStreetMap had nothing named near those stops`)

  return { ...plan, id: `${plan.id}-d${number}`, number, title: draft.title, tables }
}

async function stagePlanImpl(s: Session, drafts: DayDraft[], opts: PipelineOptions): Promise<Trip> {
  const days: Day[] = []
  for (const d of drafts) {
    if (!d.stops.length) continue
    days.push(await buildDay(s, d, days.length + 1, opts))
    s.onEvent({ type: 'plan', plan: days[days.length - 1] })
  }
  if (!days.length) throw new Error('The trip came out empty.')
  const trip = assemble(s, days)
  s.onEvent({ type: 'trip', trip })
  return trip
}

function assemble(s: Session, days: Day[]): Trip {
  return {
    id: `${slug(s.origin.name)}-${days.length}d-v3`,
    city: s.origin.name, origin: { lat: s.origin.lat, lon: s.origin.lon },
    wish: s.wish, days, stays: s.bed ? [s.bed] : [],
    preface: days[0]?.preface ?? '',
    generatedAt: new Date().toISOString(),
    provenance: {
      places: 'Wikipedia geosearch, chosen by a model', lodging: 'OpenStreetMap, chosen by a model',
      food: 'OpenStreetMap, chosen by a model', router: 'Google Routes',
      narrator: 'llm', tts: 'elevenlabs:mp3_44100_128',
    },
  }
}

/* -------------------------------------------------------------- 4. revise */

/* The editor. It never rewrites the plan itself: it reads what the person
   said, and answers with edits from a fixed menu that the code then applies.
   A model that could "just change the plan" could also invent a place, move a
   hotel to a street that does not exist, or promise a restaurant is open. This
   one can only point at things that are already real. */

export type Edit =
  | { op: 'remove_stop'; id: string }
  | { op: 'move_stop'; id: string; day: number; position?: number }
  | { op: 'set_stay'; id: string; minutes: number }
  | { op: 'add_place'; query: string; day: number }
  | { op: 'set_hours'; startAt?: string; endAt?: string }
  | { op: 'set_transport'; transport: Wish['transport'] }
  | { op: 'set_meals'; meals: Wish['meals'] }
  | { op: 'new_bed' }
  | { op: 'none' }

export type Revision = { reply: string; edits: Edit[] }

const EDITOR_SYSTEM = `You are the editor of a trip that has already been planned. The person will tell
you, in plain words, what they want changed. You answer with edits from the
menu below and a short reply. You do not plan; you translate.

MENU
- remove_stop {id}                   take a place out of the trip
- move_stop {id, day, position}      put a place on another day, or elsewhere in its day (position is 1-based)
- set_stay {id, minutes}             change how long they stay somewhere (10–240)
- add_place {query, day}             a place they named that is not in the trip; the crew will look it up
- set_hours {startAt, endAt}         'HH:MM'
- set_transport {transport}          walk | cycle | transit | drive | auto
- set_meals {meals}                  any of lunch, dinner
- new_bed {}                         they want a different place to sleep
- none {}                            nothing to change — a question, or something you cannot do

RULES
- Use only ids from the plan you are shown. If they name a place that is not
  in the plan, use add_place with their words as the query; never invent an id.
- Several edits are fine. Order them as they should be applied.
- If what they want is not on the menu — a different city, a cheaper hotel
  you cannot see prices for, a "better" restaurant — say so in the reply and
  use none. Do not pretend.
- The reply is two sentences at most, plain, no exclamation marks. Say what
  you are doing, or why you cannot.

FORMAT — reply with a JSON object. Every edit is an object with an "op" field
and the fields listed for that op, exactly like this:
{"reply":"Gion comes out and Chishaku-in gets an hour.",
 "edits":[{"op":"remove_stop","id":"gion"},{"op":"set_stay","id":"chishaku-in","minutes":60}]}`

function describeTrip(trip: Trip) {
  return [
    `City: ${trip.city}. ${trip.days.length} day(s), ${trip.wish.startAt}–${trip.wish.endAt}, getting about: ${trip.wish.transport}, meals planned: ${trip.wish.meals.join(', ') || 'none'}.`,
    trip.stays[0] ? `Sleeping at ${trip.stays[0].name}.` : 'No bed chosen.',
    ...trip.days.map(d => [
      `Day ${d.number} — ${d.title}`,
      ...d.stops.map((s, i) => `  ${i + 1}. id=${s.id} | ${s.name} | arrive ${s.arrival}, stay ${s.visitMin} min${s.asked ? ' | asked for by name' : ''}`),
      ...d.tables.map(t => `  ${t.meal}: ${t.name}`),
    ].join('\n')),
  ].join('\n')
}

async function reviseImpl(trip: Trip, message: string): Promise<Revision> {
  const r = await askJson<{ reply: string; edits: unknown[] }>('critic', EDITOR_SYSTEM,
    `The plan:\n${describeTrip(trip)}\n\nThey said: "${message.trim()}"`, 1500)
  return { reply: String(r.reply ?? '').trim(), edits: (Array.isArray(r.edits) ? r.edits : []).flatMap(normaliseEdit) }
}

const OPS = new Set(['remove_stop', 'move_stop', 'set_stay', 'add_place', 'set_hours', 'set_transport', 'set_meals', 'new_bed', 'none'])

/** Models write the same edit five ways: {op, ...}, {type, ...}, {action, ...},
    {remove_stop: "gion"}, {remove_stop: {id: "gion"}}. All of them mean one
    thing, and refusing four of them would be pedantry at the person's expense. */
function normaliseEdit(raw: unknown): Edit[] {
  if (!raw || typeof raw !== 'object') return []
  const o = raw as Record<string, unknown>
  const opKey = ['op', 'type', 'action', 'edit'].find(k => typeof o[k] === 'string' && OPS.has(String(o[k]).toLowerCase().replace(/[\s-]+/g, '_')))
  let op: string | undefined
  let body: Record<string, unknown> = o
  if (opKey) {
    op = String(o[opKey]).toLowerCase().replace(/[\s-]+/g, '_')
  } else {
    // keyed by op name: {remove_stop: "gion"} or {set_stay: {id, minutes}}
    const k = Object.keys(o).find(key => OPS.has(key.toLowerCase().replace(/[\s-]+/g, '_')))
    if (!k) return []
    op = k.toLowerCase().replace(/[\s-]+/g, '_')
    const v = o[k]
    body = v && typeof v === 'object' ? v as Record<string, unknown> : typeof v === 'string' ? { id: v, query: v } : {}
  }
  const str = (k: string) => typeof body[k] === 'string' ? String(body[k]) : undefined
  const num = (k: string) => Number.isFinite(Number(body[k])) ? Number(body[k]) : undefined
  switch (op) {
    case 'remove_stop': return str('id') ? [{ op, id: str('id')! }] : []
    case 'move_stop': return str('id') && num('day') ? [{ op, id: str('id')!, day: num('day')!, position: num('position') }] : []
    case 'set_stay': return str('id') && num('minutes') ? [{ op, id: str('id')!, minutes: num('minutes')! }] : []
    case 'add_place': return str('query') ? [{ op, query: str('query')!, day: num('day') ?? 1 }] : []
    case 'set_hours': return [{ op, startAt: str('startAt') ?? str('start'), endAt: str('endAt') ?? str('end') }]
    case 'set_transport': {
      const t = str('transport')
      return t && ['walk', 'cycle', 'transit', 'drive', 'auto'].includes(t) ? [{ op, transport: t as Wish['transport'] }] : []
    }
    case 'set_meals': {
      const m = Array.isArray(body.meals) ? (body.meals as unknown[]).filter(x => x === 'lunch' || x === 'dinner') as Wish['meals'] : []
      return [{ op, meals: m }]
    }
    case 'new_bed': return [{ op }]
    default: return []
  }
}

/** Apply edits to the drafts (not the built trip), then rebuild only the days
    that changed. Returns the new trip and which days were rebuilt. */
async function applyEditsImpl(
  s: Session, trip: Trip, edits: Edit[], opts: PipelineOptions,
): Promise<{ trip: Trip; rebuilt: number[]; notes: string[] }> {
  // The drafts are recovered from the trip: every stop is in `known`.
  const drafts: DayDraft[] = trip.days.map(d => ({
    title: d.title, why: '',
    stops: d.stops.map(st => s.known.get(st.id) ?? candidateFrom(st)),
  }))
  const touched = new Set<number>()
  const notes: string[] = []
  let wishChanged = false
  let bedChanged = false

  const find = (id: string) => {
    for (const [i, d] of drafts.entries()) {
      const k = d.stops.findIndex(c => c.id === id)
      if (k >= 0) return { i, k }
    }
    return null
  }

  for (const e of edits) {
    switch (e.op) {
      case 'remove_stop': {
        const at = find(e.id); if (!at) { notes.push(`no such place: ${e.id}`); break }
        const [gone] = drafts[at.i].stops.splice(at.k, 1)
        touched.add(at.i); notes.push(`removed ${gone.name}`)
        break
      }
      case 'move_stop': {
        const at = find(e.id); if (!at) { notes.push(`no such place: ${e.id}`); break }
        const to = Math.max(0, Math.min(drafts.length - 1, (e.day || 1) - 1))
        const [c] = drafts[at.i].stops.splice(at.k, 1)
        const pos = e.position ? Math.max(0, Math.min(drafts[to].stops.length, e.position - 1)) : drafts[to].stops.length
        drafts[to].stops.splice(pos, 0, c)
        touched.add(at.i); touched.add(to); notes.push(`moved ${c.name} to day ${to + 1}`)
        break
      }
      case 'set_stay': {
        const at = find(e.id); if (!at) { notes.push(`no such place: ${e.id}`); break }
        const c = drafts[at.i].stops[at.k]
        drafts[at.i].stops[at.k] = { ...c, visitMin: Math.max(10, Math.min(240, Math.round(e.minutes / 5) * 5)) }
        s.known.set(c.id, drafts[at.i].stops[at.k])
        touched.add(at.i); notes.push(`${c.name}: ${drafts[at.i].stops[at.k].visitMin} min`)
        break
      }
      case 'add_place': {
        const to = Math.max(0, Math.min(drafts.length - 1, (e.day || 1) - 1))
        const hit = await locate(e.query, s.origin, s.signal)
        if (!hit) { notes.push(`could not find “${e.query}”`); break }
        const taken = new Set(Array.from(s.known.values()).flatMap(c => c.article ? [c.article.pageId] : []))
        const c = await matchWant(hit, taken, s.wish, s.onEvent)
        s.known.set(c.id, c)
        drafts[to].stops.push(c)
        touched.add(to); notes.push(`added ${c.name} to day ${to + 1}`)
        break
      }
      case 'set_hours':
        if (e.startAt) s.wish.startAt = e.startAt
        if (e.endAt) s.wish.endAt = e.endAt
        wishChanged = true; notes.push(`hours ${s.wish.startAt}–${s.wish.endAt}`)
        break
      case 'set_transport':
        s.wish.transport = e.transport; wishChanged = true; notes.push(`getting about: ${e.transport}`)
        break
      case 'set_meals':
        s.wish.meals = e.meals; wishChanged = true; notes.push(`meals: ${e.meals.join(', ') || 'none'}`)
        break
      case 'new_bed':
        bedChanged = true
        break
      case 'none':
      default:
        break
    }
  }

  if (bedChanged) {
    const [next] = await stageStay(s, drafts)
    if (next) { s.bed = next; notes.push(`sleeping at ${next.name}`); drafts.forEach((_, i) => touched.add(i)) }
  }
  if (wishChanged) drafts.forEach((_, i) => touched.add(i))

  const days: Day[] = []
  for (const [i, d] of drafts.entries()) {
    if (!d.stops.length) continue
    if (touched.has(i)) {
      days.push(await buildDay(s, d, days.length + 1, opts))
    } else {
      days.push({ ...trip.days[i], number: days.length + 1 })
    }
  }
  const next = assemble(s, days)
  s.onEvent({ type: 'trip', trip: next })
  return { trip: next, rebuilt: [...touched].map(i => i + 1).sort(), notes }
}

/** A stop that was written before this session had a Candidate for it. */
function candidateFrom(st: Stop): Candidate {
  return {
    id: st.id, name: st.name, lat: st.lat, lon: st.lon, kind: 'other', why: st.fits,
    asked: st.asked, article: null, visitMin: st.visitMin,
    ...(st.askedAs ? { askedAs: st.askedAs, movedM: st.movedM } : {}),
  }
}

export { HHMM, MINS }

/* Each stage is its own trace (see telemetry.traced), with the facts that make
   a slow one explainable: how many days, which transport, how many places. */
export const openSession = traced('plan.open', openSessionImpl, (w) => ({ city: w.city, days: w.days, transport: w.transport, party: w.party }))
export const stageStay = traced('plan.stay', stageStayImpl, (s, drafts) => ({ city: s.origin.name, stops: drafts.reduce((n, d) => n + d.stops.length, 0) }))
export const stagePlaces = traced('plan.places', stagePlacesImpl, s => ({ city: s.origin.name, days: s.wish.days, transport: s.wish.transport }))
export const morePlaces = traced('plan.more_places', morePlacesImpl, s => ({ city: s.origin.name }))
export const stagePlan = traced('plan.build', stagePlanImpl, (s, drafts) => ({ city: s.origin.name, days: drafts.length, stops: drafts.reduce((n, d) => n + d.stops.length, 0), transport: s.wish.transport }))
export const revise = traced('plan.revise', reviseImpl, (_t, message) => ({ chars: message.length }))
export const applyEdits = traced('plan.edit', applyEditsImpl, (_s, _t, edits) => ({ ops: edits.map(e => e.op).join(',') }))
