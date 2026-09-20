import type { Beat, Plan } from '../types'

/* The flight as a schedule, built from a Plan and nothing else. Pure: no
 * three.js, no React, no clock. Playback just asks "what is happening at
 * time t?". Every duration that matters comes from the Plan: dwell at a stop
 * is the sum of its beats' audio lengths, so the camera never outruns or
 * waits on the guide.
 *
 *   hold(welcome) → dive → dwell(stop 0) → travel(leg 0) → … → dwell(last) → hold(goodbye)
 *
 * The gaps are deliberately small. Every one of them was audible: a beat is a
 * sentence or two of one continuous talk, not a slide, and a guide who leaves
 * a third of a second between every sentence sounds like a station
 * announcement. What silence there is belongs at the seams, not inside them.
 */

export const DIVE_SEC = 5      // planning view → first stop
export const LEAD_SEC = 0.4    // just enough for the new view to read before the guide speaks
export const BEAT_GAP = 0.04   // the clips already contain a natural sentence-ending breath
export const TAIL_SEC = 0.2    // let the last word land, then keep moving
export const HOLD_LEAD_SEC = 0.4     // before the welcome and the goodbye
export const BRIDGE_LEAD_SEC = 0.15  // the camera is visibly under way before the bridge begins
export const FLY_MPS = 35      // cruising speed between stops (eased, so peak is higher)
export const MIN_TRAVEL_SEC = 4
/* A leg with nothing to say is crossed quickly. */
export const MAX_TRAVEL_SEC = 9
/* A leg with a line to say takes as long as the line, unless that would be a rush. For a while it took exactly as
   long as the line and no longer, to be rid of the silence after a short one; but the line is ten seconds whether
   the leg is nine hundred metres or six and a half kilometres, and the long one was then flown down its streets at
   over six hundred metres a second, corners and all. So a leg is also given the time its length needs at a speed
   that can be watched, up to a ceiling. The few seconds that leaves after the line on a long crossing are the
   arrival, and are quiet on purpose. */
export const WATCHABLE_MPS = 260
export const MAX_SPOKEN_TRAVEL_SEC = 18

export type BeatSlot = { index: number; t0: number; t1: number; beat: Beat }

export type Segment =
  /** The two ends of the day, spoken over the wide view of the whole city:
      the welcome before the dive and the goodbye after the last place. */
  | { kind: 'hold'; which: 'opening' | 'closing'; t0: number; t1: number; beats: BeatSlot[] }
  | { kind: 'dive'; t0: number; t1: number }
  | { kind: 'dwell'; stop: number; t0: number; t1: number; beats: BeatSlot[] }
  /** `beats` holds the leg's bridge line, if it has one: the same shape as a
      dwell's, so playback, captions and pausing need know nothing about it. */
  | { kind: 'travel'; leg: number; t0: number; t1: number; beats: BeatSlot[] }

export type Timeline = {
  segments: Segment[]
  total: number
  /** Start time of each stop's dwell, indexed by stop. */
  dwellStart: number[]
  /** The segment containing t (clamped to the ends) and how far through it, 0..1. */
  at: (t: number) => { seg: Segment; u: number }
}

/** How long the flat flight takes over a leg: quick, because a screen can take it. */
const flatTravelSec = (distanceM: number) => Math.min(MAX_TRAVEL_SEC, Math.max(MIN_TRAVEL_SEC, distanceM / FLY_MPS))
/** The least a leg with a line on it may take, however short the line: see WATCHABLE_MPS. */
const unhurriedSec = (distanceM: number) => Math.min(MAX_SPOKEN_TRAVEL_SEC, distanceM / WATCHABLE_MPS)

/** `travelSec` is how long a leg of a given length takes; a headset, which has to be gentler, brings its own. */
export function buildTimeline(plan: Plan, travelSec = flatTravelSec): Timeline {
  const segments: Segment[] = []
  const dwellStart: number[] = []
  let t = 0
  const push = <S extends Segment>(mk: (t0: number) => S) => { const s = mk(t); segments.push(s); t = s.t1; return s }

  /** A beat said over the wide view: the camera is already where it needs to be,
      so the segment is exactly as long as the words. */
  const hold = (which: 'opening' | 'closing', beat: Beat | undefined) => {
    if (!beat) return
    push(t0 => {
      const slot: BeatSlot = { index: 0, t0: t0 + HOLD_LEAD_SEC, t1: t0 + HOLD_LEAD_SEC + beat.durationSec, beat }
      return { kind: 'hold', which, t0, t1: slot.t1 + TAIL_SEC, beats: [slot] }
    })
  }

  hold('opening', plan.opening)
  push(t0 => ({ kind: 'dive', t0, t1: t0 + DIVE_SEC }))
  plan.stops.forEach((stop, i) => {
    dwellStart[i] = t
    push(t0 => {
      let c = t0 + LEAD_SEC
      const beats = stop.beats.map((beat, index): BeatSlot => {
        const slot = { index, t0: c, t1: c + beat.durationSec, beat }
        c = slot.t1 + BEAT_GAP
        return slot
      })
      return { kind: 'dwell', stop: i, t0, t1: Math.max(c + TAIL_SEC, t0 + LEAD_SEC + TAIL_SEC + 2), beats }
    })
    const leg = plan.legs[i]
    if (leg) push(t0 => {
      const flat = travelSec(leg.distanceM)
      const bridge = leg.bridge
      if (!bridge) return { kind: 'travel', leg: i, t0, t1: t0 + flat, beats: [] }
      /* When there is a bridge, its voice paces the move, and the leg's own length keeps that from being a rush. */
      const slot: BeatSlot = { index: 0, t0: t0 + BRIDGE_LEAD_SEC, t1: t0 + BRIDGE_LEAD_SEC + bridge.durationSec, beat: bridge }
      return { kind: 'travel', leg: i, t0, t1: Math.max(t0 + MIN_TRAVEL_SEC, slot.t1 + TAIL_SEC, t0 + unhurriedSec(leg.distanceM)), beats: [slot] }
    })
  })

  hold('closing', plan.closing)

  const total = t
  const at = (time: number) => {
    const c = Math.min(Math.max(time, 0), total)
    const seg = segments.find(s => c < s.t1) ?? segments[segments.length - 1]
    return { seg, u: seg.t1 > seg.t0 ? Math.min(1, (c - seg.t0) / (seg.t1 - seg.t0)) : 1 }
  }
  return { segments, total, dwellStart, at }
}

/** The beat being spoken at time t, or null during lead-in and gaps. Travel
    segments carry at most one — the leg's bridge line. */
export function activeBeat(seg: Segment, t: number): BeatSlot | null {
  return seg.kind === 'dive' ? null : seg.beats.find(b => t >= b.t0 && t < b.t1) ?? null
}
