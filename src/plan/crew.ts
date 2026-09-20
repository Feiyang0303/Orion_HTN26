import type { LatLon, Leg, Waypoint, Wish } from '../types'
import type { Agent, CrewEvent } from './events'
import { verdict } from './events'
import { notable, type Article } from './wikipedia'
import { nearestWorthIt, scout, type Kind, type NearChoice, type ScoutPick } from './scout'
import { critic } from './critic'
import { audit, mealsInside, visitMinutes, windowOf } from './timekeeper'
import { metresBetween, slug } from './geo'

/* The half of the crew that decides *what the day is*, pulled out of the
 * pipeline so the planning page can run it a step at a time and draw each step
 * on the map. The other half — reading up, writing, speaking — stays in
 * pipeline.ts and runs once the shape of the day is settled.
 *
 * Nothing here is interactive on its own; it is the same code the headless
 * fixture script runs, called in smaller pieces.
 */

/** How far from the centre a trip may reach: a day stays compact, a longer trip goes further. */
export const tripRadius = (days: number) => Math.min(9500, 4000 + Math.max(1, days) * 1500)
const WANT_MATCH_M = 260            // how near an article must sit to be *this* place
const WANT_LOOK_M = 750             // how far to look around a pin that landed on nothing

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
  /** Set when the pin landed on nothing and the day stands somewhere else
      instead: what was pinned, and how far away the stop ended up. */
  askedAs?: string
  movedM?: number
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


/** A place the person pinned, resolved to something the day can actually fly
    to. Three ways that goes:
 *
 *   on the nose   an article stands on the same spot — the pin *is* that place,
 *                 and its own coordinate is kept, because they put it there.
 *   moved         the pin is on a corner, a hotel, a station, a patch of
 *                 ground. The crew looks around it and a model picks the
 *                 nearest thing worth flying to; the stop moves there and the
 *                 book says so, with the distance. Quietly relocating someone's
 *                 own choice would be the worst kind of helpful.
 *   as pinned     nothing nearby is worth it. The pin stays, the guide will
 *                 have only its surroundings to talk about, and the book says
 *                 that too.
 */
export async function matchWant(
  w: Waypoint, taken: Set<number>, wish: Wish,
  onEvent?: (e: CrewEvent) => void,
): Promise<Candidate> {
  const say = (state: 'working' | 'done' | 'failed', detail: string) =>
    onEvent?.({ type: 'crew', agent: 'Scout', kind: 'agent', state, detail })

  const here = await notable(w, WANT_MATCH_M, 6, 40).catch(() => [])
  const onTheNose = here.find(a => !taken.has(a.pageId) && a.extract.length > 80) ?? null
  if (onTheNose) {
    taken.add(onTheNose.pageId)
    const kind = guessKind(onTheNose.title)
    return {
      id: slug(w.name), name: w.name, lat: w.lat, lon: w.lon, kind,
      why: 'you asked for it by name', asked: true, article: onTheNose,
      visitMin: visitMinutes(kind, wish.pace, wish.party),
    }
  }

  // Nothing on the spot. Look around it, and let the model judge what the pin
  // was reaching for.
  say('working', `Nothing notable exactly at ${w.name} — looking around it`)
  const nearby = (await notable(w, WANT_LOOK_M, 12, 80).catch(() => []))
    .filter(a => !taken.has(a.pageId) && a.extract.length > 80)
  const nothing: NearChoice = { article: null, why: '' }
  const choice = await nearestWorthIt(w.name, nearby, wish).catch(() => nothing)

  const found = choice.article
  if (found) {
    taken.add(found.pageId)
    const moved = Math.round(metresBetween(w, found))
    const kind = 'kind' in choice ? choice.kind : guessKind(found.title)
    say('done', `${w.name} → ${found.title}, ${moved} m away: ${choice.why}`)
    return {
      id: slug(found.title), name: found.title,
      lat: found.lat, lon: found.lon, kind,
      why: choice.why || `the nearest thing worth flying to from ${w.name}`,
      asked: true, article: choice.article,
      visitMin: visitMinutes(kind, wish.pace, wish.party),
      askedAs: w.name, movedM: moved,
    }
  }

  say('failed', `Nothing worth flying to near ${w.name} — keeping your pin as it is`)
  const kind = guessKind(w.name)
  return {
    id: slug(w.name), name: w.name, lat: w.lat, lon: w.lon, kind,
    why: choice.why || 'you asked for it by name', asked: true, article: null,
    visitMin: visitMinutes(kind, wish.pace, wish.party),
  }
}

