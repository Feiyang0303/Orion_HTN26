/* How sharp the city is drawn, decided moment to moment.
 *
 * The tile renderer refines a tile until its on-screen error is below a target in
 * pixels: a lower target means sharper, and more tiles, more memory, more parsing.
 * One fixed number is wrong everywhere. While the camera holds still over a stop
 * (where the person is actually looking, and where the guide is talking) nothing
 * is moving and the cost of sharpness is hidden, so it asks for a lot. While the
 * camera travels it asks for less, because everything is passing at speed. And if
 * the frame rate starts to drop the governor backs off across the board, then
 * creeps back to full detail when there is room, so a weak machine gets a
 * smooth flight and a strong one gets the best the data can give. */

export type Shot = 'map' | 'hold' | 'dive' | 'travel' | 'dwell'

/** Screen-space error targets, in pixels. The tile renderer's own default is 16. */
export const TARGET: Record<Shot, number> = { map: 30, hold: 10, dive: 9, travel: 8, dwell: 4 }

/* The governor looks after a machine that is struggling; this is for one that is not. "High" asks
 * for the last level of detail wherever the camera holds still, keeps twice as many tiles (so the
 * sharp ones at every stop of a long day stay resident) and draws every pixel a Retina screen has.
 * It is the default, because the governor still steps in if the machine cannot keep up; "standard"
 * is there for one that visibly cannot, or is short of memory. The choice is the person's and is
 * remembered on their machine. */
export type Quality = 'high' | 'standard'
export const PROFILE: Record<Quality, { dwell: number; hold: number; dpr: number; cacheTiles: [min: number, max: number]; cacheBytes: [min: number, max: number] }> = {
  high: { dwell: 3, hold: 6, dpr: 2, cacheTiles: [20000, 30000], cacheBytes: [1.4e9, 2.0e9] },
  standard: { dwell: TARGET.dwell, hold: TARGET.hold, dpr: 1.5, cacheTiles: [12000, 20000], cacheBytes: [.7e9, 1.0e9] },
}
const STORED = 'orion.quality'
export const storedQuality = (): Quality => { try { return localStorage.getItem(STORED) === 'standard' ? 'standard' : 'high' } catch { return 'high' } }
export const storeQuality = (q: Quality) => { try { localStorage.setItem(STORED, q) } catch { /* private window: the choice lasts as long as the page */ } }

const SLOW = 1 / 34     // below ~34 fps, back off
const FAST = 1 / 52     // above ~52 fps, there is room to give detail back
const MAX_BACKOFF = 4

export class Governor {
  /** Multiplier on the targets: 1 is full detail, larger is coarser. */
  scale = 1
  quality: Quality = 'high'
  private frame = 1 / 60

  /** Call once per frame; returns the error target to give the renderer. */
  step(dt: number, shot: Shot): number {
    const target = shot === 'dwell' || shot === 'hold' ? PROFILE[this.quality][shot] : TARGET[shot]
    if (dt > 0.25) return target * this.scale               // a stall or a hidden tab says nothing about the machine
    this.frame += (dt - this.frame) * Math.min(1, dt * 2)   // ~half-second smoothing
    if (this.frame > SLOW) this.scale = Math.min(MAX_BACKOFF, this.scale * (1 + dt * .9))
    else if (this.frame < FAST) this.scale = Math.max(1, this.scale * (1 - dt * .12))
    return target * this.scale
  }

  /** What the person is getting, for the flight's telemetry. */
  get detail() { return 1 / this.scale }
}
