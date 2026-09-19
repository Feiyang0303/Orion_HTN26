import type { Beat, Party, Target, Transport } from '../types'
import { askJson } from './json'

/* NARRATOR (LLM, fast, one call per stop, run in parallel). It may only say
 * what the supplied text says, and may only point at supplied targets. Both
 * are enforced below, not just requested.
 *
 * The frame matters more than the voice. The listener is not standing on the
 * pavement: they are fifty-five metres up and moving, the beat's own length is
 * what holds the camera there, and a beat with a targetId is the instant the
 * camera turns towards that thing. Written as a walking tour, the narration
 * says "look to your left" over a roof, names doorways nobody can see, and
 * describes what it is like to arrive somewhere the listener is flying over.
 * So the prompt puts the writer in the air, and hands it the things that make
 * the day theirs: the hour, where they have just come from, how they got here,
 * who is travelling.
 */

export type Draft = { text: string; targetId?: string }
export type Mode = 'full' | 'short'

const LIMITS = { short: { beats: 2, words: 22 }, full: { beats: 3, words: 34 } }

const SYSTEM = `You are the guide on a flight over a real city. The listener is in the air,
perhaps fifty metres above the place you are describing, looking down and
along. They are not standing in the street and cannot see doorways, plaques or
anything at eye level.

VOICE
Warm, concrete, unhurried — a well-made guidebook read aloud by someone who is
glad to be up here. No exclamation marks. No "welcome to", no "as you can see",
no "imagine". Speak in the present.

WHAT A BEAT IS
Each beat is one or two spoken sentences and holds the camera for as long as it
takes to say. You are writing the shape of a pause, not a paragraph.
- The FIRST beat is about this place, and it begins with something visible from
  above: the shape of the roof, the line of the walls, how the streets meet it,
  what it sits beside. Then say the one thing that makes it matter.
- A LATER beat may hand off to one nearby target: set "targetId" to that
  target's id and name the thing naturally, because the camera will turn to it
  as you say it. "Just north of it, ..." works; "on your left" does not, since
  the listener has no left up here.
- If targets were supplied, at least one later beat should use one. If none
  were supplied, stay on the place itself.

HARD RULES
- State ONLY facts found in the supplied text. If the text does not say it, do
  not say it. No dates, numbers, names, materials or history from memory.
- Never invent a target, and never point at something that was not supplied.
- Do not describe the weather, the crowd, the time of day, or how anything
  smells or sounds. You cannot know those and the listener can see the light.
- Do not mention the flight, the camera, the tour, or yourself.

Reply with a JSON object: {"beats":[{"text":"...","targetId":"<id, optional>"}]}`

const numbersIn = (s: string) => (s.match(/\d[\d,.]*\d|\d/g) ?? []).map(n => n.replace(/[,.]+$/, '').replace(/,/g, ''))

/** Beats that keep their targetId only if it was supplied, and that contain no
    number absent from the source text. Returns what survived plus why anything
    was dropped. */
export function validate(drafts: Draft[], source: string, targets: Target[], mode: Mode) {
  const haystack = source.replace(/,/g, '')
  const ids = new Set(targets.map(t => t.id))
  const problems: string[] = []
  const beats: Draft[] = []
  for (const d of drafts) {
    const text = String(d.text ?? '').trim()
    if (!text) continue
    const bad = numbersIn(text).filter(n => !haystack.includes(n))
    if (bad.length) { problems.push(`dropped a beat with unsupported number(s) ${bad.join(', ')}`); continue }
    const targetId = d.targetId && ids.has(d.targetId) ? d.targetId : undefined
    if (d.targetId && !targetId) problems.push(`ignored unknown target ${d.targetId}`)
    beats.push({ text, ...(targetId ? { targetId } : {}) })
  }
  return { beats: beats.slice(0, LIMITS[mode].beats), problems }
}

/** Everything about the day that this one stop's writer is allowed to know.
    All of it is already in the Plan; handing it over is what stops the
    narration reading like a gazetteer entry that happens to be next in a list. */
export type StopContext = {
  city: string
  index: number            // 0-based
  total: number
  arrival?: string         // 'HH:MM'
  visitMin?: number
  previous?: string        // the stop flown from
  legMin?: number          // how long that journey takes on the ground
  transport?: Transport
  party?: Party
  interests?: string[]
  last?: boolean
}

const PARTY_NOTE: Record<Party, string> = {
  solo: '',
  couple: '',
  family: 'Children are listening: concrete and vivid, no long clauses.',
  easy: 'Keep it calm and unhurried.',
}

