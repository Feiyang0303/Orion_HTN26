import * as THREE from 'three'
import type { Plan } from '../types'
import type { TilesHandle } from './GoogleTiles'
import type { GroundPlacer } from './ground'
import { keyLeg, keyStop, keyTarget, SAMPLE_STEP_M } from './anchors'
import { Path } from './routePath'
import { smoothHeights } from './legStyle'
import { frameFor } from './director'
import { resample, smootherstep } from './geo'

/* Where the camera goes. The flat flight writes these poses onto its camera; the
 * headset cannot be told where to look, so it moves the person's own space to the
 * same `eye` and turns it to face the same `look`. Either way the shots are these.
 *
 * Camera language:
 *   chase  ~55 m up, ~110 m behind, looking ~60 m ahead
 *   pan    higher and farther back than the chase (low facade shots look
 *          bad in photogrammetry), checked for line of sight to the target
 *          before it is committed
 */

export const CHASE_UP = 55, CHASE_BACK = 110, CHASE_LOOK = 60
const TRAIL_EASE_M = 550             // a person is the full CHASE_BACK behind the guide only this far into a leg
const TRAIL_STEP_M = 10              // their line is sampled this often along the street
const ROUND_M = 70, ROUNDING = 5     // and each point of it is the mean of the street this far either side, in this many steps each way

export type Route = { legPaths: Path[]; route: Path; legStart: number[] }

/** The plan's legs as world-space paths on whatever ground has been found so far. */
export function routeOn(plan: Plan, ground: GroundPlacer): Route {
  const legPaths = plan.legs.map((leg, i) => {
    const n = resample(leg.polyline, SAMPLE_STEP_M).length
    const pts: THREE.Vector3[] = []
    for (let j = 0; j < n; j++) { const c = ground.get(keyLeg(i, j)); if (c) pts.push(new THREE.Vector3(c.x, c.y, c.z)) }
    return new Path(smoothHeights(pts))
  })
  const legStart: number[] = []
  let acc = 0
  legPaths.forEach((p, i) => { legStart[i] = acc; acc += p.length })
  return { legPaths, route: new Path(legPaths.flatMap(p => p.pts)), legStart }
}

export class Shots {
  route: Route = { legPaths: [], route: new Path([]), legStart: [] }
  readonly lastHeading = new THREE.Vector3(0, 0, -1)
  private sizes = new Map<string, { h: number | null; at: number }>()
  private vantage = new Map<string, { scale: number; lift: number; at: number }>()
  private a = new THREE.Vector3()
  private b = new THREE.Vector3()

  constructor(private ground: GroundPlacer, private tiles: { current: TilesHandle | null }) {}

  private cell(key: string, fallback: string) {
    const c = this.ground.get(key) ?? this.ground.get(fallback) ?? this.ground.get('origin')
    return c ? this.a.set(c.x, c.y, c.z) : this.a.set(0, 0, 0)
  }

  /** The way the route arrives at a stop. */
  headingIn(stop: number) {
    const { route: r, legPaths: lp, legStart: ls } = this.route
    if (!lp.length || !r.length) return this.lastHeading.clone()
    const leg = Math.max(0, stop - 1)
    const at = stop > 0 ? ls[leg] + lp[leg].length : 0
    return r.heading(at, 25, 25, this.lastHeading)
  }

  /** A vantage on a stop (or one target at it) that can see it: start at the pan distance and
      climb / back off until the line of sight is clear. Re-checked every 1.5 s
      because the surface refines under us as tiles stream in. */
  dwell(stop: number, beatIndex: number | null, beatTarget: string | undefined, tIn: number, now: number, eye: THREE.Vector3, look: THREE.Vector3, check = true) {
    const key = beatTarget ? keyTarget(stop, beatTarget) : keyStop(stop)
    const tg = this.cell(key, keyStop(stop)).clone()
    const wide = beatIndex === null
    // The Director: frame what is there. Re-measured now and then, because the
    // surface sharpens as finer tiles arrive under the camera.
    let size = this.sizes.get(key)
    if (!size || size.h === null || now - size.at > 4) { size = { h: this.ground.measure(this.tiles.current, tg.x, tg.y, tg.z), at: now }; this.sizes.set(key, size) }
    const fr = frameFor(size.h, wide)
    look.set(tg.x, tg.y + fr.lookUp, tg.z)
    const offset = [0, 0.7, -0.7, 1.4][(beatIndex ?? 0) % 4]
    const hd = this.headingIn(stop)
    const ang = Math.atan2(-hd.z, -hd.x) + offset + tIn * 0.04    // behind the way we came, slowly drifting
    const place = (scale: number, lift: number) =>
      eye.set(tg.x + Math.cos(ang) * fr.dist * scale, tg.y + fr.up + lift, tg.z + Math.sin(ang) * fr.dist * scale)

    const vk = `${stop}:${beatIndex ?? 'wide'}`
    let v = this.vantage.get(vk)
    if (check && (!v || now - v.at > 1.5)) {
      v = { scale: 1, lift: 0, at: now }
      for (const [sc, lf] of [[1, 0], [1, 40], [1.25, 90], [1.5, 170]] as const) {
        place(sc, lf); v.scale = sc; v.lift = lf
        if (this.ground.lineOfSight(this.tiles.current, eye, look)) break
      }
      this.vantage.set(vk, v)
    }
    place(v?.scale ?? 1, v?.lift ?? 0)
  }