export const fromPick = (p: ScoutPick, wish: Wish): Candidate => ({
  id: slug(p.article.title), name: p.article.title, lat: p.article.lat, lon: p.article.lon,
  kind: p.kind, why: p.why, asked: false, article: p.article,
  visitMin: visitMinutes(p.kind, wish.pace, wish.party, p.minutes),
})

/** How many more places the day has room for, given what is pinned already. */
export const roomFor = (mode: 'full' | 'short', pinned: number) =>
  Math.max(0, (mode === 'short' ? 3 : 5) - pinned)

/** Scout, then Critic, with one round of rework at most. Returns only the
    found places; the pinned ones are passed in as fixed and come back
    untouched. */
export async function findStops(opts: {
  city: string
  origin: LatLon
  radiusM: number
  wish: Wish
  mode: 'full' | 'short'
  fixed: Candidate[]
  count: number
  onEvent?: (e: CrewEvent) => void
  /** Travel seconds between the whole set, when known, so the Timekeeper can
      complain about a day that does not fit before the Critic is asked. */
  legSecs?: (all: Candidate[]) => Promise<number[]>
}): Promise<Candidate[]> {
  const { city, origin, radiusM, wish, mode, fixed, count, onEvent = () => {}, legSecs } = opts
  const say = (agent: Agent, kind: 'tool' | 'agent', state: 'working' | 'done' | 'reworking' | 'failed', detail: string) =>
    onEvent({ type: 'crew', agent, kind, state, detail })

  if (!count) { say('Scout', 'agent', 'done', 'The day is the places you named.'); return [] }

  // These places are the whole trip's, not one day's: a three-day trip has three
  // days of hours and three days of meals to fit them into.
  const days = Math.max(1, wish.days || 1)
  const day = windowOf(wish)
  const window = { startMin: day.startMin, endMin: day.startMin + (day.endMin - day.startMin) * days }
  // Only the meals that fall inside the hours. The day is sized without dinner (timekeeper.visitBudgetMin: a day that
  // ends at six does not pay for a dinner at half past), but it was judged with it: seventy-five minutes a day the
  // places never had, which was enough on its own to send nearly every first set back to the Scout to be cut.
  const meals = Array.from({ length: days }).flatMap(() => mealsInside(wish.meals, day))
  let picks: ScoutPick[] = []
  let want = count          // how many the Scout is asked for: fewer on the second pass, if the first did not fit
  let complaints: string[] = []

  // Scout proposes, Timekeeper and Judger object, Scout tries again. The last
  // pass is still judged so leftover errors stay on the board instead of vanishing.
  for (let attempt = 0; attempt < 2; attempt++) {
    const last = attempt === 1
    say('Scout', 'agent', attempt ? 'reworking' : 'working',
      attempt ? 'Choosing again to fix: ' + complaints.join('; ') : `Naming ${count} well-known place${count === 1 ? '' : 's'} in ${city}`)
    const chosen = await scout({
      count: want, wish, city, origin, radiusM, days,
      fixed: fixed.map(f => ({ name: f.name, lat: f.lat, lon: f.lon })),
      complaints, previous: picks.map(p => p.article.title),
    })
    picks = chosen.picks
    if (chosen.rejected.length) say('Scout', 'agent', 'working',
      `${chosen.rejected.length} suggestion${chosen.rejected.length === 1 ? '' : 's'} could not be verified and ${chosen.rejected.length === 1 ? 'was' : 'were'} dropped: ` +
      chosen.rejected.slice(0, 4).map(r => `${r.title} (${r.reason})`).join('; '))
    say('Scout', 'agent', 'done', picks.map(p => p.article.title).join(' · '))

    const all = [...fixed, ...picks.map(p => fromPick(p, wish))]
    const secs = legSecs ? await legSecs(all).catch(() => []) : []
    const t = audit(all.map(c => c.visitMin), secs, window, wish.transport === 'auto' ? 'transit' : wish.transport, meals)
    // The sum is over every day of the trip, and said "the day takes 1,480 min": to the person, and to the Scout it is
    // sent back to, that read as three days of places being held to one day's hours.
    if (days > 1) t.complaints = t.complaints.map(c => c.replace('the day takes', `the ${days} days take`).replace('but the window is', `but their hours come to`))
    const clockIssues = t.complaints.map((text, i) => ({ id: `time-${i}`, text, owner: 'Scout' as const }))
    onEvent(verdict('Timekeeper', 'day', clockIssues))
    say('Timekeeper', 'tool', t.complaints.length ? 'failed' : 'done',
      t.complaints.join('; ') ||
      `${Math.round(t.totalMin)} min in all${t.mealMin ? `, ${t.mealMin} of them at the table` : ''}, inside ${wish.startAt}–${wish.endAt}`)

    if (t.complaints.length) {
      complaints = t.complaints
      /* Too long means fewer places, and it has to be the count that says so. The Scout was told to drop the least
         essential and asked, in the same breath, for the same number as before; the first that many were kept, so
         nothing was ever dropped and the clock shrank every visit instead. It is asked for as many fewer as the
         overrun is worth (a visit and the getting there), and still chooses which. */
      if (t.slackMin < 0 && all.length) {
        const each = all.reduce((n, c) => n + c.visitMin, 0) / all.length + 15
        want = Math.max(Math.min(want, 2 * days), want - Math.max(1, Math.ceil(-t.slackMin / each)))
      }
      if (last) break
      continue
    }

    say('Critic', 'agent', 'working', 'Judging the day')
    const review = await critic(summarise(all, secs, wish, mode, days))
    // A place the person named is not the Judger's to reject.
    const fair = review.complaints.filter(c => !all.some(s => s.asked && c.text.toLowerCase().includes(s.name.toLowerCase())))
    onEvent(verdict('Critic', 'day', fair.map((c, i) => ({ id: `judge-${i}`, text: c.text, owner: c.owner }))))
    say('Critic', 'agent', fair.length ? 'failed' : 'done', fair.map(c => c.text).join('; ') || 'Approved')
    complaints = fair.map(c => c.text)
    if (!complaints.length || last) break
  }
  return picks.map(p => fromPick(p, wish))
}

