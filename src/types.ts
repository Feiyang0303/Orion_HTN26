/* The contract between planning (src/plan, Person A) and the flythrough
 * (src/fly, Person B). One person edits this file at a time.
 *
 *   A -> B   a Plan (and a fresh Plan on replan)
 *   B -> A   onStopReached, onFinish
 *
 * Conventions
 *  - Coordinates are WGS84 degrees, always { lat, lon } objects, never bare
 *    tuples: [lat, lon] vs [lon, lat] is the classic silent bug, and a
 *    polyline of a few hundred points is cheap enough to name.
 *  - Times are seconds (durationSec) or metres (distanceM). No strings, except
 *    a clock time a person reads, which is 'HH:MM'.
 *  - Everything here is JSON-serialisable: a finished Plan is cached to disk
 *    as-is and loaded back with no transformation.
 */

export type LatLon = { lat: number; lon: number }

/** Where a fact or an image came from, shown as a provenance chip and
    required for anything the Narrator says. */
export type Source = {
  kind: 'wikipedia' | 'commons' | 'routes' | 'nominatim'
  label: string     // "Wikipedia: Old Town Hall"
  url: string
}

/* ---- what the person asked for ------------------------------------------- */

export type Transport = 'walk' | 'cycle' | 'transit' | 'drive'
export const TRANSPORT_LABEL: Record<Transport, string> = {
  walk: 'On foot', cycle: 'By bicycle', transit: 'Public transport', drive: 'Driving',
}
/** What the desk asks for: one mode for the whole trip, or "whatever suits",
    which lets the router choose per leg from distance and budget. A Leg always
    carries the concrete mode it was actually priced with. */
export type TransportWish = Transport | 'auto'
export const TRANSPORT_WISH_LABEL: Record<TransportWish, string> = {
  ...TRANSPORT_LABEL, auto: 'Whatever suits each leg',
}

export type Pace = 'gentle' | 'steady' | 'full'
/** How long a pace lingers, as a multiplier on the Timekeeper's per-kind table.
    Derived from the journal's 85 / 60 / 42 minutes against a 60-minute middle. */
export const PACE_FACTOR: Record<Pace, number> = { gentle: 1.4, steady: 1, full: 0.7 }

/** Who is travelling. It changes what is worth choosing, how long a stop
    takes, and how the guide speaks. */
export type Party = 'solo' | 'couple' | 'family' | 'easy'
export const PARTY_LABEL: Record<Party, string> = {
  solo: 'On my own', couple: 'Two of us', family: 'With children', easy: 'Taking it easy',
}
/** What the day is allowed to cost. Not a number: nobody knows the number, and
    the only thing it can honestly change is whether paid interiors are worth a
    stop at all. */
export type Budget = 'free' | 'modest' | 'any'
export const BUDGET_LABEL: Record<Budget, string> = {
  free: 'Free things only', modest: 'The odd ticket', any: 'Cost is not the point',
}
export type Meal = 'lunch' | 'dinner'

/** The kickoff, as data. Everything on it changes the plan; nothing on it is
    decoration. `wants` are places named by the person and are never dropped. */
export type Wish = {
  city: string
  wants: string[]        // free text, one place per line, exactly as typed
  startAt: string        // '09:30'
  endAt: string          // '18:00'
  from: string           // a hotel, a station, or ''
  interests: string[]
  pace: Pace
  transport: TransportWish
  party: Party
  budget: Budget
  /** Gaps the Timekeeper keeps clear. A day that schedules you into a
      cathedral at one o'clock with no lunch is not a plan, it is a timetable. */
  meals: Meal[]
  /** How many days the trip runs. One is the old behaviour exactly. */
  days: number
  /** Free text: "vegetarian", "no pork", "we like noodles". Passed to the
      table-setter verbatim. Where to sleep is not asked: the crew picks a bed
      that suits the finished plan. */
  diet: string
}

/** A name resolved to a point on the earth. */
export type Waypoint = LatLon & {
  asked: string          // the text the person typed, kept so the book can say so
  name: string
  /** Kept, not resolved silently, when the geocoder was not sure. */
  alternatives?: { name: string; lat: number; lon: number }[]
}

/* ---- the plan ------------------------------------------------------------ */

/** A nearby thing the guide may point at. Comes from Wikipedia geosearch
    (~300 m around a stop), never from the model: a Beat's targetId must be
    one of a Stop's targets, and the Narrator is only given these plus their
    page summaries. */
