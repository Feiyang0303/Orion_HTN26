import type { LatLon, Meal, Stay, Table, Wish } from '../types'
import { BUDGET_LABEL, LODGING_LABEL, PARTY_LABEL } from '../types'
import { askJson } from './json'
import { addressOf, beds, describe, tables as osmTables, type OsmPlace } from './osm'
import { metresBetween } from './geo'
import type { Candidate } from './crew'

/* The three decisions a trip needs that a single day never did: which places
 * belong to which day, where you sleep, and where you eat.
 *
 * All three are model calls over a supplied list, never open questions. The
 * day-shaper may only use the stops it is given; the concierge and the
 * table-setter may only choose from what OpenStreetMap actually has within
 * walking distance. A model asked "recommend a hotel in Kyoto" answers from
 * memory, and memory closes restaurants, renames hotels and invents addresses.
 */

/* ------------------------------------------------------------ the day shape */

const SHAPE_SYSTEM = `You are laying out a multi-day trip. You are given every place the scout chose,
with its position, what kind of thing it is, and why it was chosen. Split them
into the requested number of days.

HOW TO SPLIT
- Geography first. A day should be walkable as a cluster; the worst possible
  split sends someone back and forth across the city on consecutive days.
- Balance the count, but not slavishly: a day around one enormous park and a
  day of four small squares are both fine days.
- Vary the days. If two churches were chosen, they should not both land on the
  same morning. Each day should have a different centre of gravity.
- Shape the arc. The first day should be the one that orients someone in the
  city; the last should be the one worth ending on.
- Every place appears exactly once, and none is left out.

NAMING
Give each day a short title of three to six words, drawn from what is actually
in it — "The river and the old bridge", not "Cultural highlights". No colons,
no "Day 1:".

Reply with a JSON object:
{"days":[{"title":"<3-6 words>","ids":["<stop id>", ...],"why":"<max 14 words: what makes this a day>"}]}`

export type DayShape = { title: string; ids: string[]; why: string }

export async function shapeDays(all: Candidate[], count: number, wish: Wish): Promise<DayShape[]> {
  if (count <= 1) return [{ title: 'The day', ids: all.map(c => c.id), why: '' }]
  const lines = all.map(c =>
    `${c.id} | ${c.name} | ${c.kind} | ${c.lat.toFixed(4)},${c.lon.toFixed(4)} | ${c.asked ? 'ASKED FOR BY NAME' : c.why}`)
  const user = [
    `${count} days. ${all.length} places.`,
    `Hours each day: ${wish.startAt} to ${wish.endAt}. Getting about: ${wish.transport}. Pace: ${wish.pace}.`,
    `Who: ${PARTY_LABEL[wish.party]}.`,
    wish.interests.length ? `Interests: ${wish.interests.join(', ')}.` : '',
    '',
    lines.join('\n'),
  ].filter(Boolean).join('\n')

  const r = await askJson<{ days: DayShape[] }>('scout', SHAPE_SYSTEM, user, 3000)

  /* Trust nothing: unknown ids are dropped, duplicates keep their first day,
     and anything the model forgot is handed to the nearest day by distance so
     no chosen place quietly disappears from the trip. */
  const byId = new Map(all.map(c => [c.id, c]))
  const used = new Set<string>()
  const days: DayShape[] = (r.days ?? []).slice(0, count).map((d, i) => ({
    title: String(d.title ?? `Day ${i + 1}`).trim().slice(0, 60),
    why: String(d.why ?? '').trim(),
    ids: (d.ids ?? []).filter(id => byId.has(id) && !used.has(id) && used.add(id) !== undefined),
  }))
  while (days.length < count) days.push({ title: `Day ${days.length + 1}`, ids: [], why: '' })

  for (const c of all) {
    if (used.has(c.id)) continue
    const centre = (d: DayShape) => {
      const pts = d.ids.map(id => byId.get(id)!).filter(Boolean)
      if (!pts.length) return null
      return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length }
    }
    const best = days.reduce((a, b) => {
      const ca = centre(a), cb = centre(b)
      if (!ca) return a
      if (!cb) return b
      return metresBetween(ca, c) <= metresBetween(cb, c) ? a : b
    })
    best.ids.push(c.id)
    used.add(c.id)
  }
  return days
}

/* -------------------------------------------------------------- the bedroom */

const BED_SYSTEM = `You are choosing where someone sleeps on a trip. You are given a list of real
places from OpenStreetMap — everything it knows within walking distance of the
places they will be visiting — and, for each, its distance from the centre of
those places and whatever tags it carries.

Choose up to three, best first. Judge only on what you are shown:
- How central it is to the days they will actually be having. That is the one
  thing you can measure and the one thing that matters most.
- The sort of bed they asked for, and who is travelling.
- Tags that genuinely bear on the choice: stars, wheelchair access, the street
  it stands on.

HARD RULES
- Choose only from the list. Never name a hotel that is not in it.
- Say nothing about price, quality, breakfast, service, views or atmosphere.
  You have not been told any of those and OpenStreetMap does not know them. A
  self-declared star count may be mentioned as self-declared.
- The reason must cite something you were actually shown.

Reply with a JSON object: {"picks":[{"id":"<id>","why":"<max 16 words, citing what you were shown>"}]}`

