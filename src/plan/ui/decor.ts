import type { MarkName } from './Marks'
import type { Plan, Stop } from '../../types'

/* What goes in the margins, and why.
 *
 * Decoration reflects the destination and the day rather than repeating at
 * random, and that is a stricter rule than it sounds: every sticker has to be
 * *derived* from something. A tower is drawn because a stop is called a tower.
 * A palm is pressed between the pages because the city is at nineteen degrees.
 * The stamp's denomination is the day's actual distance.
 *
 * The test is simple and worth keeping: point at anything on a page and ask
 * which field of the Plan put it there. If there is no answer, it does not
 * belong on the page.
 */

const NAME_RULES: [RegExp, MarkName][] = [
  [/tower|spire|obelisk|shard|monument column/i, 'tower'],
  [/cathedral|church|basilica|chapel|abbey|minster|synagogue|mosque|temple|monastery|convent|priory|cloister|mosteiro|iglesia|igreja|duomo/i, 'church'],
  [/museum|gallery|collection|exhibition|pinacoteca|kunsthalle/i, 'museum'],
  [/bridge|viaduct|aqueduct/i, 'bridge'],
  [/park|garden|common|arboretum|botanic|meadow|woods?/i, 'park'],
  [/market|bazaar|arcade|exchange|factory|works|mill|warehouse|mercado|halles/i, 'market'],
  [/harbour|harbor|port|quay|river|lake|canal|bay|beach|falls|fountain/i, 'water'],
  [/castle|fort|citadel|palace|château|schloss|keep/i, 'castle'],
  [/station|terminus|gare|bahnhof|airport|pier/i, 'station'],
  [/theatre|theater|opera|concert hall|playhouse|arena|philharmon/i, 'theatre'],
  [/hill|mount|peak|summit|viewpoint|lookout|belvedere/i, 'hill'],
  [/statue|memorial|cenotaph|column|sculpture/i, 'statue'],
]

/** The sketch that belongs beside a place, read off its name. Falls back to a
    museum block only when nothing in the name says anything — which is itself
    informative, and the page never leans on it twice in a row. */
export function markFor(name: string, fallbackIndex = 0): MarkName {
  for (const [rule, mark] of NAME_RULES) if (rule.test(name)) return mark
  const spares: MarkName[] = ['museum', 'statue', 'market', 'park']
  return spares[fallbackIndex % spares.length]
}

/** What was pressed between the pages: the flora of the latitude the city sits
    at, so a journal of Reykjavík and one of Lisbon are not decorated alike. */
export function pressedFor(lat: number): MarkName {
  const a = Math.abs(lat)
  if (a > 55) return 'fern'
  if (a > 42) return 'maple'
  if (a > 25) return 'olive'
  return 'palm'
}

/** The hour the day starts decides whether a sun or a moon sits by the title. */
export function skyFor(startAt: string): MarkName {
  const hour = Number(startAt.slice(0, 2))
  return hour >= 6 && hour < 18 ? 'sun' : 'moon'
}

/* ----------------------------------------------------------- marginal notes */

export type Note = { text: string; side: 'left' | 'right'; rotate: number }

/** The small notes in the margin. Every one is a fact about *this* plan that
    has nowhere better to live — never filler, and never the same note twice. */
export function notesFor(plan: Plan): Note[] {
  const out: string[] = []
  const estimated = plan.legs.filter(l => l.estimated).length + (plan.approach?.estimated ? 1 : 0)
  if (estimated) out.push(`${estimated} leg${estimated === 1 ? '' : 's'} drawn as straight lines — the router did not answer for ${estimated === 1 ? 'it' : 'them'}.`)

  const silent = plan.stops.filter(s => !s.sources.length)
  if (silent.length) out.push(`No article for ${silent.slice(0, 2).map(s => s.name).join(' or ')}; the book knows only the address.`)

  if (plan.approach && plan.from)
    out.push(`${Math.round(plan.approach.durationSec / 60)} minutes from ${plan.from.name} before the day even begins.`)

  const longest = [...plan.legs].sort((a, b) => b.durationSec - a.durationSec)[0]
  if (longest && longest.durationSec > 18 * 60) {
    const after = plan.stops.find(s => s.id === longest.fromStopId)
    if (after) out.push(`The long leg is after ${after.name}: ${Math.round(longest.durationSec / 60)} minutes.`)
  }

  const metres = plan.legs.reduce((s, l) => s + l.distanceM, 0)
  if (metres > 0) out.push(`${(metres / 1000).toFixed(1)} km of ground, end to end.`)

  const mine = plan.stops.filter(s => s.asked)
  if (mine.length) out.push(`${mine.length} of these ${mine.length === 1 ? 'is' : 'are'} yours by name; the rest the scout found.`)

  const targets = plan.stops.reduce((n, s) => n + s.targets.length, 0)
  if (targets) out.push(`${targets} more things stand near the line, and the guide will point at them.`)

  return out.slice(0, 5).map((text, i) => ({
    text, side: i % 2 ? 'right' : 'left', rotate: ((i * 7919) % 9) - 4,
  }))
}

/** A deterministic scatter, so a page's ornament does not move between renders
    but two different pages are not decorated identically. */
export function scatter(seed: string, n: number) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  return Array.from({ length: n }, (_, i) => {
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    const a = ((h >>> 0) % 1000) / 1000
    h = Math.imul(h ^ (h >>> 11), 2654435761)
    const b = ((h >>> 0) % 1000) / 1000
    return { a, b, i }
  })
}

/** How a stop is illustrated when Wikipedia has no photograph: its own sketch. */
export const illustrationFor = (stop: Stop, index: number): MarkName => markFor(stop.name, index)

/** The browser's own sentence segmenter knows that "553.3 m (1,815.3 ft)" is
    not three sentences. The regex it replaces did not, and printed a page that
    began "3 ft) communications and observation tower". */
export function firstSentences(text: string, n: number) {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) =>
    { segment(t: string): Iterable<{ segment: string }> } }).Segmenter
  if (Seg) {
    const out: string[] = []
    for (const { segment } of new Seg('en', { granularity: 'sentence' }).segment(clean)) {
      out.push(segment)
      if (out.length >= n) break
    }
    return out.join('').trim()
  }
  return clean.split(/(?<=[.!?])\s+(?=[A-Z"“(])/).slice(0, n).join(' ').trim()
}