export type Target = LatLon & {
  id: string
  name: string
  summary: string   // the supplied text the Narrator is allowed to draw on
  source: Source
}

/** One spoken moment. Caption, highlight and camera pan all run off the same
    Beat. */
export type Beat = {
  text: string
  targetId?: string          // must match a Stop.targets[].id; absent = just the stop itself
  audioUrl: string | null    // spoken for the flythrough; the journal never plays this
  durationSec: number        // real audio duration; a words/rate estimate when audioUrl is null
}

export type Photo = {
  url: string
  credit: string             // Commons author + licence, displayed with the image
  pageUrl: string
}

export type Stop = LatLon & {
  id: string
  name: string
  blurb: string              // one line for the book page (A-only, B ignores)
  photo: Photo | null
  sources: Source[]
  targets: Target[]
  beats: Beat[]
  /** Timekeeper output (code, not an LLM). B derives dwell from beats, this
      is what the book prints ("~25 min here"). */
  visitMin: number
  /** Clock time the Timekeeper has you arriving, 'HH:MM'. B ignores it. */
  arrival: string
  /** Why this is in the day, in the person's own words where possible. */
  fits: string
  /** True when the person named this place themselves. Those are never
      dropped, reordered away, or overruled by the Critic. */
  asked: boolean
  /** What the person actually typed or pinned, when the day ended up standing
      somewhere else. A pin on a random corner is honoured by finding the
      nearest thing worth flying to — and then saying so, rather than quietly
      moving the person's own choice. */
  askedAs?: string
  /** How far the stop sits from that pin, in metres. */
  movedM?: number
  /** Minutes of nothing, kept clear after this stop: a meal the Timekeeper was
      told to leave room for. Zero for most stops. */
  breakMin?: number
}

/** One part of a leg travelled by transit: the walk to the platform, the ride, the walk out. */
export type LegStep = {
  mode: 'walk' | 'transit'
  distanceM: number
  /** The line ridden, in the operator's own colours where Google has them ("#ffcd00"). */
  line?: { name: string; vehicle: string; colour?: string; textColour?: string }
  /** Where the ride is boarded and left. */
  from?: string
  to?: string
  stops?: number
}

/** legs[i] is the journey from stops[i] to stops[i+1]; legs.length === stops.length - 1. */
export type Leg = {
  fromStopId: string
  toStopId: string
  polyline: LatLon[]         // decoded Routes polyline
  distanceM: number
  durationSec: number
  transport: Transport
  /** True when the router could not answer and this is a straight line priced
      at a walking-speed guess. The book says so out loud; a confident line
      drawn across a river is the most expensive lie a travel app can tell. */
  estimated: boolean
  /** How this leg is actually travelled, in words, when the router knew: "the
      4 subway from Châtelet to Saint-Michel". Google Routes gives the line and
      the two stations; a guide who can say which platform is a different thing
      from one who says "take the metro". Absent on foot and where transit
      details were not returned. */
  how?: string
  /** A transit leg as its parts, in order, so the map can draw the ride as the line it is and
      mark the two stations. Their distances share out the polyline between them. Absent on
      every other kind of leg, and on trips saved before there were any. */
  steps?: LegStep[]
  /** One line spoken on the way, so the day sounds like a journey rather than
      a set of pages read in a row. Absent when it could not be written; the
      flight then crosses this leg in silence. The journal never plays it. */
  bridge?: Beat
}

export type Plan = {
  id: string                 // e.g. "kyoto-full-v1"; also the cache key and folder name
  city: string               // display name from the geocoder
  origin: LatLon             // the geocoded search point; the tiles are re-centred here
  mode: 'full' | 'short'     // short = ~3 stops, ~15 s each, for demos
  stops: Stop[]
  legs: Leg[]
  /** The desk that produced this plan, kept so the book can print what was asked. */
  wish: Wish
  /** Where the day starts from, if the person gave one. A hotel is not
      somewhere you visit, so it is not a stop. */
  from: Waypoint | null
  /** The hop from `from` to the first stop. Belongs to no stop. */
  approach: Leg | null
  /** The way back from the last stop to `from` at the end of the day, so the
      day is a loop from the bed and not a line that stops in the street. */
  back: Leg | null
  /** The welcome, spoken over the city before the day begins: the city, the shape of the day, and the first place.
      Kept to two or three sentences, because nothing else happens until it is said. Absent when it could not be written. */
  opening?: Beat
  /** The goodbye, spoken over the last place. Different for a day on its own,
      a day with more to come, and the last day of a trip. */
  closing?: Beat
  /** One line under the title, counted from the day itself. */
  epigraph: string
  /** A short paragraph on how this particular day is shaped and why, written
      from the plan's own fields — the only place a model is allowed to talk
      about the day as a whole. Empty if it could not be written. */
  preface: string
  generatedAt: string        // ISO
  /** Where the Director chose to take each shot from, having looked (fly/director.vision.ts). Absent on a plan
      nobody has looked at, and whatever it does not cover is looked at when the day is first flown. */
  direction?: Direction
  /** Honest labelling for the UI: which parts were code, which were models. */
  provenance: { router: 'code'; timekeeper: 'code'; scout: string; critic: string; narrator: string; tts: string }  // e.g. "elevenlabs:eleven_v3"
}

