import type { Budget, LatLon, Party, TransportWish, Wish } from '../types'
import { locate } from './geocode'
import { resolveTitles, type Article, type Rejected } from './wikipedia'
import { askJson } from './json'
import { metresBetween } from './geo'

/* SCOUT (LLM). Names the places worth flying to, from what the model knows,
   and code verifies every one: a name is looked up on Wikipedia and only kept if
   it is a real article with coordinates inside the area. The model supplies
   names and nothing else; every fact the guide later says comes from the text
   that lookup returned. `kind` feeds the Timekeeper's visit-length table.

   The brief is not a walking tour's. Orion's guide is a camera fifty-five
   metres up, moving: a place earns its slot by being legible from above and by
   having something around it worth turning towards. A famous interior with a
   dull roof is a bad stop here and a good one in a guidebook, and the prompt
   has to say so or the model will keep choosing the guidebook's answer. */

export const KINDS = ['viewpoint', 'monument', 'plaza', 'street', 'bridge', 'church', 'park', 'market', 'museum', 'other'] as const
export type Kind = typeof KINDS[number]
export type ScoutPick = { article: Article; why: string; kind: Kind; minutes?: number }

const SYSTEM = `You are the scout for a flight over a real city. A camera will fly to each
place you name, hold above it while a guide speaks, then fly on to the next.
You are choosing what is worth flying to.

ONLY WELL-KNOWN PLACES — this rule outranks every other
- Name only places a first-time visitor would already have heard of, or that sit
  on the first page of any guidebook or any "things to see in the city" list:
  the icons, the great landmarks, the famous squares, bridges, parks, cathedrals,
  palaces, castles, markets, avenues and viewpoints.
- Never name minor or obscure buildings, private mansions, embassies, ministries,
  offices, schools, hospitals, hotels, restaurants, shops, railway stations,
  individual statues or plaques nobody travels for, or a neighbourhood as such.
  If you would have to explain why anyone has heard of it, leave it out.
- Name a place only if you are certain it exists, and give the exact title of its
  English Wikipedia article ("Sainte-Chapelle", "Pont Neuf", "Musée d'Orsay").
  Every name is looked up, and one that cannot be found is thrown away, so a
  wrong guess costs a slot. If you are unsure of the exact title, choose another place.
- Fewer famous places beat a full list of obscure ones. List the most famous first.

WHAT MAKES A GOOD STOP HERE
- It reads from the air. A roofline, a dome, a tower, a bridge's span, the
  shape of a square, a park's edge against the streets, a river bend. If the
  only remarkable thing about a place is inside it, it is a weak stop no matter
  how famous it is; do not name it.
- It has surroundings. The guide can point the camera at things near a stop, so
  a place standing among other named things beats an equally good place alone.
- It is different from its neighbours in the list. Three churches is one stop
  repeated three times, whatever their names are.

HOW TO SPREAD THEM
- Spread the stops across the area, not strung along one street: no two stops
  closer together than about 300 metres.
- The order does not matter. A router settles that afterwards from real travel times.

THE DAY YOU ARE CHOOSING FOR
You are given the hours, how the person is getting about, who is travelling,
what they said interests them, and what the day may cost. Use them:
- Interests weight the choice; they do not dictate it. A day of nothing but the
  one thing asked for is a worse answer than a day built around it.
- With children, prefer open ground, water, animals, machines and things large
  enough to be impressive; avoid places whose whole point is quiet reverence.
- Taking it easy means fewer, closer, flatter, and near transport.
- "Free things only" rules out anywhere whose sight is behind a ticket desk.
- Short hours mean the set has to be small enough to be unhurried.

HOW LONG EACH TAKES
For every place, say how many minutes a visitor really spends there: a cathedral
is forty-five minutes to an hour, a big museum two to three hours, a viewpoint
twenty minutes, a market an hour with lunch. Be honest rather than generous.
Your estimates are checked against a table and clamped.

WHY
"why" says why this place suits THIS day: their interests, how it looks from
above, what stands around it. Twelve words at most. State no facts about the
place itself (dates, sizes, history): the guide will get those from a real source.

Reply with a JSON object, most famous first:
{"places":[{"title":"<exact English Wikipedia title>","why":"<max 12 words>","kind":"<one of: ${KINDS.join(', ')}>","minutes":<integer>}]}`

/** The parts of the desk the scout is shown. Everything here changes what it
    should choose; nothing here is passed on for decoration. */
export type ScoutWish = {
  interests?: string[]
  pace?: Wish['pace']
  transport?: TransportWish
  party?: Party
  budget?: Budget
  startAt?: string
  endAt?: string
}