  /** Following the guide, which is `s` metres along a leg, from straight behind its heading. */
  chase(leg: number, s: number, eye: THREE.Vector3, look: THREE.Vector3, commit = true) {
    const { route: r, legPaths: lp, legStart: ls } = this.route
    const path = lp[leg]
    if (!path || !r.length) return false
    const sDist = ls[leg] + s
    const p = r.at(sDist, this.b)
    const hd = r.heading(sDist, 20, CHASE_LOOK, this.lastHeading)
    if (commit) this.lastHeading.copy(hd)
    eye.set(p.x - hd.x * CHASE_BACK, p.y + CHASE_UP, p.z - hd.z * CHASE_BACK)
    r.at(sDist + CHASE_LOOK, look); look.y += 4
    return true
  }

  /* The chase, for a person. Hung straight behind the guide's heading, the camera swings wide on
   * every corner: on a screen that reads as a crane shot, but a person cannot be swung sideways,
   * or taken round a street corner at speed. So they are carried down a line of their own: the
   * street with its corners rounded off, at the chase's height, dropping back to the chase's
   * distance behind the guide only gradually, so they never stall while it pulls ahead. */

  private rounded(s: number, out: THREE.Vector3) {
    out.set(0, 0, 0)
    for (let i = -ROUNDING; i <= ROUNDING; i++) out.add(this.route.route.at(s + i * ROUND_M / ROUNDING, this.b))
    return out.divideScalar(2 * ROUNDING + 1)
  }

  private behind = (s: number) => CHASE_BACK * smootherstep(s / TRAIL_EASE_M)

  /** The line a person is carried down over a leg. It is a path in its own right, so that a speed
      along it is the speed they feel. */
  trail(leg: number): Path {
    const L = this.route.legPaths[leg]?.length ?? 0, pts: THREE.Vector3[] = []
    if (L > 0) for (let i = 0; i <= Math.ceil(L / TRAIL_STEP_M); i++) {
      const s = Math.min(L, i * TRAIL_STEP_M)
      const p = this.rounded(this.route.legStart[leg] + s - this.behind(s), new THREE.Vector3()); p.y += CHASE_UP
      pts.push(p)
    }
    return new Path(pts)
  }

  /** `d` metres down a leg's trail: the eye, what lies ahead of it, and (returned) how far along the leg the guide is. */
  carry(leg: number, trail: Path, d: number, eye: THREE.Vector3, look: THREE.Vector3) {
    const s = Math.min(this.route.legPaths[leg].length, trail.indexAt(d) * TRAIL_STEP_M)
    trail.at(d, eye)
    this.rounded(this.route.legStart[leg] + s - this.behind(s) + CHASE_BACK + CHASE_LOOK, look); look.y += 4
    return s
  }
}

export type Shot = { t: number; eye: THREE.Vector3; look: THREE.Vector3 }

/* Tiles are chosen for the cameras the renderer knows about. Registering
 * invisible cameras at the shots coming up (or the opening ones, while the
 * book is still being read) makes it fetch those views in advance, and drop
 * them as the flight moves past, so memory stays bounded. */
export class Preloader {
  private cams = new Map<number, THREE.PerspectiveCamera>()

  /** Keep a camera on every shot from just behind `now` to `ahead` seconds after it. */
  sweep(t: TilesHandle, shots: Shot[], now: number, ahead: number, make: () => THREE.PerspectiveCamera, width: number, height: number) {
    const want = new Set<number>()
    shots.forEach((sh, i) => { if (sh.t >= now - 1 && sh.t <= now + ahead) want.add(i) })
    for (const [i, cam] of this.cams) if (!want.has(i)) { t.deleteCamera(cam); this.cams.delete(i) }
    for (const i of want) {
      let cam = this.cams.get(i)
      if (!cam) { cam = make(); this.cams.set(i, cam); t.setCamera(cam) }
      cam.position.copy(shots[i].eye); cam.lookAt(shots[i].look); cam.updateMatrixWorld(true)
      t.setResolution(cam, width, height)
    }
  }

  clear(t: TilesHandle | null) {
    this.cams.forEach(c => t?.deleteCamera(c)); this.cams.clear()
  }
}
