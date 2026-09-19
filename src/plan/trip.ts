import type { LatLon, Meal, Stay, Table, Wish } from '../types'
import { BUDGET_LABEL, MINS, PARTY_LABEL } from '../types'
import { askJson } from './json'
import { addressOf, beds, describe, OverpassDown, tables as osmTables, type OsmPlace } from './osm'
import { metresBetween } from './geo'
import { photosNear } from './wikipedia'
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
- Time first. Each place comes with the minutes it takes. A day has a budget of
  minutes for visiting, given below; the places you put in a day must add up
  to no more than that, and a day that is half empty is also wrong. Travel
  between places costs time too — leave room for it.
- Geography next. A day should be walkable as a cluster; the worst possible
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
in it: name a place, a street, a river, or the one thing the day's places share
— "The river and the old bridge", "Three temples east of the Kamo". Never a
theme or a brochure phrase: not "Cultural highlights", not "Sacred spaces", not
"Immersion", not "Retreats". No colons, no "Day 1:".

Reply with a JSON object:
{"days":[{"title":"<3-6 words>","ids":["<stop id>", ...],"why":"<max 14 words: what makes this a day>"}]}`

export type DayShape = { title: string; ids: string[]; why: string }

export async function shapeDays(all: Candidate[], count: number, wish: Wish, budgetMin: number): Promise<DayShape[]> {
  if (count <= 1) return [{ title: 'The day', ids: all.map(c => c.id), why: '' }]
  const lines = all.map(c =>
    `${c.id} | ${c.name} | ${c.kind} | ${c.visitMin} min | ${c.lat.toFixed(4)},${c.lon.toFixed(4)} | ${c.asked ? 'ASKED FOR BY NAME' : c.why}`)
  const user = [
    `${count} days. ${all.length} places. Each day has about ${budgetMin} minutes for visiting, after meals and travel.`,
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
    title: honestTitle(String(d.title ?? '').trim().slice(0, 60), (d.ids ?? []).map(id => byId.get(id)).filter(Boolean) as Candidate[], i),
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

/* A title that is a brochure gets replaced with one that is a fact: the first
   and last place of the day, or the one place if there is one. The prompt asks
   for this and the model ignores it about half the time, so it is not asked
   twice — it is fixed here. */
const BROCHURE = /\b(highlights?|immersion|immersive|relaxation|experience|journey|adventure|exploration|explore|discover(y|ing)?|charm(s|ing)?|wonders?|treasures?|gems?|delights?|vibes?|essence|magic(al)?|unforgettable|hidden|iconic|ultimate|must-see|cultural|sacred|scenic|foundations?|retreats?|strolls?)\b/i
function honestTitle(given: string, stops: Candidate[], i: number) {
  const ok = given && !BROCHURE.test(given) && !/^day\s*\d/i.test(given)
  if (ok) return given
  const a = stops[0]?.name, b = stops[stops.length - 1]?.name
  if (a && b && a !== b) return `${shortName(a)} to ${shortName(b)}`
  if (a) return `Around ${shortName(a)}`
  return `Day ${i + 1}`
}
const shortName = (n: string) => n.replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').trim()

/* -------------------------------------------------------------- the bedroom */

/** `down` means OpenStreetMap did not answer, which is not the same as there being nothing to find. */
export type BedChoice = { stays: Stay[]; looked: number; down?: boolean }

/** A place on one of the days, as the bed sees it. */
type Waypost = { name: string; lat: number; lon: number }

/** The trip in the shape that decides where to sleep: each day in visiting
    order, so what a bed costs can be measured rather than guessed. */
export type TripShape = { days: Waypost[][]; centre: LatLon }

/** What a bed costs every day of the trip, in metres: out to the first place
    in the morning, back from the last at night. `worstOut` is the morning that
    hurts most, which is the thing an average quietly hides. */
function commute(bed: LatLon, days: Waypost[][]) {
  let out = 0, round = 0, worstOut = 0, worst = 0, n = 0
  for (const d of days) {
    if (!d.length) continue
    const o = metresBetween(bed, d[0]), b = metresBetween(d[d.length - 1], bed)
    out += o; round += o + b
    worstOut = Math.max(worstOut, o); worst = Math.max(worst, o + b)
    n++
  }
  return n
    ? { out: out / n, round: round / n, worstOut, worst, days: n }
    : { out: 0, round: 0, worstOut: 0, worst: 0, days: 0 }
}

/* Where to sleep is not asked of the person and not decided by a model. Nobody
   can say what kind of bed they want before they know where their days are, and
   the only things that honestly bear on the choice are ones that can be
   measured: what it costs to reach your places every morning and come back
   every night, and what OpenStreetMap has been told about it. So the list is
   ranked by arithmetic, the reasons are written from the same numbers, and the
   best of them is the one you wake up in.

   The measure used to be the distance to the middle of the places, which is
   the same thing only when the places sit in a ring around it. Two clusters
   either side of a river have their middle in the water, and the bed that won
   was the one nearest to nowhere in particular. */
const score = (p: OsmPlace, wish: Wish, days: Waypost[][]) => {
  const stars = Number(p.tags.stars) || 0
  const c = commute(p, days)
  /* Half the round trip is the average one-way walk, which keeps this on the
     same scale as the adjustments below; the worst morning is weighted in so a
     bed cannot buy a good average with one miserable day. */
  let s = c.round * 0.5 + c.worstOut * 0.5
  if (p.kind === 'hostel' && wish.party !== 'solo') s += 700          // a hostel for a couple or a family needs a reason
  if (p.kind === 'hostel' && wish.budget === 'free') s -= 250
  if (p.kind === 'apartment' && wish.days < 2) s += 500               // an apartment for one night is odd
  if (wish.budget === 'any' && stars >= 4) s -= 350
  if (wish.budget !== 'any' && stars >= 5) s += 450                   // a five-star is the wrong pick for "the odd ticket"
  if (p.tags.website || p.tags['contact:website']) s -= 120           // a listing someone maintains
  return s
}

/** The beds that suit this trip, best first. `exclude` are ids already shown,
    so asking again gives a genuinely different one rather than the hotel next
    door to the last. */
export async function chooseBeds(
  shape: TripShape, wish: Wish, exclude: string[] = [], signal?: AbortSignal,
): Promise<BedChoice> {
  const { centre, days } = shape
  /* The near ring first; the wider one sized to how spread out the places
     actually are, so a compact trip is not offered a bed across the city. */
  const spread = days.flat().reduce((m, w) => Math.max(m, metresBetween(centre, w)), 0)
  const wide = Math.round(Math.max(2600, Math.min(6000, spread * 0.75)))
  // Both radii at once: the wider is only used when the near one is thin, but
  // asking in sequence would spend a second full wait finding that out.
  const kinds = ['hotel', 'hostel', 'guest_house', 'apartment']
  const [near, far] = await Promise.allSettled([beds(centre, 1800, kinds, signal), beds(centre, wide, kinds, signal)])
  if (near.status === 'rejected' && far.status === 'rejected') {
    if (near.reason instanceof OverpassDown) return { stays: [], looked: 0, down: true }
    throw near.reason
  }
  const nearList = near.status === 'fulfilled' ? near.value : []
  const farList = far.status === 'fulfilled' ? far.value : []
  const found = nearList.length >= 6 ? nearList : farList.length > nearList.length ? farList : nearList
  const ranked = found.filter(p => !exclude.includes(p.id)).sort((a, b) => score(a, wish, days) - score(b, wish, days))
  if (!ranked.length) return { stays: [], looked: found.length }

  /* One to sleep in, and two held behind it. They have to be genuinely apart:
     three doors on the same street are one choice offered three times, and the
     person asking for another bed is asking to be somewhere else. */
  const picks = [ranked[0]]
  for (const p of ranked.slice(1)) {
    if (picks.length >= 3) break
    if (picks.every(q => metresBetween(q, p) > 250)) picks.push(p)
  }
  for (const p of ranked) { if (picks.length >= 3) break; if (!picks.includes(p)) picks.push(p) }

  const stays = picks.map(p => toStay(p, reasonFor(p, days)))
  // Photographs of the street, where anyone has taken one.
  await Promise.all(stays.map(async b => { b.photos = await photosNear(b, 120, 3) }))
  return { stays, looked: found.length }
}

const fmtM = (m: number) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`)

