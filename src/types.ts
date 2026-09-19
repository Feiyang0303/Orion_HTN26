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
 *  - Times are seconds (durationSec) or metres (distanceM). No strings.
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
  audioUrl: string | null    // pre-generated TTS; null only if TTS failed
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
}

/** legs[i] is the walk from stops[i] to stops[i+1]; legs.length === stops.length - 1. */
export type Leg = {
  fromStopId: string
  toStopId: string
  polyline: LatLon[]         // decoded Routes polyline, walking
  distanceM: number
  durationSec: number
}

export type Plan = {
  id: string                 // e.g. "kyoto-full-v1"; also the cache key and folder name
  city: string               // display name from the geocoder
  origin: LatLon             // the geocoded search point; the tiles are re-centred here
  mode: 'full' | 'short'     // short = ~3 stops, ~15 s each, for demos
  stops: Stop[]
  legs: Leg[]
  generatedAt: string        // ISO
  /** Honest labelling for the UI: which parts were code, which were models. */
  provenance: { router: 'code'; timekeeper: 'code'; scout: string; critic: string; narrator: string; tts: string }  // e.g. "elevenlabs:eleven_flash_v2_5"
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
