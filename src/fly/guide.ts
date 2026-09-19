import type { Plan, Stop, Table } from '../types'
import { askJson } from '../plan/json'
import { postBytes } from '../plan/net'
import { report } from '../telemetry'

/* The guide you can interrupt.
 *
 * The flight already has a voice: the narrator's written pages, spoken once
 * and played back against the clock. This is the other half of having a guide
 * — the bit where you stop them in the street and ask. Pause the flight and
 * the same voice answers, live.
 *
 * Two things keep it honest. It is told what the day actually contains and
 * where the flight has got to, so "what is that?" has an answer without the
 * model guessing which city it is in. And it is told, plainly, to say when it
 * does not know: a guide who is sure about the opening hours of a museum it
 * has never checked is worse than one who says to look it up. The same rule
 * the narrator works under, in a form that survives being asked anything.
 *
 * Sounding human is two things, because most accounts do not have the model
 * that performs audio tags. The reply carries them anyway — [warmly],
 * [laughs] — for the accounts that do, and they are stripped before the line
 * is shown either way. But it also names its own mood, which becomes voice
 * settings on any model, and it is written to be *said*: short sentences, a
 * real pause where someone would take one, the feeling in the words rather
 * than in a bracket. That last part is the one that survives everywhere. A
 * flat voice reading a well-shaped line still sounds like a person; a lively
 * one reading a paragraph does not.
 */

export type Turn = { who: 'you' | 'guide'; text: string }

/** What the flight is actually handed. A Day where the trip has one, a bare
    Plan where it does not — the guide only needs the parts they share. */
export type Flown = Plan & { number?: number; title?: string; tables?: Table[] }

const SYSTEM = `You are a travel guide flying someone over a real city, in the air beside
them. They have paused the tour to ask you something. Reply with JSON.

HOW YOU SOUND
Spoken, not written. One breath — two or three sentences, rarely more. You are
standing next to them, not reading a page. Contractions, plain words, no lists,
no headings, no "certainly!".

SAYING IT, NOT WRITING IT
Your answer is read aloud by a speech model. Assume it will NOT act stage
directions, so the feeling has to be in the words and the punctuation:
- Short sentences. A long one flattens out when it is spoken.
- "..." where you would genuinely trail off or let something land.
- A dash for the aside you would actually throw in — like this one.
- Start somewhere real: "Oh, that one?" carries more than "That building is".
- Italics do not exist out loud. If a word matters, put it last.

AUDIO TAGS
Add one or two bracketed tags where the feeling turns, for the voices that can
perform them — never one per sentence, and never in place of writing the line
properly, because most of the time they are removed before it is spoken.
Available: [warmly] [thoughtfully] [excited] [curious] [amused] [laughs]
[softly] [whispers] [sighs] [matter-of-fact]

WHAT YOU KNOW
Only what you are told below, plus ordinary knowledge about the world and this
city's history and architecture. You are NOT told, and must never state:
opening hours, ticket prices, whether anywhere is open today, how long the
queue is, or anything that changed recently. If asked one of those, say you
cannot see that from up here and where they could check. Never invent a detail
about a specific building to fill a gap — "I don't know" in a warm voice is a
perfectly good answer from a guide.

If they ask something off-topic, answer it briefly and naturally. You are a
person they are talking to, not a kiosk.

FORMAT — a JSON object with the line and the mood it is said in.
"mood" is one of: excited, amused, curious, warm, thoughtful, calm, serious.
{"say": "[warmly] That's the one ... it's older than it looks.", "mood": "warm"}`

const ctx = (day: Flown, city: string, stopIndex: number, caption: string) => {
  const here: Stop | undefined = day.stops[stopIndex]
  const seen = day.stops.slice(0, Math.max(0, stopIndex)).map(s => s.name.split(',')[0])
  const next = day.stops.slice(stopIndex + 1).map(s => `${s.name.split(',')[0]} at ${s.arrival}`)
  return [
    `City: ${city}.${day.number ? ` Day ${day.number}` : ''}${day.title ? ` — ${day.title}` : ''}`,
    here ? `They are hovering over ${here.name}, stop ${stopIndex + 1} of ${day.stops.length}, arriving ${here.arrival} for ${Math.round(here.visitMin)} minutes.` : 'They are between stops.',
    here?.fits ? `Why it is in the day: ${here.fits}` : '',
    caption ? `You were just saying: "${caption}"` : '',
    seen.length ? `Already flown: ${seen.join(', ')}.` : 'This is the first stop.',
    next.length ? `Still to come: ${next.join('; ')}.` : 'This is the last stop of the day.',
    day.tables?.length ? `Eating today: ${day.tables.map(t => `${t.meal} at ${t.name}`).join(', ')}.` : '',
  ].filter(Boolean).join('\n')
}

/** Everything the tags do is for the speaker; the screen wants the sentence. */
export const untag = (s: string) => s.replace(/\[[^\]]{1,24}\]/g, ' ').replace(/\s{2,}/g, ' ').trim()

/** One turn of the conversation. Returns the line with its tags (to be spoken)
    and without (to be read). */
export async function ask(
  question: string,
  history: Turn[],
  day: Flown,
  city: string,
  stopIndex: number,
  caption: string,
): Promise<{ spoken: string; shown: string }> {
  const said = history.slice(-6).map(t => `${t.who === 'you' ? 'They' : 'You'}: ${t.text}`).join('\n')
  const user = [
    ctx(day, city, stopIndex, caption),
    said ? `\nSo far:\n${said}` : '',
    `\nThey ask: "${question.trim()}"`,
  ].join('\n')
  const r = await askJson<{ say?: string; mood?: string }>('narrator', SYSTEM, user, 400)
  const spoken = String(r.say ?? '').trim().slice(0, 600)
  if (!spoken) throw new Error('the guide had nothing to say')
  const mood = MOODS.includes(String(r.mood)) ? String(r.mood) : 'warm'
  return { spoken, shown: untag(spoken), mood }
}

const MOODS = ['excited', 'amused', 'curious', 'warm', 'thoughtful', 'calm', 'serious']

/** The answer, out loud: the tags where a voice can act them, and the mood as
    voice settings where it cannot. */
export async function voice(spoken: string, mood = 'warm'): Promise<HTMLAudioElement | null> {
  try {
    const bytes = await postBytes('tts', { text: spoken, expressive: true, mood })
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
    const audio = new Audio(url)
    audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })
    return audio
  } catch (e) {
    // The words are already on screen; losing the voice is not losing the answer.
    report(e, 'guide.voice', { level: 'warning' })
    return null
  }
}
