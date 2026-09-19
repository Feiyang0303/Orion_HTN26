import { Vector3 } from 'three'

/** A polyline in world space with arc-length lookup. One path per leg, joined
    into a route, so "how far along" is a single number of metres. */
export class Path {
  readonly pts: Vector3[]
  readonly cum: number[]
  readonly length: number

  constructor(pts: Vector3[]) {
    this.pts = pts
    this.cum = [0]
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + pts[i].distanceTo(pts[i - 1]))
    this.length = this.cum[this.cum.length - 1] ?? 0
  }

  at(s: number, out = new Vector3()): Vector3 {
    const n = this.pts.length
    if (!n) return out.set(0, 0, 0)
    if (n === 1 || s <= 0) return out.copy(this.pts[0])
    if (s >= this.length) return out.copy(this.pts[n - 1])
    let lo = 0, hi = n - 1                         // binary search for the segment containing s
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.cum[mid] <= s) lo = mid; else hi = mid }
    const seg = this.cum[hi] - this.cum[lo]
    return out.lerpVectors(this.pts[lo], this.pts[hi], seg > 0 ? (s - this.cum[lo]) / seg : 0)
  }

  /** Horizontal unit direction of travel around s, or `fallback` if the path is degenerate there. */
  heading(s: number, back = 15, ahead = 40, fallback = new Vector3(0, 0, -1)): Vector3 {
    const a = this.at(s - back), b = this.at(s + ahead)
    const d = new Vector3(b.x - a.x, 0, b.z - a.z)
    return d.lengthSq() < 1e-6 ? fallback.clone() : d.normalize()
  }
}
