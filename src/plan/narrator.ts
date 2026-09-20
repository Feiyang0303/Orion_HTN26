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

export type Draft = { text: string; targetId?: string; claims?: import('../types').Claim[] }
export type Mode = 'full' | 'short'

const LIMITS = { short: { beats: 3, words: 30 }, full: { beats: 4, words: 46 } }

const SYSTEM = `You are the guide on a flight over a real city. The listener is in the air,
perhaps fifty metres above the place you are describing, looking down and
along. They are not standing in the street and cannot see doorways, plaques or
anything at eye level.

You are the only voice they hear all day, and the day is one journey rather
than a row of encyclopaedia entries read out in order. Write this page as the
next thing you say to someone you have been talking to since morning.

VOICE
Warm, concrete, unhurried - a well-made guidebook read aloud by someone who is
glad to be up here. No exclamation marks. No "welcome to", no "as you can see",
no "imagine". Speak in the present. Contractions are fine; you are talking.

WHAT A BEAT IS
Each beat is two or three spoken sentences and holds the camera for as long as
it takes to say, so a thin beat is a silence with a view. Give each one a small
arc: something seen, then something understood.

HOW THE PAGE IS SHAPED
- The FIRST beat arrives. If you are told where they have come from, carry that
  across in a few words before you land - then begin with something visible
  from above: the shape of the roof, the line of the walls, how the streets
  meet it, what it sits beside.
- The MIDDLE beats are the substance, and this is where a page usually fails by
  stopping too early. Say what the place is and what it was for. Say who made
  it, or what happened here, when the text tells you. Then take the one detail
  that rewards looking - the thing in the text a person would otherwise fly
  straight over - and explain it. A fact stated is a label; a fact explained is
  a guide. Two sentences on one good detail beat one sentence each on four.
- A LATER beat may hand off to one nearby target: set "targetId" to that
  target's id and name the thing naturally, because the camera will turn to it
  as you say it. "Just north of it, ..." works; "on your left" does not, since
  the listener has no left up here. Say why it is worth turning for.
- The LAST beat closes the thought on this place, and closes it — do not look
  ahead to anywhere else. Something is said on the way to the next place, and
  it is not yours to say here.

KEEPING IT CONNECTED
Do not open every beat with the name of the place. Let each beat pick up
something from the one before - a word, a direction, a question it raised - so
the page sounds like one person talking and not four captions stacked up.

HARD RULES
- State ONLY facts found in the supplied text. If the text does not say it, do
  not say it. No dates, numbers, names, materials or history from memory.
- Never invent a target, and never point at something that was not supplied.
- Do not describe the weather, the crowd, the time of day, or how anything
  smells or sounds. You cannot know those and the listener can see the light.
- Do not mention the flight, the camera, the tour, or yourself.
- Never write "we", "our" or "us". The listener is "you", and you are not on
  the journey with them — you are the voice beside it.
- If the supplied text is thin, write fewer beats. A short honest page is
  better than a long invented one, and padding is worse than silence.
- No brochure words: iconic, magnificent, stunning, breathtaking, timeless,
  majestic, a jewel, a testament to, steeped in, nestled. You were given facts;
  the facts are the point, and an adjective you invented is still invented.

HOW IT READS
Bad:  "A true jewel on the island, its soaring elegance is a testament to the
       ambition of the age."                      (all adjective, no fact)
Bad:  "That's our next view, where Marie Antoinette was held."
                                                  (the tour, out loud)
Bad:  "From here we head to the Musée d'Orsay."    ("we", and it is not yours
                                                   to say — the journey has
                                                   its own line)
Good: "Louis the Ninth built it for one reason: to hold the Crown of Thorns.
       The building is the reliquary — that is why the walls are barely there."
Good: "Fifteen windows, each fifteen metres. From up here you are level with
       the top of the glass rather than the foot of it."

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

/* The two habits a model falls back into no matter how plainly the prompt
   forbids them: the brochure adjective, and saying the tour out loud. Checked
   in code, quoted back, and rewritten once — the same shape as the Auditor's
   pass over the facts, applied to the voice. */
const BROCHURE = /\b(iconic|magnificent|stunning|breathtaking|timeless|legendary|must-see|majestic|awe-inspiring|world-renowned|picturesque|a (?:true )?(?:jewel|gem)|testament to|steeped in|nestled|splendou?r|ethereal|resplendent|unparalleled|storied|amazing|incredible|wonderful|spectacular|fabulous|unforgettable)\b/i
const TOUR_TALK = /\b(our (?:next|tour|flight)|we(?:'ll|'re| will| shall| now| then| can| may)?(?: \w+)? (?:fly|flying|head|heading|move|moving|turn|turning|arrive|arriving|go|going|travel|travelling|traveling|continue|leave|leaving)|this (?:tour|flight)|your (?:tour|flight)|next view|coming up next|as you can see|welcome to)\b/i

function beatStyleProblem(text: string): string | null {
  if (TOUR_TALK.test(text)) return 'it mentions the tour or the camera, which the listener must never hear about'
  if (BROCHURE.test(text)) return 'it uses a brochure adjective you were not given'
  return null
}

const PARTY_NOTE: Record<Party, string> = {
  solo: '',
  couple: '',
  family: 'Children are listening: concrete and vivid, no long clauses.',
  easy: 'Keep it calm and unhurried.',
}

export async function narrate(
  stop: { name: string; extract: string }, targets: Target[], mode: Mode, ctx?: StopContext,
  /** Statements a first draft made that the Auditor could not find in the text; the rewrite must not repeat them. */
  unsupported: string[] = [],
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
    (unsupported.length
      ? `\n\nA first draft said these things, and none of them is in the text above. Do not say them or anything like them; ` +
        `say only what the text says:\n${unsupported.map(u => `- ${u}`).join('\n')}`
      : '') +
    `\n\nWrite up to ${n} beats, each at most ${words} words. Use all ${n} when the text supports them; write fewer rather than padding.`

  /* Two attempts, and the better of them is kept rather than the later one: a
     rewrite told to drop a brochure adjective sometimes brings a fresh one,
     and a page that slipped once is still better than a page that slipped
     three times. Fewer slips wins; between equals, the fuller page wins. */
  let last: ReturnType<typeof validate> = { beats: [], problems: [] }
  let best = Infinity
  let note = ''        // what the last attempt got wrong, quoted back to it
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await askJson<{ beats: Draft[] }>('narrator', SYSTEM, user + note, 2000)
    const got = validate(r.beats ?? [], source, targets, mode)
    if (!got.beats.length) { note = ''; continue }      // nothing survived; ask again plainly
    const wrong = got.beats.map(b => ({ text: b.text, why: beatStyleProblem(b.text) })).filter(x => x.why)
    const score = wrong.length * 10 - got.beats.length
    if (score < best) { best = score; last = got }
    if (!wrong.length || attempt) break
    note = `\n\nA first draft wrote these beats, and each one breaks a rule of the voice. ` +
      `Write the page again — same facts, same targets, same number of beats — with these fixed, ` +
      `and do not introduce a different word of the same kind:\n` +
      wrong.map(x => `- "${x.text}" — ${x.why}.`).join('\n')
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

/* ------------------------------------------------------ the way in between */

/* A day told as a set of pages is a set of pages; what makes it a journey is
 * what is said on the way. Each leg gets one line, spoken while the camera is
 * moving, and the whole day's legs are written in a single call so the lines
 * can differ from one another — the same trick four times running is worse
 * than silence.
 *
 * These lines know nothing about the ground they cross. They are written from
 * the plan's own facts (two names, a mode, minutes, kilometres) and one line
 * about where they are going, which is the destination's own supplied text.
 */

export type BridgeLeg = {
  from: string
  to: string
  transport: string        // already a human label, e.g. "on foot"
  minutes: number
  km: number
  /** The router's own words for how this leg is travelled, when it knew:
      "the 4 subway from Châtelet to Saint-Michel". */
  how?: string
  /** One sentence about each end of the leg, from their own source text — the
      two ends are what a line can be drawn between. */
  fromAbout?: string
  about?: string
}

const BRIDGE_SYSTEM = `You are the guide on a flight over a real city, speaking while the camera
moves from one place to the next. These are the seams of the day: a few
seconds of moving air between two things worth stopping for.