function summarise(all: Candidate[], legSecs: number[], wish: Wish, mode: 'full' | 'short', days: number) {
  const lines = all.map((c, i) =>
    `${i + 1}. ${c.id} | ${c.name} | kind: ${c.kind} | ${c.visitMin} min there | ` +
    (c.asked ? 'ASKED FOR BY NAME — not yours to reject' : c.why))
  // The journeys are those of the best order found, which is not the order of this list: written after each place as
  // "then 12 min to the next", they described trips nobody would make. Their sum is true of any order, and is what is said.
  const travelMin = Math.round(legSecs.reduce((a, b) => a + b, 0) / 60)
  return [
    // The Judger reviews "a proposed day", and was shown all twenty-one places of a three-day trip under one day's hours
    // with nothing to say it was three days: it rejected them as exhausting, every time, and the Scout cut the trip down.
    ...(days > 1 ? [`This is NOT one day. It is the pool of places for a TRIP OF ${days} DAYS, about ${Math.ceil(all.length / days)} places a day; they are divided into days afterwards, by where they are. The hours below are EACH day's hours. Judge the set as a whole: whether it answers what they asked for, whether the places differ, whether each is worth flying to. Do not object that it is too much for one day, or too long: it is ${days} days, and the clock has already been checked.`] : []),
    // Asked for, not an oversight: without this the Judger sends a quick tour back for being short, every time.
    ...(mode === 'short' ? ['This is a QUICK TOUR: a few stops on purpose, however many hours there are. Do not object that the day is short, light, or has time to spare, and do not ask for more places.'] : []),
    `Hours: ${wish.startAt} to ${wish.endAt}${days > 1 ? ' each day' : ''}. Getting about: ${wish.transport}. Pace: ${wish.pace}.`,
    `Who: ${wish.party}. Budget: ${wish.budget}.`,
    wish.meals.length ? `Keeping time clear for: ${wish.meals.join(' and ')}${days > 1 ? ' each day' : ''}.` : 'No meal breaks asked for.',
    wish.interests.length ? `They asked for: ${wish.interests.join(', ')}.` : 'No interests given.',
    ...(travelMin ? [`Getting between them, in the best order found: about ${travelMin} min${days > 1 ? ` over the ${days} days` : ''}.`] : []),
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
  back?: Leg | null      // stops[last] -> from
  /** Where this day sits in the trip. Absent means a day on its own, which is
      what the headless planner makes. The guide's two ends need it: a day with
      more to come does not end the way the last one does. */
  day?: { number: number; count: number; title?: string; nextTitle?: string }
}