export async function narrate(
  stop: { name: string; extract: string }, targets: Target[], mode: Mode, ctx?: StopContext,
): Promise<{ beats: Draft[]; problems: string[] }> {
  const { beats: n, words } = LIMITS[mode]
  const source = [stop.name, stop.extract, ...targets.flatMap(t => [t.name, t.summary])].join('\n')

  /* Context is given as plain statements of fact, never as instructions to
     repeat them. A writer told "it is the third of five" writes a better third
     beat; a writer told "say it is the third of five" writes a worse one. */
  const where = ctx ? [
    `This is stop ${ctx.index + 1} of ${ctx.total} in ${ctx.city}.`,
    ctx.index === 0 ? 'It is the first place of the day; the listener has just arrived over the city.' : '',
    ctx.last && ctx.total > 1 ? 'It is the last place of the day.' : '',
    ctx.previous ? `They have just come from ${ctx.previous}${ctx.legMin ? `, about ${Math.round(ctx.legMin)} minutes away on the ground` : ''}.` : '',
    ctx.arrival ? `They are due here at ${ctx.arrival}${ctx.visitMin ? ` and will stay about ${ctx.visitMin} minutes` : ''}.` : '',
    ctx.interests?.length ? `They said they are interested in ${ctx.interests.join(', ')} — lean that way when the text gives you the choice.` : '',
    ctx.party ? PARTY_NOTE[ctx.party] : '',
  ].filter(Boolean).join('\n') : ''

  const user = `Stop: ${stop.name}\n${stop.extract || '(no description is available for this place — write only from the targets below)'}\n\n` +
    (where ? `${where}\n\n` : '') +
    `Nearby targets you may point at:\n` +
    (targets.length ? targets.map(t => `${t.id} | ${t.name} | ${t.summary.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n') : '(none)') +
    `\n\nWrite exactly ${n} beats, each at most ${words} words.`

  let last: ReturnType<typeof validate> = { beats: [], problems: [] }
  for (let attempt = 0; attempt < 2; attempt++) {       // one retry if validation empties the page
    const r = await askJson<{ beats: Draft[] }>('narrator', SYSTEM, user, 2000)
    last = validate(r.beats ?? [], source, targets, mode)
    if (last.beats.length) break
  }
  if (!last.beats.length) throw new Error(`the narrator produced nothing usable for ${stop.name}`)
  return last
}

export const withAudio = (d: Draft, audioUrl: string | null, durationSec: number): Beat => ({ ...d, audioUrl, durationSec })

/* ------------------------------------------------------------- the preface */

/* The one place a model is allowed to talk about the day as a whole rather
 * than about one place. It is given the finished plan as fields — names,
 * times, distances, who is travelling, what was asked for, what was moved and
 * what was estimated — and may say nothing that is not in them. The value of
 * it is that a person reading the book can see the reasoning: why this order,
 * where the slack is, what to watch out for. A plan that cannot explain itself
 * is just a list with times on it.
 */

const PREFACE_SYSTEM = `You are the editor of a day's itinerary, writing the short note that opens the
book. You are given the finished plan as a list of facts.

Write 3 to 5 sentences that make the day legible to the person about to live
it: how it is shaped, why this order makes sense given the times and distances
you are shown, where the pressure is, and anything they should know before they
set out. Speak plainly and in the second person. Warm, dry, useful.

HARD RULES
- Use ONLY the facts given. No history, no descriptions of places, no adjectives
  about how beautiful anything is, no claims about opening hours, prices,
  crowds, weather or seasons. You know the plan, not the world.
- Mention by name at most three of the stops.
- If a stop was moved from where they pinned, say so plainly.
- If the day ends later than the hour they gave, or a leg is long, or times are
  estimated, say that rather than smoothing over it.
- No exclamation marks. Do not welcome them, do not wish them well, do not
  mention the flight or the book.

Reply with a JSON object: {"preface":"<the paragraph>"}`

export type PrefaceFacts = {
  city: string
  startAt: string
  endsAt: string
  windowEnd: string
  party: string
  pace: string
  transport: string
  budget: string
  interests: string[]
  from?: string
  approachMin?: number
  meals: { label: string; minutes: number; after: string }[]
  totalKm: number
  stops: {
    name: string; arrival: string; stayMin: number; why: string
    asked: boolean; askedAs?: string; movedM?: number
    hasArticle: boolean; targets: number
    legMinToNext?: number; legEstimated?: boolean
  }[]
}

export async function writePreface(f: PrefaceFacts): Promise<string> {
  const lines = f.stops.map((s, i) =>
    `${i + 1}. ${s.name} — arrive ${s.arrival}, stay ${s.stayMin} min. ` +
    (s.asked
      ? s.askedAs
        ? `They pinned "${s.askedAs}"; this stands ${s.movedM} m from that pin. `
        : 'They asked for this one by name. '
      : `Chosen by the scout: ${s.why}. `) +
    (s.hasArticle ? '' : 'No article exists for it. ') +
    (s.targets ? `${s.targets} things nearby to point at. ` : '') +
    (s.legMinToNext ? `Then ${Math.round(s.legMinToNext)} min to the next${s.legEstimated ? ' (estimated)' : ''}.` : 'Last stop.')
  ).join('\n')

  const facts = [
    `City: ${f.city}. ${f.stops.length} stops, ${f.totalKm.toFixed(1)} km of ground.`,
    `They asked for ${f.startAt} to ${f.windowEnd}; the day as planned ends at ${f.endsAt}.`,
    `Getting about: ${f.transport}. Pace: ${f.pace}. Who: ${f.party}. Budget: ${f.budget}.`,
    f.interests.length ? `Interests: ${f.interests.join(', ')}.` : 'No interests given.',
    f.from ? `Starting from ${f.from}, ${Math.round(f.approachMin ?? 0)} min to the first stop.` : 'No starting point given.',
    f.meals.length ? f.meals.map(m => `${m.minutes} min kept clear for ${m.label} after ${m.after}.`).join(' ') : 'No meal breaks.',
    '',
    lines,
  ].join('\n')

  try {
    const r = await askJson<{ preface: string }>('narrator', PREFACE_SYSTEM, facts, 900)
    return String(r.preface ?? '').trim()
  } catch {
    return ''   // the book prints the counted epigraph and nothing is missing
  }
}