You are given the legs of one day, in order. Write one line for each leg, in
the same order.

WHAT A LINE IS
One sentence, two where a leg has directions to give — twelve to thirty
words. The move takes as long as the line does, so every word is time in
transit. It is not an introduction. They will see where they are going and you
will tell them about it when they get there; this line exists so the two
places feel related, and so they know how they are getting there.

HOW THEY GET THERE
When a leg's facts include a "How" — a line and two stations — say it, in
plain words, as the first thing: which line, from which station, to which
station. "You'll pick up the 4 from Châtelet and ride two stops to
Saint-Michel." That is the single most useful sentence you will say all day,
so it is never dropped in favour of something prettier. Where there is no
"How", say the mode and roughly how long it takes instead. Then draw the
thread between the two places.

Ways a line can do that — vary them, and never use the same move twice in a
row:
- carry a thread forward: something the last place was about, continued or
  answered by the next
- name what changes between them: older to newer, sacred to secular, a palace
  to the people who took it
- put the crossing in human terms: a few streets, a long run across the city
- open a small question the next place will answer

Say it all in one flow. A line that lands as two disconnected halves — the
directions, then a fact — is worse than either on its own.

RULES
- Use ONLY the facts given for that leg — the two names and the two
  descriptions. No history you were not told, nothing about the streets in
  between, no invented connection between the places.