/* The reason is the arithmetic, said out loud. It names the trip's own places,
   because "central" means nothing and "800 m from where day two begins" is
   something the person can weigh for themselves. */
const reasonFor = (p: OsmPlace, days: Waypost[][]) => {
  const c = commute(p, days)
  const first = days[0]?.[0]
  const stars = Number(p.tags.stars)
  return [
    c.days === 0 ? `${fmtM(p.distM)} from the middle of your places`
      : c.days === 1 && first ? `${fmtM(c.out)} to ${shortName(first.name)}, where the day starts`
      : `${fmtM(c.out)} to the first place on an average day, never more than ${fmtM(c.worstOut)}`,
    Number.isFinite(stars) && stars > 0 ? `${stars} stars, self-declared` : '',
    p.tags['addr:street'] ? `on ${p.tags['addr:street']}` : '',
  ].filter(Boolean).join(' · ')
}

const toStay = (p: OsmPlace, why: string): Stay => ({
  id: p.id, name: p.name, kind: p.kind, lat: p.lat, lon: p.lon,
  stars: p.tags.stars && /^\d+$/.test(p.tags.stars) ? Number(p.tags.stars) : null,
  address: addressOf(p), why, source: p.source, tags: p.tags, photos: [],
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
  day: {
    number: number; title: string
    stops: { id: string; name: string; lat: number; lon: number; arrival: string; visitMin?: number }[]
    /** Where they sleep. Dinner is looked for here when there is one — the
        last thing anyone wants after a day out is a bus back after eating. */
    bed?: { id: string; name: string; lat: number; lon: number } | null
  },
  wish: Wish, signal?: AbortSignal,
): Promise<Table[]> {
  const wanted = wish.meals
  if (!wanted.length || !day.stops.length) return []

  /* Lunch is looked for around the stop they leave nearest a quarter to one —
     the same rule the Timekeeper used to place the gap, so the table is where
     the clock says they will be hungry, not at the arithmetic middle of the
     list. Dinner is around the last stop. */
  const leaving = (st: typeof day.stops[number]) => MINS(st.arrival) + (st.visitMin ?? 30)
  const anchorFor = (meal: Meal) => {
    if (meal !== 'lunch') return day.bed ?? day.stops[day.stops.length - 1]
    return [...day.stops].sort((a, b) => Math.abs(leaving(a) - (12 * 60 + 45)) - Math.abs(leaving(b) - (12 * 60 + 45)))[0]
  }

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
      `${l.meal.toUpperCase()} — near ${l.anchor.name}${'arrival' in l.anchor && l.anchor.arrival ? `, where they are at about ${l.anchor.arrival}` : l.meal === 'dinner' ? ', where they sleep, in the evening' : ''}:`,
      l.near.length ? l.near.map(describe).join('\n') : '(nothing named nearby)',
    ].join('\n')),
  ].join('\n')

  const r = await askJson<{ meals?: unknown }>('narrator', TABLE_SYSTEM, user, 1200).catch(() => ({ meals: [] }))

  /* {meals:[{meal,id,why}]} is what was asked for. {meals:{lunch:{id,why}}},
     {lunch:{...}, dinner:{...}} and {meals:[{lunch:"id"}]} are what arrives. */
  const picks: { meal: string; id: string; why: string }[] = []
  const take = (meal: string, v: unknown) => {
    if (typeof v === 'string') picks.push({ meal, id: v, why: '' })
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.id === 'string') picks.push({ meal: String(o.meal ?? meal), id: o.id, why: String(o.why ?? '') })
    }
  }
  const raw = (r as Record<string, unknown>).meals ?? r
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string') take(String((item as Record<string, unknown>).meal ?? ''), item)
      else if (item && typeof item === 'object') for (const [k, v] of Object.entries(item as Record<string, unknown>)) take(k, v)
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (k === 'lunch' || k === 'dinner' || k === 'breakfast') take(k, v)
  }

  const out: Table[] = []
  for (const m of picks) {
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