export type ScoutBrief = {
  count: number
  /** How many days these places are for. Absent or 1: a single day. */
  days?: number
  wish?: ScoutWish
  /** Places the person named themselves; already in the day, never re-picked. */
  fixed?: { name: string; lat: number; lon: number }[]
  complaints?: string[]
  previous?: string[]
}

const PARTY_LINE: Record<Party, string> = {
  solo: 'travelling alone',
  couple: 'two adults together',
  family: 'adults with children',
  easy: 'taking it easy — limited walking, few stairs, nothing steep',
}
const BUDGET_LINE: Record<Budget, string> = {
  free: 'free things only — nothing behind a ticket desk',
  modest: 'the odd ticket is fine',
  any: 'cost is not a consideration',
}
const MOVE: Record<TransportWish, string> = {
  walk: 'on foot', cycle: 'by bicycle', transit: 'by public transport', drive: 'driving',
  auto: 'on foot where it is close, otherwise by whatever the budget allows',
}

const MIN_APART_M = 300
const ROUNDS = 2

export type ScoutResult = { picks: ScoutPick[]; rejected: Rejected[] }

/** Ask for more names than needed (some will not verify), look them all up, keep
    the first `count` that pass and stand apart, and ask once more for the
    shortfall, saying what was thrown away and why. */
export async function scout(brief: ScoutBrief & { city: string; origin: LatLon; radiusM: number }): Promise<ScoutResult> {
  const { count, days = 1, wish = {}, fixed = [], complaints = [], previous = [], city, origin, radiusM } = brief

  const day = [
    // Its brief speaks of "the day you are choosing for", and it was asked for thirty names under one day's hours.
    days > 1 ? `This is a trip of ${days} days, not one: these places are divided into ${days} days afterwards, about ${Math.ceil(count / days)} a day, so the set as a whole should have enough variety to make ${days} different days. The hours below are each day's.` : '',
    wish.startAt && wish.endAt ? `Hours: ${wish.startAt} to ${wish.endAt}${days > 1 ? ' each day' : ''}.` : '',
    wish.transport ? `Getting about: ${MOVE[wish.transport]}.` : '',
    wish.party ? `Who: ${PARTY_LINE[wish.party]}.` : '',
    wish.pace ? `Pace: ${wish.pace}.` : '',
    wish.budget ? `Budget: ${BUDGET_LINE[wish.budget]}.` : '',
    wish.interests?.length ? `Interests: ${wish.interests.join(', ')}.` : 'Interests: none given.',
  ].filter(Boolean).join('\n')

  const keep: ScoutPick[] = []
  const rejected: Rejected[] = []
  const named = new Set<string>()      // names already tried in this call, so a second round does not repeat them
  const placed = [...fixed]

  for (let round = 0; round < ROUNDS && keep.length < count; round++) {
    const need = count - keep.length
    const ask = need + Math.max(3, Math.ceil(need * 0.6))     // some names will not survive the lookup
    const user = `Name ${ask} places in ${city}, within about ${(radiusM / 1000).toFixed(0)} km of the centre. ` +
      `At least ${need} must be famous enough to survive the rule above.\n\n${day}` +
      (fixed.length
        ? `\n\nAlready in the day, named by the person and fixed — name things that sit well beside these, ` +
          `and never name the same place again under another title:\n${fixed.map(f => `- ${f.name}`).join('\n')}`
        : '') +
      (named.size ? `\n\nAlready named; do not repeat: ${[...named].join('; ')}` : '') +
      (rejected.length ? `\n\nThese names could not be used: ${rejected.map(r => `${r.title} (${r.reason})`).join('; ')}.` : '') +
      (complaints.length
        ? `\n\nYour previous set${previous.length ? ` (${previous.join('; ')})` : ''} was rejected for:\n- ${complaints.join('\n- ')}\n` +
          `Change only what is needed to fix this. Keep the famous places that were not the problem; if the day is too long, drop the ` +
          `slowest or least essential rather than swapping icons for lesser places.`
        : '')

    const { places } = await askJson<{ places: { title: string; why: string; kind: string; minutes?: number }[] }>('scout', SYSTEM, user, 4000)
    const asked = (places ?? []).filter(p => typeof p?.title === 'string' && p.title.trim() && !named.has(p.title.trim().toLowerCase()))
    asked.forEach(p => named.add(p.title.trim().toLowerCase()))
    if (!asked.length) break

    const near = async (title: string) => (await locate(title, origin).catch(() => null))
    const first = await resolveTitles(asked.map(p => p.title), origin, radiusM, near)
    const found = first.found
    let bad = first.rejected

    /* "Sacré-Cœur" is a disambiguation page and "Notre-Dame" is a dozen churches;
       the article is usually "Sacré-Cœur, Paris". Try the city on the end before giving up. */
    const again = bad.filter(r => /no such|disambiguation/.test(r.reason))
    if (again.length) {
      const variant = new Map(again.map(r => [`${r.title}, ${city}`, r.title]))
      const second = await resolveTitles([...variant.keys()], origin, radiusM, near)
      for (const f of second.found) found.push({ asked: variant.get(f.asked)!, article: f.article })
      const won = new Set(second.found.map(f => variant.get(f.asked)))
      bad = bad.filter(r => !won.has(r.title))
    }
    rejected.push(...bad)
    const meta = new Map(asked.map(p => [p.title.trim(), p]))
    // In the model's order, which is most famous first.
    for (const p of asked) {
      const hit = found.find(f => f.asked === p.title.trim())
      if (!hit || keep.length >= count) continue
      const { article } = hit
      if (keep.some(k => k.article.pageId === article.pageId)) continue
      if (placed.some(q => metresBetween(q, article) < MIN_APART_M)) { rejected.push({ title: p.title, reason: 'too close to a stop already chosen' }); continue }
      placed.push({ name: article.title, lat: article.lat, lon: article.lon })
      const m = meta.get(p.title.trim())!
      keep.push({
        article, why: String(m.why ?? '').trim(),
        kind: (KINDS as readonly string[]).includes(m.kind) ? m.kind as Kind : 'other',
        minutes: Number.isFinite(Number(m.minutes)) ? Number(m.minutes) : undefined,
      })
    }
  }
  if (!keep.length) throw new Error(`The scout could not name well-known places in ${city} that it could verify.`)
  return { picks: keep, rejected }
}