- Never state a number that is not in that leg's facts.
- Never write "we", "our" or "us". You are speaking to them, not for both of
  you, and you are not on a coach.
- Do not announce the arrival: no "next up", "now we head to", "we arrive at",
  "our next stop is", "coming up". Naming the destination is allowed only when
  the sentence is doing something more than naming it.
- No praise words: iconic, magnificent, stunning, breathtaking, timeless,
  legendary, must-see. No adjectives you were not given.
- Do not describe weather, traffic, crowds or the time of day. Do not mention
  the tour, the camera, or yourself.
- No exclamation marks. Speak in the present.
- No two lines in the day may begin with the same word.
- If a leg's facts give you nothing to connect, write the plainest true
  sentence you can rather than inventing a connection.

HOW THEY READ
Bad:  "Next up is the Musée d'Orsay, an iconic museum in a stunning old
       railway station."            (announces it, praises it, adds adjectives)
Bad:  "From one gothic jewel to another, we walk along the river."
                                    ("we", and "jewel" was not in the facts)
Good: "Relics were kept behind that glass. Fourteen minutes on foot now, and
       where you are going the thing kept behind glass is paint."
Good: "You'll take the 12 from Solférino down to Concorde, four stops. That
       station stopped taking trains a long time ago — the tower you are going
       to was never meant to last either."
Good: "Twenty minutes of streets, and the century changes twice."

