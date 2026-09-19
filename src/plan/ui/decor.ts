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

/* ------------------------------------------------------------- the palette */

/* The colours a city is painted in, read off what the day is made of. A day
   of harbours and bridges is blues and sea-greens; cathedrals, castles and
   forums are warm reds and greys; canals and gardens are soft teals; parks
   are green; markets are ochre. Same rule as every other mark in the book —
   point at a colour and you can name the field that chose it — and it is why
   Venice and Rome are not painted alike. */
export type Palette = {
  name: string
  accent: string      // the ink the day is drawn in: pins, route, headings
  wash: string        // the first watercolour tone
  wash2: string       // the second, laid under it off-register
  wash3: string       // a third, for variety across the sketches
  rule: string        // pencil rules and leaders
  paper: string       // the sheet
  ink: string         // line work
}

const PALETTES: Record<string, Palette> = {
  coastal:  { name: 'coastal',   accent: '#2f6f8f', wash: '#8fbad0', wash2: '#a9c9a3', wash3: '#e8c88a', rule: '#9ab5c2', paper: '#f4efe2', ink: '#3a3a3a' },
  historic: { name: 'historic',  accent: '#9a4a3c', wash: '#d9a48a', wash2: '#b8b0a4', wash3: '#e3c48c', rule: '#c7aa9b', paper: '#f3eadb', ink: '#3b2f22' },
  watertown:{ name: 'water town', accent: '#3f7f78', wash: '#9fcdc4', wash2: '#b7d3a6', wash3: '#e6cf9c', rule: '#a6c4bd', paper: '#f2f0e4', ink: '#2f3b36' },
  green:    { name: 'green',     accent: '#4a7c4e', wash: '#a9c9a3', wash2: '#d6c48f', wash3: '#c9a27a', rule: '#a9c3a6', paper: '#f3efe0', ink: '#33402f' },
  market:   { name: 'market',    accent: '#a8703a', wash: '#e6c48c', wash2: '#d9a48a', wash3: '#b7c9a6', rule: '#d3b389', paper: '#f4ecd9', ink: '#3b2f22' },
  default:  { name: 'ink',       accent: '#8a5a2b', wash: '#d9b98a', wash2: '#c9c0ae', wash3: '#b7c9a6', rule: '#c2b18d', paper: '#f3ead6', ink: '#3b2f22' },
}

const COASTAL = /harbour|harbor|port\b|bay\b|beach|sea\b|ocean|pier|lighthouse|marina|coast|cliff|promenade/i
const WATERTOWN = /canal|water town|bridge|ponte|lagoon|river|seine|kamo|thames|tiber|island|île|isola|quay|embankment/i
const HISTORIC = /cathedral|church|basilica|castle|palace|palais|forum|colosseum|temple|shrine|abbey|tower|monument|gate|ruins?|pantheon|citadel|fort/i
const GREEN = /park|garden|jardin|forest|wood|hill|meadow|botanic|arboretum/i
const MARKET = /market|bazaar|hall|arcade|quarter|district|street|square|piazza|plaza/i

/* Cities whose character is known before a single place is named: the sea
   or the canals are the point of them, whatever the museums are called. */
const COASTAL_CITY = /lisbon|lisboa|porto|barcelona|valencia|málaga|malaga|cádiz|cadiz|marseille|nice|genoa|genova|naples|napoli|palermo|dubrovnik|split|athens|piraeus|istanbul|tel aviv|beirut|alexandria|cape town|mumbai|goa|hong kong|busan|yokohama|kobe|sydney|melbourne|auckland|wellington|honolulu|san francisco|san diego|los angeles|santa monica|seattle|vancouver|victoria|halifax|boston|miami|rio de janeiro|havana|cartagena|copenhagen|oslo|bergen|helsinki|tallinn|riga|gdańsk|gdansk|reykjav|brighton|cornwall|dublin|galway|monaco|cinque terre|amalfi|santorini|mykonos|ibiza|palma|tenerife|madeira|cascais|biarritz|san sebastián|san sebastian/i
const WATERTOWN_CITY = /venice|venezia|amsterdam|bruges|brugge|ghent|gent|utrecht|leiden|delft|giethoorn|suzhou|wuzhen|zhouzhuang|tongli|xitang|nanxun|hangzhou|shaoxing|st\.? petersburg|saint petersburg|bangkok|hoi an|annecy|colmar|strasbourg|stockholm|hamburg|copenhagen|birmingham/i

/** The palette for a set of places, by what most of them are; the city's own
    name counts for more than any one of them. */
export function paletteFor(names: string[], city = ''): Palette {
  const score = { coastal: 0, watertown: 0, historic: 0, green: 0, market: 0 }
  if (COASTAL_CITY.test(city)) score.coastal += 4
  if (WATERTOWN_CITY.test(city)) score.watertown += 4
  for (const n of names) {
    if (COASTAL.test(n)) score.coastal += 2
    if (WATERTOWN.test(n)) score.watertown++
    if (HISTORIC.test(n)) score.historic++
    if (GREEN.test(n)) score.green++
    if (MARKET.test(n)) score.market++
  }
  const best = (Object.entries(score) as [keyof typeof score, number][]).sort((a, b) => b[1] - a[1])[0]
  return best && best[1] > 0 ? PALETTES[best[0]] : PALETTES.default
}
