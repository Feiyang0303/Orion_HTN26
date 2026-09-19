import type { Budget, Party, Transport, Wish } from '../types'
import type { Article } from './wikipedia'
import { askJson } from './json'
import { metresBetween } from './geo'

/* SCOUT (LLM). Chooses which places belong in the day, from the supplied
   catalogue only. `kind` feeds the Timekeeper's visit-length table.

   The brief is not a walking tour's. Orion's guide is a camera fifty-five
   metres up, moving: a place earns its slot by being legible from above and by
   having something around it worth turning towards. A famous interior with a
   dull roof is a bad stop here and a good one in a guidebook, and the prompt
   has to say so or the model will keep choosing the guidebook's answer. */

export const KINDS = ['viewpoint', 'monument', 'plaza', 'street', 'bridge', 'church', 'park', 'market', 'museum', 'other'] as const
export type Kind = typeof KINDS[number]
export type ScoutPick = { article: Article; why: string; kind: Kind }

const SYSTEM = `You are the scout for a flight over a real city. A camera will fly to each
place you choose, hold above it while a guide speaks, then fly on to the next.
You are choosing what is worth flying to.

WHAT MAKES A GOOD STOP HERE
- It reads from the air. A roofline, a dome, a tower, a bridge's span, the
  shape of a square, a park's edge against the streets, a river bend. If the
  only remarkable thing about a place is inside it, it is a weak stop no matter
  how famous it is — say so by not choosing it.
- It has surroundings. The guide can point the camera at things near a stop, so
  a place standing among other named things beats an equally good place alone
  in a suburb.
- It is different from its neighbours in the list. Three churches is one stop
  repeated three times, whatever their names are.

HOW TO SPREAD THEM
- The stops should be spread across the area, not strung along one street.
  Every stop you add should be a noticeable distance from the ones already
  chosen — as a rule, no two stops closer together than about 300 metres.
- The order does not matter. A router settles that afterwards from real travel
  times, so choose the best set and ignore the sequence.

THE DAY YOU ARE CHOOSING FOR
You are given the hours, how the person is getting about, who is travelling,
what they said interests them, and what the day may cost. Use them:
- Interests weight the choice; they do not dictate it. A day of nothing but the
  one thing asked for is a worse answer than a day built around it.
- With children, prefer open ground, water, animals, machines and things large
  enough to be impressive; avoid places whose whole point is quiet reverence.
- Taking it easy means fewer, closer, flatter, and near transport.
- "Free things only" rules out anywhere whose sight is behind a ticket desk.
- Short hours mean the set has to be small enough to be unhurried; you are not
  told to fill the day.

HONESTY
- Choose only ids from the catalogue. Never invent a place, a name or an id.
- The "why" must be specific to this place and drawn from what the catalogue
  entry actually says — not a generic compliment. Twelve words at most.
- If the area genuinely does not hold enough good places, choose fewer than
  asked. A padded day is worse than a short one.

Reply with a JSON object:
{"picks":[{"id":"<catalogue id>","why":"<max 12 words, specific>","kind":"<one of: ${KINDS.join(', ')}>"}]}`

/** The parts of the desk the scout is shown. Everything here changes what it
    should choose; nothing here is passed on for decoration. */
export type ScoutWish = {
  interests?: string[]
  pace?: Wish['pace']
  transport?: Transport
  party?: Party
  budget?: Budget
  startAt?: string
  endAt?: string
}

export type ScoutBrief = {
  count: number
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
const MOVE: Record<Transport, string> = {
  walk: 'on foot', cycle: 'by bicycle', transit: 'by public transport', drive: 'driving',
}

export async function scout(catalogue: Article[], brief: ScoutBrief): Promise<ScoutPick[]> {
  const { count, wish = {}, fixed = [], complaints = [], previous = [] } = brief
  const byId = new Map(catalogue.map(a => [`c${a.pageId}`, a]))
  const lines = catalogue.map(a =>
    `c${a.pageId} | ${a.title} | ${Math.round(a.distM)} m from centre | ${a.extract.replace(/\s+/g, ' ').slice(0, 170)}`)

  const day = [
    wish.startAt && wish.endAt ? `Hours: ${wish.startAt} to ${wish.endAt}.` : '',
    wish.transport ? `Getting about: ${MOVE[wish.transport]}.` : '',
    wish.party ? `Who: ${PARTY_LINE[wish.party]}.` : '',
    wish.pace ? `Pace: ${wish.pace}.` : '',
    wish.budget ? `Budget: ${BUDGET_LINE[wish.budget]}.` : '',
    wish.interests?.length ? `Interests: ${wish.interests.join(', ')}.` : 'Interests: none given.',
  ].filter(Boolean).join('\n')

  const user = `Choose ${count} stop${count === 1 ? '' : 's'}.\n\n${day}` +
    (fixed.length
      ? `\n\nAlready in the day, named by the person and fixed — choose things that sit well beside these, ` +
        `and never choose the same place again under another name:\n` +
        fixed.map(f => `- ${f.name}`).join('\n')
      : '') +
    `\n\nCatalogue:\n${lines.join('\n')}` +
    (complaints.length
      ? `\n\nYour previous set (${previous.join(', ')}) was rejected for:\n- ${complaints.join('\n- ')}\nFix these; keep what was not complained about.`
      : '')

  const { picks } = await askJson<{ picks: { id: string; why: string; kind: string }[] }>('scout', SYSTEM, user, 4000)

  /* The spread rule is checked here rather than trusted. A model asked not to
     cluster will still cluster, and this is three lines of arithmetic. */
  const MIN_APART_M = 300
  const keep: ScoutPick[] = []
  const placed = [...fixed]
  const seen = new Set<string>()
  for (const p of picks ?? []) {
    const article = byId.get(p.id)
    if (!article || seen.has(p.id)) continue      // ids not in the catalogue are ignored, never trusted
    if (placed.some(q => metresBetween(q, article) < MIN_APART_M)) continue
    seen.add(p.id)
    placed.push({ name: article.title, lat: article.lat, lon: article.lon })
    keep.push({
      article, why: String(p.why ?? '').trim(),
      kind: (KINDS as readonly string[]).includes(p.kind) ? p.kind as Kind : 'other',
    })
  }
  if (!keep.length) throw new Error('The scout could not find enough good places nearby.')
  return keep.slice(0, count)
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