/** The Director's choices for one day. `for` is the stops they were made for, in order: the choices are keyed by a
    stop's position, so they hold only for as long as the day is still those stops in that order. Each choice ranks
    the sides a shot could be taken from (indices into shots.CANDIDATE_SIDES), best first, and says why. */
export type Direction = { for: string; choices: Record<string, {
  ranking: number[]; reason: string
  /** False when even the best view does not show the thing: it is hidden, a smear, or too small to make out. Only
      ever false on the strength of pictures of a loaded city; absent or true means it may be pointed at. */
  usable?: boolean
}> }

/* ---- the trip ------------------------------------------------------------ */

/** A place to sleep, from OpenStreetMap. */
export type Stay = LatLon & {
  id: string
  name: string
  kind: string              // hotel, hostel, guest_house, apartment — OSM's own word
  stars: number | null      // only when OSM has been told; never guessed
  address: string
  why: string               // the concierge's one line, from the tags it was shown
  source: Source
  /** Whatever else OSM was told: website, phone, rooms, wheelchair, wifi… */
  tags: Record<string, string>
  /** Photographs taken within a stone's throw, from Wikimedia Commons — the
      street and the building as they actually are. Labelled as nearby, never
      passed off as the hotel's own. Empty when nobody has photographed it. */
  photos: Photo[]
}

/** A place to eat, from OpenStreetMap, tied to one meal of one day. */
export type Table = LatLon & {
  id: string
  name: string
  kind: string              // restaurant, cafe, bar, fast_food
  cuisine: string           // OSM's cuisine tag, as written
  openingHours: string      // OSM's opening_hours tag, unparsed and unpromised
  meal: Meal | 'breakfast'
  /** The stop it is near, so the book can say why it is on this page. */
  nearStopId: string
  walkMin: number | null
  why: string
  source: Source
}

/** One day of the trip. It is a Plan — so the flythrough can fly it with no
    changes at all — plus the things that belong to a day rather than to a
    flight: what it is called, and where you eat. */
export type Day = Plan & {
  /** 1-based. */
  number: number
  /** The day's own name: "The old town, slowly". */
  title: string
  tables: Table[]
}

export type Trip = {
  id: string
  city: string
  origin: LatLon
  wish: Wish
  days: Day[]
  /** Where to sleep, in the order the concierge preferred them. */
  stays: Stay[]
  /** The editor's note on the whole trip. */
  preface: string
  generatedAt: string
  provenance: { places: string; lodging: string; food: string; router: string; narrator: string; tts: string }
}

/* ---- events -------------------------------------------------------------- */

/** What the flythrough component takes and emits (B's public surface). */
export type FlyProps = {
  plan: Plan | null          // null while planning: tiles preload around `origin`
  origin?: LatLon | null     // the geocoded point, known before the plan is; used only while plan is null
  begin: boolean             // false = hold a slow planning view; true = dive and fly
  onStopReached: (stopId: string, index: number) => void
  onFinish: () => void
  onExit?: () => void        // if given, the flight HUD offers "End tour"
}

/** A -> B on live replan. B swaps to `plan` without a cut: it keeps the
    camera and re-derives its timeline from the first stop not yet reached. */
export type Replan = { reason: string; plan: Plan; fromStopId: string }

/* ---- clock helpers (shared by the timekeeper and the book) --------------- */

export const MINS = (t: string) => {
  const [h, m] = (t || '0:0').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
export const HHMM = (mins: number) =>
  `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(Math.round(mins) % 60).padStart(2, '0')}`