export async function chooseBeds(
  centre: LatLon, wish: Wish, dayNames: string[], signal?: AbortSignal,
): Promise<{ stays: Stay[]; looked: number }> {
  const kinds = wish.lodging === 'any'
    ? ['hotel', 'hostel', 'guest_house', 'apartment']
    : [wish.lodging === 'guesthouse' ? 'guest_house' : wish.lodging]
  let found = await beds(centre, 1600, kinds, signal)
  if (found.length < 4) found = await beds(centre, 3000, ['hotel', 'hostel', 'guest_house', 'apartment'], signal)
  if (!found.length) return { stays: [], looked: 0 }

  const shortlist = found.slice(0, 40)
  const user = [
    `They asked for: ${LODGING_LABEL[wish.lodging]}. Who: ${PARTY_LABEL[wish.party]}. Budget: ${BUDGET_LABEL[wish.budget]}.`,
    `Distances are from the centre of everywhere they are going over ${dayNames.length} day${dayNames.length === 1 ? '' : 's'}: ${dayNames.join('; ')}.`,
    '',
    shortlist.map(describe).join('\n'),
  ].join('\n')

  const r = await askJson<{ picks: { id: string; why: string }[] }>('critic', BED_SYSTEM, user, 1500)
    .catch(() => ({ picks: [] as { id: string; why: string }[] }))
  const byId = new Map(shortlist.map(p => [p.id, p]))
  const stays: Stay[] = (r.picks ?? []).flatMap(p => {
    const hit = byId.get(p.id)
    if (!hit) return []
    return [toStay(hit, String(p.why ?? '').trim())]
  }).slice(0, 3)

  // If the model gave nothing usable, the nearest named bed of the right sort
  // is still a better answer than an empty page, and it is honest about why.
  if (!stays.length) stays.push(toStay(shortlist[0], 'the nearest place to sleep to the middle of your days'))
  return { stays, looked: found.length }
}

const toStay = (p: OsmPlace, why: string): Stay => ({
  id: p.id, name: p.name, kind: p.kind, lat: p.lat, lon: p.lon,
  stars: p.tags.stars && /^\d+$/.test(p.tags.stars) ? Number(p.tags.stars) : null,
  address: addressOf(p), why, source: p.source,
})

/* ---------------------------------------------------------------- the table */

const TABLE_SYSTEM = `You are choosing where someone eats on one day of a trip. For each meal you are
given real places from OpenStreetMap near where they will be at that hour, with
distance, and whatever tags exist: cuisine, opening hours, dietary tags.

Choose ONE per meal. Judge on what you are shown: how near it is to where they
will be, whether its cuisine suits what they said, and any dietary tag that
matters to them.

HARD RULES
- Choose only from the list given for that meal.
- Never claim anything is good, famous, beloved, authentic, hidden or a local
  favourite. You have no evidence of any of that. Say where it is, what it
  serves, and why it fits the hour — nothing more.
- Opening hours, if you mention them, are quoted from the tag and may be wrong
  or out of date; do not promise they are open.
- If nothing on a list fits what they asked for, say so by omitting that meal
  rather than choosing badly.

Reply with a JSON object: {"meals":[{"meal":"lunch"|"dinner","id":"<id>","why":"<max 14 words>"}]}`

export async function chooseTables(
  day: { number: number; title: string; stops: { id: string; name: string; lat: number; lon: number; arrival: string }[] },
  wish: Wish, signal?: AbortSignal,
): Promise<Table[]> {
  const wanted = wish.meals
  if (!wanted.length || !day.stops.length) return []

  /* Lunch is looked for around the stop they will be at in the middle of the
     day, dinner around the last one — which is the whole reason these are
     per-day rather than per-trip. */
  const anchorFor = (meal: Meal) =>
    meal === 'lunch' ? day.stops[Math.floor((day.stops.length - 1) / 2)] : day.stops[day.stops.length - 1]

  const lists = await Promise.all(wanted.map(async meal => {
    const anchor = anchorFor(meal)
    const near = await osmTables(anchor, 600, signal)
    return { meal, anchor, near: near.slice(0, 25) }
  }))
  if (lists.every(l => !l.near.length)) return []

  const user = [
    `Day ${day.number}: ${day.title}. Who: ${PARTY_LABEL[wish.party]}. Budget: ${BUDGET_LABEL[wish.budget]}.`,
    wish.diet.trim() ? `At the table they said: "${wish.diet.trim()}".` : 'No dietary requirements given.',
    ...lists.map(l => [
      '',
      `${l.meal.toUpperCase()} — near ${l.anchor.name}, where they are at about ${l.anchor.arrival}:`,
      l.near.length ? l.near.map(describe).join('\n') : '(nothing named nearby)',
    ].join('\n')),
  ].join('\n')

  const r = await askJson<{ meals: { meal: string; id: string; why: string }[] }>('narrator', TABLE_SYSTEM, user, 1200)
    .catch(() => ({ meals: [] as { meal: string; id: string; why: string }[] }))

  const out: Table[] = []
  for (const m of r.meals ?? []) {
    const list = lists.find(l => l.meal === m.meal)
    const hit = list?.near.find(p => p.id === m.id)
    if (!list || !hit) continue
    out.push({
      id: hit.id, name: hit.name, kind: hit.kind, lat: hit.lat, lon: hit.lon,
      cuisine: hit.tags.cuisine ?? '', openingHours: hit.tags.opening_hours ?? '',
      meal: list.meal, nearStopId: list.anchor.id,
      walkMin: Math.round(metresBetween(list.anchor, hit) / 75),   // 4.5 km/h, rounded to whole minutes
      why: String(m.why ?? '').trim(), source: hit.source,
    })
  }
  return out
}
