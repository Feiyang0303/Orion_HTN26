import type { Beat, Plan } from '../types'

/* The flight as a schedule, built from a Plan and nothing else. Pure: no
 * three.js, no React, no clock. Playback just asks "what is happening at
 * time t?". Every duration that matters comes from the Plan: dwell at a stop
 * is the sum of its beats' audio lengths, so the camera never outruns or
 * waits on the guide.
 *
 *   dive → dwell(stop 0) → travel(leg 0) → dwell(stop 1) → … → dwell(last)
 */

export const DIVE_SEC = 5      // planning view → first stop
export const LEAD_SEC = 1.4    // camera settles before the guide speaks
export const BEAT_GAP = 0.35   // breath between beats
export const TAIL_SEC = 1.0    // hold after the last beat before moving on
export const FLY_MPS = 35      // cruising speed between stops (eased, so peak is higher)
export const MIN_TRAVEL_SEC = 5
export const MAX_TRAVEL_SEC = 16

export type BeatSlot = { index: number; t0: number; t1: number; beat: Beat }

export type Segment =
  | { kind: 'dive'; t0: number; t1: number }
  | { kind: 'dwell'; stop: number; t0: number; t1: number; beats: BeatSlot[] }
  | { kind: 'travel'; leg: number; t0: number; t1: number }

export type Timeline = {
  segments: Segment[]
  total: number
  /** Start time of each stop's dwell, indexed by stop. */
  dwellStart: number[]
  /** The segment containing t (clamped to the ends) and how far through it, 0..1. */
  at: (t: number) => { seg: Segment; u: number }
}

export function buildTimeline(plan: Plan): Timeline {
  const segments: Segment[] = []
  const dwellStart: number[] = []
  let t = 0
  const push = <S extends Segment>(mk: (t0: number) => S) => { const s = mk(t); segments.push(s); t = s.t1; return s }

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
    if (leg) push(t0 => ({ kind: 'travel', leg: i, t0, t1: t0 + Math.min(MAX_TRAVEL_SEC, Math.max(MIN_TRAVEL_SEC, leg.distanceM / FLY_MPS)) }))
  })

  const total = t
  const at = (time: number) => {
    const c = Math.min(Math.max(time, 0), total)
    const seg = segments.find(s => c < s.t1) ?? segments[segments.length - 1]
    return { seg, u: seg.t1 > seg.t0 ? Math.min(1, (c - seg.t0) / (seg.t1 - seg.t0)) : 1 }
  }
  return { segments, total, dwellStart, at }
}

/** The beat being spoken at time t, or null during lead-in, gaps and travel. */
export function activeBeat(seg: Segment, t: number): BeatSlot | null {
  return seg.kind === 'dwell' ? seg.beats.find(b => t >= b.t0 && t < b.t1) ?? null : null
}