Reply with a JSON object: {"bridges":["line for leg 1","line for leg 2"]} —
exactly one line per leg, in order.`

/* A small model reads a list of prohibitions as a list of suggestions, so the
   habits that are actually audible — the coach-tour "we", the brochure
   adjective, the announced arrival — are checked in code and sent back once
   with the line quoted. Everything that survives a second pass is kept: a
   slightly florid seam is better than a silent one. */
const COACH = /\b(we|we'?re|we'?ll|our|us|let'?s)\b/i
const ANNOUNCING = /\b(next up|our next stop|we (?:head|arrive|travel|make our way|move on)|coming up|now we)\b/i

function styleProblem(text: string): string | null {
  if (COACH.test(text)) return 'it says "we" — you are speaking to them, not for both of you'
  if (ANNOUNCING.test(text)) return 'it announces the arrival instead of connecting the two places'
  /* A leg is as long as the line said on it, so a line of eight words is a leg
     flown in silence. Length is not a style here, it is the pacing. */
  const words = text.split(/\s+/).length
  if (words < 9) return 'it is too short — the crossing would be flown in silence around it'
  if (words > 36) return `it is ${words} words — the crossing lasts as long as the line, so keep it under thirty`
  return beatStyleProblem(text)
}

/** One spoken line per leg, in order; an empty string where nothing usable
    came back, which the flight simply flies in silence. */
export async function writeBridges(city: string, legs: BridgeLeg[]): Promise<string[]> {
  if (!legs.length) return []
  const trim = (t: string) => t.replace(/\s+/g, ' ').slice(0, 220)
  const factsFor = (l: BridgeLeg, i: number) =>
    `Leg ${i + 1}: ${l.from} to ${l.to}. About ${l.minutes} minutes ${l.transport}, ${l.km} km.` +
    (l.how ? `\n  How: ${trim(l.how)}` : '') +
    (l.fromAbout ? `\n  Leaving: ${trim(l.fromAbout)}` : '') +
    (l.about ? `\n  Arriving: ${trim(l.about)}` : '')
  const facts = `City: ${city}. ${legs.length} leg${legs.length === 1 ? '' : 's'}.\n\n` +
    legs.map(factsFor).join('\n')
  const budget = Math.max(700, legs.length * 220)

  /** Only lines whose every number is in that leg's own facts. */
  const keep = (out: unknown[]) => legs.map((l, i) => {
    const text = String(out[i] ?? '').trim().replace(/\s+/g, ' ')
    if (!text) return ''
    const hay = `${factsFor(l, i)} ${city}`.replace(/,/g, '')
    return numbersIn(text).every(n => hay.includes(n)) ? text : ''
  })

  try {
    const first = await askJson<{ bridges: string[] }>('narrator', BRIDGE_SYSTEM, facts, budget)
    let lines = keep(Array.isArray(first.bridges) ? first.bridges : [])

    const wrong = lines.map((t, i) => ({ i, t, why: t ? styleProblem(t) : null })).filter(x => x.why)
    if (wrong.length) {
      const again = `${facts}\n\nYou wrote these lines and each one breaks a rule. Rewrite ONLY these, ` +
        `keeping the same idea and the same facts, and return the full list with the others unchanged:\n` +
        wrong.map(x => `Leg ${x.i + 1}: "${x.t}" — ${x.why}.`).join('\n')
      try {
        const r2 = await askJson<{ bridges: string[] }>('narrator', BRIDGE_SYSTEM, again, budget)
        const fixed = keep(Array.isArray(r2.bridges) ? r2.bridges : [])
        // Take a rewrite only where it is both present and no worse.
        lines = lines.map((t, i) => {
          const f = fixed[i]
          if (!f) return t
          return styleProblem(f) && !styleProblem(t) ? t : f
        })
      } catch { /* the first pass stands */ }
    }
    return lines
  } catch {
    return legs.map(() => '')     // the seams go quiet; nothing else is lost
  }
}

/* --------------------------------------------------- the two ends of a day */

/* A day used to begin mid-sentence over the first roof and end when the last
 * beat ran out. Both ends are now spoken, and they are the only two places the
 * guide is allowed to address the listener directly: to say hello, and to say
 * that was the day.
 *
 * Everything in them is a fact of the plan. Both are short, because both are
 * said over a camera that holds still until they finish: the opening once
 * carried the forecast and what to wear, and was the longest wait of the day.
 */

export type OpeningFacts = {
  city: string
  /** Day n of m, where m is 1 for a single day. */
  number: number
  count: number
  title?: string
  stops: string[]
  startAt: string
  endsAt: string
  transport: string
  party: Party
  interests: string[]
  from?: string
}

const OPENING_SYSTEM = `You are a guide, and the person listening has just lifted off over a real
city for a day you planned together. This is the first thing you say to them.
Reply with JSON.

WHAT IT CONTAINS, in this order, and nothing else:
1. A greeting that names the city. If you are given a day number out of
   several, say which day of the trip this is.
