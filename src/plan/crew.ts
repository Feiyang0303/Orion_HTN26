import type { Leg, Waypoint, Wish } from '../types'
import type { Agent, CrewEvent } from './events'
import { notable, type Article } from './wikipedia'
import { scout, type Kind, type ScoutPick } from './scout'
import { critic } from './critic'
import { audit, visitMinutes, windowOf } from './timekeeper'
import { metresBetween, slug } from './geo'

/* The half of the crew that decides *what the day is*, pulled out of the
 * pipeline so the planning page can run it a step at a time and draw each step
 * on the map. The other half — reading up, writing, speaking — stays in
 * pipeline.ts and runs once the shape of the day is settled.
 *
 * Nothing here is interactive on its own; it is the same code the headless
 * fixture script runs, called in smaller pieces.
 */

export const RADIUS_M = 2500        // the compact area a day is drawn from
const WANT_MATCH_M = 260            // how near an article must sit to be *this* place

/** One place in the day, however it got there. */
export type Candidate = {
  id: string
  name: string
  lat: number
  lon: number
  kind: Kind
  why: string
  /** The person named it. Never dropped, never overruled by the Critic. */
  asked: boolean
  /** What Wikipedia has, if anything. Null means the guide will have only the
      surroundings to talk about. */
  article: Article | null
  visitMin: number
}

/* A named place has to be timed too, and the Scout never saw it. The name is
   the only evidence there is, so the guess is made from the name and nothing
   else — the same rule the book's marginal sketches follow. */
const KIND_RULES: [RegExp, Kind][] = [
  [/cathedral|church|basilica|chapel|abbey|minster|synagogue|mosque|temple|monastery|shrine|jinja|-ji$/i, 'church'],
  [/museum|gallery|collection|pinacoteca|kunsthalle/i, 'museum'],
  [/market|bazaar|arcade|halles|mercado|ichiba/i, 'market'],
  [/park|garden|common|arboretum|botanic|meadow|forest/i, 'park'],
  [/bridge|viaduct|aqueduct/i, 'bridge'],
  [/tower|viewpoint|lookout|belvedere|hill|peak|summit|castle/i, 'viewpoint'],
  [/square|plaza|piazza|place |platz|circus/i, 'plaza'],
  [/street|avenue|boulevard|promenade|quay|lane|dori|gai$/i, 'street'],
  [/monument|memorial|statue|column|obelisk|arch|gate|torii/i, 'monument'],
]
export const guessKind = (name: string): Kind => KIND_RULES.find(([r]) => r.test(name))?.[1] ?? 'other'

/** What Wikipedia knows about the area, most-read first. The one network call
    the whole planning page shares. */
export async function catalogueFor(origin: { lat: number; lon: number }, radiusM = RADIUS_M) {
  return (await notable(origin, radiusM, 40)).filter(a => a.extract.length > 80)
}

/** A place the person pinned, matched to the article standing on the same spot
    if there is one. The pin's own coordinate always wins — the person put it
    there — but the article is what the guide will have to read from. */
export async function matchWant(w: Waypoint, catalogue: Article[], taken: Set<number>, wish: Wish): Promise<Candidate> {
  let article = catalogue.find(a => !taken.has(a.pageId) && metresBetween(a, w) < WANT_MATCH_M) ?? null
  if (!article) {
    const near = await notable(w, WANT_MATCH_M, 1, 20).catch(() => [])
    article = near[0] ?? null
  }
  if (article) taken.add(article.pageId)
  const kind = guessKind(article?.title ?? w.name)
  return {
    id: slug(w.name), name: w.name, lat: w.lat, lon: w.lon, kind,
    why: 'you asked for it by name', asked: true, article,
    visitMin: visitMinutes(kind, wish.pace, wish.party),
  }
}

export const fromPick = (p: ScoutPick, wish: Wish): Candidate => ({
  id: slug(p.article.title), name: p.article.title, lat: p.article.lat, lon: p.article.lon,
  kind: p.kind, why: p.why, asked: false, article: p.article,
  visitMin: visitMinutes(p.kind, wish.pace, wish.party),
})

/** How many more places the day has room for, given what is pinned already. */
export const roomFor = (mode: 'full' | 'short', pinned: number) =>
  Math.max(0, (mode === 'short' ? 3 : 5) - pinned)

