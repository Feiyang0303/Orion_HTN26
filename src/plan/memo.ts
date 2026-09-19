import type { Day, Trip } from '../types'
import { BUDGET_LABEL, PARTY_LABEL, TRANSPORT_LABEL } from '../types'
import { askJson } from './json'
import { report } from '../telemetry'
import { weatherLine, wearLine, type DayWeather } from './weather'

/* The notes at the foot of the page.
 *
 * These were four fixed lines: carry your ID, wear comfortable shoes, buy a
 * day pass. True of anywhere, and therefore worth nothing on a page about a
 * particular Tuesday in a particular city. A model can do better, but only if
 * it is kept on the same leash as every other model in this app: it is given
 * the day's real numbers and may say nothing that is not in them.
 *
 * So the prompt hands over the forecast, the hours, the distance on foot, what
 * the day actually visits and when, who is going and on what budget — and asks
 * for advice that follows from those. It is told, in as many words, that it
 * cannot know opening hours, prices, queues or whether anywhere is any good,
 * because those are exactly the things a model will cheerfully invent for a
 * famous city it has read a great deal about.
 *
 * The rule-written lines are still here and still correct. They are what the
 * page shows while this is in flight, and what it keeps if the call fails. */

export type Note = { label: string; text: string }

const SYSTEM = `You are writing the notes at the foot of a one-page travel journal for ONE day
of a trip. Reply with JSON.

You are given real numbers: a weather forecast, the hours of the day, the
distance walked, the stops in order with their times, and who is travelling.
Write practical notes that follow from THOSE NUMBERS and nothing else.

HARD RULES
- Use only what you are given. You do not know opening hours, ticket prices,
  queue lengths, which day anything is closed, or whether anywhere is good,
  famous or worth it. Never say or imply any of them.
- No place recommendations. The day is already planned; you are not adding to it.
- Every note must be specific to this day. If a note would be equally true of
  any city on any date, it does not belong here.
- Do not repeat the forecast back. A separate line already prints it.
- Plain, warm, practical. No exclamation marks, no "don't forget", no
  "pro tip", no selling.

FORMAT — a JSON object with a "notes" array of 3 objects, each:
  "label": one or two words, sentence case, e.g. "What to wear", "Long stretch"
  "text":  one sentence, under 120 characters, no full stop needed
Example shape (not content to copy):
{"notes":[{"label":"What to wear","text":"..."},{"label":"...","text":"..."}]}`

function brief(trip: Trip, day: Day, w: DayWeather | undefined, onFootKm: number): string {
  const wish = trip.wish
  const stops = day.stops.map((s, i) => `${i + 1}. ${s.name.split(',')[0]} — arrive ${s.arrival}, ${Math.round(s.visitMin)} min`).join('\n')
  const legs = [...new Set(day.legs.map(l => TRANSPORT_LABEL[l.transport].toLowerCase()))].join(', ')
  const longest = [...day.legs].sort((a, b) => b.durationSec - a.durationSec)[0]
  const meals = day.tables.map(t => `${t.meal} at ${t.name}${t.cuisine ? ` (${t.cuisine})` : ''}`).join('; ')
  const total = (day.legs.reduce((n, l) => n + l.distanceM, 0) + (day.approach?.distanceM ?? 0) + (day.back?.distanceM ?? 0)) / 1000
  return [
    `City: ${trip.city}. Day ${day.number} of ${trip.days.length}.`,
    w ? `Forecast for ${w.label}: ${w.minC}–${w.maxC}°C, ${w.sky}, ${w.rainChance}% chance of rain, ${w.rainMm} mm expected.`
      : 'Forecast: none available for this day — it is beyond the horizon.',
    `Out from ${trip.stays[0]?.name ?? 'the hotel'} at ${wish.startAt}, back by ${day.back ? 'the evening' : wish.endAt}.`,
    `${total.toFixed(1)} km in all, ${onFootKm.toFixed(1)} km of it on foot. Getting about: ${legs || 'on foot'}.`,
    longest ? `Longest single journey: ${Math.round(longest.durationSec / 60)} min.` : '',
    `Travelling: ${PARTY_LABEL[wish.party].toLowerCase()}, budget ${BUDGET_LABEL[wish.budget].toLowerCase()}, pace ${wish.pace}.`,
    wish.diet ? `They said about food: "${wish.diet}".` : '',
    meals ? `Eating: ${meals}.` : 'No meals were planned into the day.',
    `The stops:\n${stops}`,
  ].filter(Boolean).join('\n')
}

const clean = (s: unknown, cap: number) =>
  String(s ?? '').replace(/\s+/g, ' ').replace(/^["'\s]+|["'\s.]+$/g, '').slice(0, cap)

/** Three notes for the foot of the page, written from the day's own numbers.
    Returns [] rather than throwing: the page has rule-written lines to fall
    back on and a missing note is not worth a broken page. */
export async function writeMemo(
  trip: Trip, day: Day, weather: DayWeather | undefined, onFootKm: number, signal?: AbortSignal,
): Promise<Note[]> {
  try {
    const r = await askJson<{ notes?: unknown }>('narrator', SYSTEM, brief(trip, day, weather, onFootKm), 700)
    const raw = Array.isArray(r.notes) ? r.notes : []
    const notes = raw
      .map(n => {
        const o = (n ?? {}) as Record<string, unknown>
        return { label: clean(o.label ?? o.title ?? o.name, 22), text: clean(o.text ?? o.note ?? o.body, 140) }
      })
      .filter(n => n.label && n.text)
      .slice(0, 3)
    if (signal?.aborted) return []
    return notes
  } catch (e) {
    if (signal?.aborted) return []
    report(e, 'memo.write', { level: 'warning', extra: { city: trip.city, day: day.number } })
    return []
  }
}

/** What the page shows before the model answers, and instead of it if the
    model never does. Correct, if plainer. */
export const fallbackMemo = (weather: DayWeather | undefined, onFootKm: number): Note[] => [
  { label: 'What to wear', text: wearLine(weather, onFootKm) },
]

export { weatherLine }