2. The shape of the day in one breath: how many places and how they are
   getting about.
3. A few words that hand over to the first place, naming it.

HOW LONG
Short. They are in the air with a city under them and want to get to it: two
or three sentences, forty words at the very most. Every sentence past the
third is time they spend waiting for the day to start. No weather, nothing
about what to wear, no list of the places, no clock times unless the day
starts or ends at an unusual hour.

HOW IT SOUNDS
Spoken, the way someone talks — not a list read aloud. Contractions. Warm, no
exclamation marks, no "get ready", no "buckle up", no "without further ado".
You may say "we" here, and only here: you are setting off together.

HARD RULES
- Use ONLY the facts given. Never a number that is not in them. Say nothing
  about any of the places beyond naming the first one — you have not arrived
  yet and the pages will do that work.
- Say clock times the way a person says them out loud — "half nine", "just
  after two", "around five" — never "09:30" or "17:40". This is read aloud,
  and a spoken "fourteen thirty-four" is nobody's idea of an afternoon.
- Do not mention the camera, the flight, the tour, the app, or a screen.

Reply with a JSON object: {"say":"<the whole thing, as one paragraph>"}`

export type ClosingFacts = {
  city: string
  number: number
  count: number
  title?: string
  last: string
  stopCount: number
  km: number
  endsAt: string
  /** The next day's name, when there is a next day and it is known. */
  nextTitle?: string
  back?: string
}

const CLOSING_SYSTEM = `You are a guide, and the day you have been showing someone is over. The last
place is below them. This is the last thing you say. Reply with JSON.

WHICH ENDING THIS IS — you are told, and they are not the same:
- The only day. Close the whole thing: what they covered, and a warm goodbye
  that does not oversell what they have just seen.
- A day with more to come. Close this day, then hand forward to the next one
  by name if you are given it, the way you would at the end of an evening —
  a sentence, not a trailer.
- The last of several days. Close the trip, not just the day. You may look
  back across the days here; that is the whole point of being at the end.

HOW IT SOUNDS
Spoken. Two or three sentences, fifty words at the very most, running on into
each other. Contractions. Warm,
a little slower than the rest of the day, and plain — this is the one moment
that sounds false if it strains, and the way it strains is always the same:
reaching for feeling instead of saying what happened. Say what they actually
did. That is the warmth. You may say "we".

NEVER, because every one of these is a greetings card and not a guide:
"I hope you enjoyed", "I hope you've", anything about what they will
remember or carry with them, "memories", "linger", "journey", "adventure",
"safe travels", "take care", "until next time", thanking them for anything,
or telling them the city will stay with them. Do not describe the light, the
hour, the sun going down, or the way anywhere feels underfoot.

HARD RULES
- Use ONLY the facts given: the places, the count, the distance, the time.
  Never a number that is not in them, and nothing about any place beyond its
  name — no adjectives for places you have not been told about.
- Say clock times the way a person says them out loud — "twenty to six", "just
  gone two" — never "17:40". This is read aloud.
- Do not mention the camera, the flight, the tour, the app, or a screen.
- Do not invite them to do anything else, rate anything, or come back.

HOW IT READS
Bad:  "What a day. Four incredible places and 7.3 kilometres of charm and
       history — I hope Paris lingers sweetly in your memory."
Bad:  "As the sun dips towards 17:40, our journey ends. Safe travels."
Good: "That's the four of them, and about seven kilometres of Paris under you.
       The tower's the last of it, and we're done a little after twenty to
       six. That's the day."
Good: "Day two done. The river and the left bank, four stops, and you're back
       at the hotel from here. Tomorrow is Montmartre, and it's a slower one —
       which after today's walking is not an accident."