/** Scout, then Critic, with one round of rework at most. Returns only the
    found places; the pinned ones are passed in as fixed and come back
    untouched. */
export async function findStops(opts: {
  catalogue: Article[]
  wish: Wish
  mode: 'full' | 'short'
  fixed: Candidate[]
  count: number
  onEvent?: (e: CrewEvent) => void
  /** Travel seconds between the whole set, when known, so the Timekeeper can
      complain about a day that does not fit before the Critic is asked. */
  legSecs?: (all: Candidate[]) => Promise<number[]>
}): Promise<Candidate[]> {
  const { catalogue, wish, fixed, count, onEvent = () => {}, legSecs } = opts
  const say = (agent: Agent, kind: 'tool' | 'agent', state: 'working' | 'done' | 'reworking' | 'failed', detail: string) =>
    onEvent({ type: 'crew', agent, kind, state, detail })

  if (!count) { say('Scout', 'agent', 'done', 'The day is the places you named.'); return [] }

  const pool = catalogue.filter(a => !fixed.some(f => metresBetween(f, a) < WANT_MATCH_M))
  if (pool.length < 2) throw new Error('Wikipedia knows too little about this area to add anything to the day.')

  const window = windowOf(wish)
  let picks: ScoutPick[] = []
  let complaints: string[] = []

  for (let attempt = 0; attempt < 2; attempt++) {
    say('Scout', 'agent', attempt ? 'reworking' : 'working',
      attempt ? 'Choosing again to fix: ' + complaints.join('; ')
              : `Choosing ${count} from the ${pool.length} most-read places nearby`)
    picks = await scout(pool, {
      count, wish,
      fixed: fixed.map(f => ({ name: f.name, lat: f.lat, lon: f.lon })),
      complaints, previous: picks.map(p => p.article.title),
    })
    say('Scout', 'agent', 'done', picks.map(p => p.article.title).join(' · '))
    if (attempt) break

    const all = [...fixed, ...picks.map(p => fromPick(p, wish))]
    const secs = legSecs ? await legSecs(all).catch(() => []) : []
    const t = audit(all.map(c => c.visitMin), secs, window, wish.transport, wish.meals)
    say('Timekeeper', 'tool', t.complaints.length ? 'failed' : 'done',
      t.complaints.join('; ') ||
      `${Math.round(t.totalMin)} min in all${t.mealMin ? `, ${t.mealMin} of them at the table` : ''}, inside ${wish.startAt}–${wish.endAt}`)
    complaints = t.complaints

    if (!complaints.length) {
      say('Critic', 'agent', 'working', 'Reviewing the day')
      const review = await critic(summarise(all, secs, wish))
      // A place the person named is not the Critic's to reject.
      const fair = review.complaints.filter(c => !all.some(s => s.asked && c.toLowerCase().includes(s.name.toLowerCase())))
      say('Critic', 'agent', fair.length ? 'failed' : 'done', fair.join('; ') || 'Approved')
      complaints = fair
    }
    if (!complaints.length) break
  }
  return picks.map(p => fromPick(p, wish))
}

function summarise(all: Candidate[], legSecs: number[], wish: Wish) {
  const lines = all.map((c, i) =>
    `${i + 1}. ${c.id} | ${c.name} | kind: ${c.kind} | ${c.visitMin} min there | ` +
    (c.asked ? 'ASKED FOR BY NAME — not yours to reject' : c.why) +
    (legSecs[i] ? `\n   then ${Math.round(legSecs[i] / 60)} min ${wish.transport} to the next` : ''))
  return [
    `Hours: ${wish.startAt} to ${wish.endAt}. Getting about: ${wish.transport}. Pace: ${wish.pace}.`,
    `Who: ${wish.party}. Budget: ${wish.budget}.`,
    wish.meals.length ? `Keeping time clear for: ${wish.meals.join(' and ')}.` : 'No meal breaks asked for.',
    wish.interests.length ? `They asked for: ${wish.interests.join(', ')}.` : 'No interests given.',
    '',
    lines.join('\n'),
  ].join('\n')
}

/** The whole shape of a day, settled, ready to be written up. */
export type Skeleton = {
  wish: Wish
  mode: 'full' | 'short'
  origin: Waypoint
  from: Waypoint | null
  stops: Candidate[]     // in visiting order
  legs: Leg[]            // stops[i] -> stops[i+1]
  approach: Leg | null   // from -> stops[0]
}
