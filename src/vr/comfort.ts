import * as THREE from 'three'
import { Vector3 } from 'three'
import type { Path } from '../fly/routePath'

/* Being flown, without being made ill.
 *
 * What upsets people in a headset is the eyes reporting an acceleration the ears did
 * not feel: starts, stops, turns, and being pushed sideways. Steady motion straight
 * ahead is tolerated far better. So a leg is ridden the way a careful driver would take
 * it: never faster than CRUISE, slower through a bend (so the sideways push stays under
 * TURN_G), gently up to speed and gently down. However long the leg is, only its two
 * ends are flown, and the middle is blinked across. And whatever the shots ask for, the
 * person's space only ever follows them through `Follower`, which caps speed,
 * acceleration and turning, and leaves pitch and roll entirely alone. */

export const CRUISE = 30            // m/s, the most a leg is ever flown at
const PUSH = 3                      // m/s², speeding up and slowing down
const TURN_G = 4                    // m/s², sideways, through a bend
const MAX_FLOWN = 1000              // metres of a leg actually flown; the rest is blinked over
const STEP = 5, BEND_SPAN = 25      // metres: how finely the ride is worked out, and the stretch a bend is measured over

export type Ride = {
  /** Seconds the leg takes. */
  T: number
  /** Where the person is at `t` seconds: metres down the trail, and which side of the blink (0 before, 1 after). */
  at: (t: number) => { s: number; part: 0 | 1 }
}

/** How long a leg of this length takes if it is straight: what the timeline is built with, before
    there is a street to measure. The real ride is a little longer, and the clock waits for it. */
export function rideSec(distanceM: number) {
  const L = Math.min(distanceM, MAX_FLOWN)
  return L >= CRUISE * CRUISE / PUSH ? L / CRUISE + CRUISE / PUSH : 2 * Math.sqrt(L / PUSH)
}

/** The ride down a trail: for every few metres of it, the speed the bend there allows, then
    limited so that speed is only ever gained and lost at PUSH, from rest to rest. */
export function ride(trail: Path): Ride {
  const L = trail.length, cut = L > MAX_FLOWN
  const d: number[] = []
  if (cut) { for (let x = 0; x <= MAX_FLOWN / 2; x += STEP) d.push(x); for (let x = L - MAX_FLOWN / 2; x <= L; x += STEP) d.push(x) }
  else for (let x = 0; x <= L; x += STEP) d.push(x)
  const join = cut ? d.length / 2 : -1                         // the first sample after the blink: no distance is flown to reach it
  const gap = (i: number) => i === join ? 0 : d[i] - d[i - 1]
  const a = new Vector3(), b = new Vector3(), c = new Vector3()
  const v = d.map(x => {
    trail.at(x - BEND_SPAN, a); trail.at(x, b); trail.at(x + BEND_SPAN, c)
    if (x < BEND_SPAN || x > L - BEND_SPAN) return CRUISE        // no stretch to measure a bend over; it is nearly at rest here anyway
    const bend = Math.abs(Math.atan2(c.z - b.z, c.x - b.x) - Math.atan2(b.z - a.z, b.x - a.x))
    const k = Math.min(bend, 2 * Math.PI - bend) / BEND_SPAN   // radians turned per metre
    return Math.min(CRUISE, Math.sqrt(TURN_G / Math.max(k, 1e-6)))
  })
  v[0] = v[v.length - 1] = .5
  for (let i = 1; i < v.length; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * PUSH * gap(i)))
  for (let i = v.length - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * PUSH * gap(i + 1)))
  const at = [0]
  for (let i = 1; i < d.length; i++) at.push(at[i - 1] + 2 * gap(i) / (v[i] + v[i - 1]))
  const T = at[at.length - 1] ?? 0
  return {
    T,
    at(t) {
      if (d.length < 2) return { s: 0, part: 0 }
      let lo = 0, hi = d.length - 1
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (at[mid] <= t) lo = mid; else hi = mid }
      const f = at[hi] > at[lo] ? Math.min(1, Math.max(0, (t - at[lo]) / (at[hi] - at[lo]))) : 1
      return { s: hi === join ? d[hi] : d[lo] + (d[hi] - d[lo]) * f, part: cut && hi >= join ? 1 : 0 }
    },
  }
}

const MAX_SPEED = 40, MAX_ACCEL = 8                  // m/s, m/s²: above CRUISE so the follower can catch up, never by much
const MAX_TURN = .45, MAX_TURN_ACCEL = .8            // rad/s, rad/s²
const STIFF = 3, TURN_STIFF = 1.6

/** Where the person's space is, chasing where the shots say it should be. A critically damped
    spring with its acceleration and speed clamped, in position and in yaw. There is no pitch
    and no roll here on purpose: the horizon belongs to the person's own head. */
export class Follower {
  readonly pos = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  yaw = 0
  turn = 0
  private acc = new THREE.Vector3()

  /** Be there, moving as the shot is moving. Only ever done behind a blink. */
  snap(pos: THREE.Vector3, yaw: number, vel: THREE.Vector3) { this.pos.copy(pos); this.vel.copy(vel); this.yaw = yaw; this.turn = 0 }

  /** Carry on as it was going, toward nothing: what happens while the view fades out. */
  coast(dt: number) { this.pos.addScaledVector(this.vel, dt); this.yaw += this.turn * dt }

  follow(pos: THREE.Vector3, yaw: number, dt: number) {
    this.acc.copy(pos).sub(this.pos).multiplyScalar(STIFF * STIFF).addScaledVector(this.vel, -2 * STIFF).clampLength(0, MAX_ACCEL)
    this.vel.addScaledVector(this.acc, dt).clampLength(0, MAX_SPEED)
    this.pos.addScaledVector(this.vel, dt)
    const a = THREE.MathUtils.clamp(TURN_STIFF * TURN_STIFF * angleTo(this.yaw, yaw) - 2 * TURN_STIFF * this.turn, -MAX_TURN_ACCEL, MAX_TURN_ACCEL)
    this.turn = THREE.MathUtils.clamp(this.turn + a * dt, -MAX_TURN, MAX_TURN)
    this.yaw += this.turn * dt
  }

  /** 0 at rest, 1 at full tilt: how far the vignette should close. */
  get motion() { return Math.min(1, Math.max(this.vel.length() / CRUISE, Math.abs(this.turn) / MAX_TURN * 1.5)) }
}

/** The short way round from one yaw to another. */
export function angleTo(from: number, to: number) {
  const d = (to - from) % (2 * Math.PI)
  return d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d
}