Reply with a JSON object: {"say":"<the whole thing, as one paragraph>"}`

/* The farewell has one failure mode and it is very strong: the model reaches
   for a greetings card. Told not to in six ways it still writes "I hope these
   days linger in your memory", so the phrases are checked here as well. */
const FAREWELL = /\b(i hope|hope you|memor(?:y|ies)|linger|journey|adventure|safe travels|take care|until next time|thanks? (?:you )?for|stay with you|cherish)\b/i

/* The two ends are said over a held camera: nothing else happens until they finish, so their length is the person's
   wait. The prompt asks for less than this; this is where asking stops and it is sent back. */
const OPENING_MAX_WORDS = 55, CLOSING_MAX_WORDS = 65
const tooLong = (text: string, max: number): string | null => {
  const n = text.split(/\s+/).length
  return n > max ? `it is ${n} words and must be under ${max} — cut it to the essentials` : null
}

function farewellProblem(text: string): string | null {
  const long = tooLong(text, CLOSING_MAX_WORDS)
  if (long) return long
  const m = text.match(FAREWELL)
  if (m) return `it says "${m[0]}", which is a greetings card and not a guide`
  return beatStyleProblem(text.replace(TOUR_TALK, 'x'))    // "we head back" is fine at the end
}

/** Shared by both ends: ask once, keep it only if every number in it is a
    number it was given. The retry is for the voice, as everywhere else. */
async function saySomething(system: string, facts: string, budget: number, problem: (t: string) => string | null): Promise<string> {
  let best = ''
  let bestScore = Infinity
  let note = ''
  /* Three, not two, and only here: there are two of these per day rather than
     one per stop, so the extra call is nothing, and the farewell is the line
     most likely to need asking twice. */
  for (let attempt = 0; attempt < 3; attempt++) {
    let text: string
    try {
      const r = await askJson<{ say?: string }>('narrator', system, facts + note, budget)
      text = String(r.say ?? '').trim().replace(/\s+/g, ' ')
    } catch { break }
    if (!text) continue
    const hay = facts.replace(/,/g, '')
    if (!numbersIn(text).every(n => hay.includes(n))) { note = '\n\nYour last attempt used a number that is not in the facts above. Use only the numbers you are given.'; continue }
    const why = problem(text)
    const score = why ? 1 : 0
    if (score < bestScore) { bestScore = score; best = text }
    if (!why) break
    note = `\n\nYour last attempt broke a rule of the voice: ${why}. Write it again without that.`
  }
  return best
}

export const writeOpening = (f: OpeningFacts): Promise<string> => saySomething(OPENING_SYSTEM, [
  `City: ${f.city}.`,
  f.count > 1 ? `This is day ${f.number} of ${f.count}${f.title ? `, called "${f.title}"` : ''}.` : 'This is a single day out, not part of a longer trip.',
  `${f.stops.length} places: ${f.stops.join(', ')}.`,
  `It runs from ${f.startAt} to about ${f.endsAt}, getting about ${f.transport}.`,
  f.from ? `They set out from ${f.from}.` : '',
  `Who is travelling: ${f.party}.`,
  f.interests.length ? `They said they are interested in ${f.interests.join(', ')}.` : '',
  `The first place is ${f.stops[0] ?? ''}.`,
].filter(Boolean).join('\n'), 400, t => tooLong(t, OPENING_MAX_WORDS) ?? (t.includes('!') ? 'it has an exclamation mark — say it, do not announce it' : null) ?? beatStyleProblem(t.replace(TOUR_TALK, 'x')))

export const writeClosing = (f: ClosingFacts): Promise<string> => saySomething(CLOSING_SYSTEM, [
  `City: ${f.city}.`,
  f.count === 1 ? 'This is the only day: close the whole thing.'
    : f.number < f.count ? `This is day ${f.number} of ${f.count}, and there are more to come${f.nextTitle ? `. The next day is called "${f.nextTitle}"` : ''}.`
    : `This is day ${f.number} of ${f.count}, the last one: close the trip.`,
  f.title ? `Today was called "${f.title}".` : '',
  `${f.stopCount} places, ${f.km.toFixed(1)} km of ground, ending about ${f.endsAt}.`,
  `The last place, below them now, is ${f.last}.`,
  f.back ? `From here they head back to ${f.back}.` : '',
].filter(Boolean).join('\n'), 600, farewellProblem)