/* ---------------------------------------------------------------- anchoring */

const NEAR_SYSTEM = `A person planning a day over a city has put a pin on the map. The pin is not
on anything notable — it may be a street corner, a hotel, a station, or just a
patch of ground they clicked. You are given the places with Wikipedia articles
nearby, each with its distance from that pin.

Choose the ONE that best honours what they meant by pinning there. Judge by:
- Distance first. They pointed at a spot; something 150 m away is still that
  spot, something 700 m away is a different part of town and needs to be much
  better to be worth it.
- Whether it reads from the air. The camera will fly to it and hold above it,
  so a roofline, a span, a square or a park beats an interior.
- What they said interests them, and who is travelling with them.
- Whether it is plainly the thing they were pointing at. A pin on a station
  forecourt beside a famous tower almost certainly meant the tower.

If nothing nearby is worth flying to — the honest answer in a quiet
neighbourhood — reply with {"id": null} and a reason. Do not reach for
something a kilometre away to avoid saying no.

Reply with a JSON object: {"id":"<catalogue id or null>","why":"<max 14 words: why this one, or why nothing>","kind":"<one of: ${KINDS.join(', ')}>"}`

export type NearChoice = { article: Article; why: string; kind: Kind } | { article: null; why: string }

/** The nearest thing worth flying to, for a pin that landed on nothing. */
export async function nearestWorthIt(
  pinned: string, nearby: Article[], wish: ScoutWish = {},
): Promise<NearChoice> {
  if (!nearby.length) return { article: null, why: 'nothing with an article stands near that pin' }
  const byId = new Map(nearby.map(a => [`n${a.pageId}`, a]))
  const lines = nearby.map(a =>
    `n${a.pageId} | ${Math.round(a.distM)} m away | ${a.title} | ${a.extract.replace(/\s+/g, ' ').slice(0, 160)}`)
  const user = `They pinned: ${pinned}\n` +
    (wish.interests?.length ? `Interested in: ${wish.interests.join(', ')}.\n` : '') +
    (wish.party ? `Who: ${PARTY_LINE[wish.party]}.\n` : '') +
    (wish.budget ? `Budget: ${BUDGET_LINE[wish.budget]}.\n` : '') +
    `\nNearby:\n${lines.join('\n')}`

  const r = await askJson<{ id: string | null; why?: string; kind?: string }>('scout', NEAR_SYSTEM, user, 1200)
  const article = r.id ? byId.get(r.id) : null
  if (!article) return { article: null, why: String(r.why ?? 'nothing nearby was worth the detour').trim() }
  return {
    article, why: String(r.why ?? '').trim(),
    kind: (KINDS as readonly string[]).includes(r.kind ?? '') ? r.kind as Kind : 'other',
  }
}
