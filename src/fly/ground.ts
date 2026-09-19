import { Raycaster, Vector3, type Intersection } from 'three'
import type { LatLon } from '../types'
import type { TilesHandle } from './GoogleTiles'
import { DEG } from './geo'

/* Putting real lon/lat on the real ground.
 *
 * x and z come from the renderer's own ellipsoid and the tileset group's world
 * matrix, the exact transform the tiles went through, so nothing assumes an
 * axis convention. Height is a downward raycast onto the loaded tiles:
 * `tiles.raycast` walks bounding volumes before triangles (casting against the
 * whole scene per point is unusably slow), and the nearest hit is taken,
 * because while levels of detail cross-fade a coarse parent and a fine child
 * can both sit under the same spot. Rays are drained a few per frame from a
 * queue that never restarts, and re-queued as finer tiles arrive. */

export type Anchor = LatLon & { key: string }
export type Placed = { x: number; y: number; z: number; grounded: boolean }

const RAYS_PER_FRAME = 4
const RAY_START_HEIGHT = 1500
const RAY_RANGE = 5000

export function toWorld(t: TilesHandle, p: LatLon, out: Vector3): Vector3 {
  t.ellipsoid.getCartographicToPosition(p.lat * DEG, p.lon * DEG, 0, out)
  return out.applyMatrix4(t.group.matrixWorld)
}

export class GroundPlacer {
  private cells = new Map<string, Placed>()
  private queue: Anchor[] = []
  private anchors: Anchor[] = []
  private caster = Object.assign(new Raycaster(), { far: RAY_RANGE })
  // Origin and direction are separate vectors on purpose: Raycaster.set copies
  // its arguments, but building both from one scratch vector makes every ray
  // start underground.
  private origin = new Vector3()
  private down = new Vector3(0, -1, 0)
  private scratch = new Vector3()
  private hits: Intersection[] = []
  private lastFull = 0
  private lastLoaded = -1

  get(key: string) { return this.cells.get(key) }
  get pending() { return this.queue.length }

  /** Replace the set of anchors, keeping everything already grounded. */
  setAnchors(anchors: Anchor[]) {
    this.anchors = anchors
    this.requeue()
  }

  /** Call when tiles finish loading: the surface refines, so re-check everything,
      ungrounded points first. */
  requeue() {
    const grounded = (a: Anchor) => this.cells.get(a.key)?.grounded
    this.queue = [...this.anchors.filter(a => !grounded(a)), ...this.anchors.filter(grounded)]
  }

  /** Cast up to a few rays. Returns how many cells meaningfully changed. */
  step(t: TilesHandle | null): number {
    // Anchors that never landed keep being retried: before the tileset has
    // loaded and reoriented itself, the ellipsoid transform is not yet the one
    // the tiles will use, so their x/z are stale and must be recomputed.
    // The tileset is re-centred on the city once, as it loads. Until then the
    // transform is the raw Earth-centred one, and anything sampled now lands
    // thousands of kilometres from where the camera will look.
    if (t && t.group.position.lengthSq() < 1e4) return 0
    // Nothing is trusted for long: tiles refine under the anchors, and the load-end
    // event that used to trigger a re-check can be minutes away while hundreds of
    // tiles are parsed. So the anchors are re-verified whenever more tiles have
    // arrived (at most every 2.5 s, since a raycast against photogrammetry is not
    // cheap), and a stale one corrects itself. When nothing is arriving, nothing is cast.
    if (t && !this.queue.length) {
      const now = performance.now(), loaded = t.stats.loaded
      if (loaded !== this.lastLoaded && now - this.lastFull > 2500) { this.lastFull = now; this.lastLoaded = loaded; this.requeue() }
      else this.queue = this.anchors.filter(a => !this.cells.get(a.key)?.grounded)
    }
    let n = 0, changed = 0
    while (t && this.queue.length && n < RAYS_PER_FRAME) {
      const a = this.queue.shift()!
      toWorld(t, a, this.scratch)
      const { x, y: ellipsoidY, z } = this.scratch
      this.origin.set(x, ellipsoidY + RAY_START_HEIGHT, z)
      this.caster.set(this.origin, this.down)
      this.hits.length = 0
      t.raycast(this.caster, this.hits)
      this.hits.sort((p, q) => p.distance - q.distance)
      const prev = this.cells.get(a.key)
      const next: Placed = this.hits.length
        ? { x, y: this.hits[0].point.y, z, grounded: true }
        : prev?.grounded ? prev : { x, y: ellipsoidY, z, grounded: false }
      this.cells.set(a.key, next)
      if (!prev || prev.grounded !== next.grounded || Math.abs(prev.x - next.x) + Math.abs(prev.y - next.y) + Math.abs(prev.z - next.z) > 0.5) changed++
      n++
    }
    return changed
  }

  /** Roughly how tall whatever stands at (x, z) is: the highest surface in a small
      grid over it, against the lowest surface in a ring around it. Null until
      enough tiles are loaded to say. `y` is any height near the ground there. */
  measure(t: TilesHandle | null, x: number, y: number, z: number): number | null {
    if (!t) return null
    const top = (px: number, pz: number) => {
      this.origin.set(px, y + 800, pz)
      this.caster.set(this.origin, this.down)
      this.hits.length = 0
      t.raycast(this.caster, this.hits)
      if (!this.hits.length) return null
      this.hits.sort((a, b) => a.distance - b.distance)
      return this.hits[0].point.y
    }
    const roof: number[] = [], street: number[] = []
    for (const dx of [-20, 0, 20]) for (const dz of [-20, 0, 20]) { const v = top(x + dx, z + dz); if (v !== null) roof.push(v) }
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; const v = top(x + Math.cos(a) * 110, z + Math.sin(a) * 110); if (v !== null) street.push(v) }
    if (roof.length < 5 || street.length < 4) return null
    return Math.min(250, Math.max(0, Math.max(...roof) - Math.min(...street)))
  }

  /** Is there open air between two points? False if a tile surface is in the way. */
  lineOfSight(t: TilesHandle | null, from: Vector3, to: Vector3, margin = 12): boolean {
    if (!t) return true
    const dir = this.scratch.copy(to).sub(from)
    const dist = dir.length()
    if (dist < margin) return true
    this.caster.set(from, dir.normalize())
    const saved = this.caster.far
    this.caster.far = dist
    this.hits.length = 0
    t.raycast(this.caster, this.hits)
    this.caster.far = saved
    return !this.hits.some(h => h.distance < dist - margin)
  }
}
