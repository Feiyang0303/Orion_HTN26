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

export type Shot = 'map' | 'dive' | 'travel' | 'dwell'

/** Screen-space error targets, in pixels. The tile renderer's own default is 16. */
export const TARGET: Record<Shot, number> = { map: 30, dive: 9, travel: 8, dwell: 4 }

const SLOW = 1 / 34     // below ~34 fps, back off
const FAST = 1 / 52     // above ~52 fps, there is room to give detail back
const MAX_BACKOFF = 4

export class Governor {
  /** Multiplier on the targets: 1 is full detail, larger is coarser. */
  scale = 1
  private frame = 1 / 60

  /** Call once per frame; returns the error target to give the renderer. */
  step(dt: number, shot: Shot): number {
    if (dt > 0.25) return TARGET[shot] * this.scale        // a stall or a hidden tab says nothing about the machine
    this.frame += (dt - this.frame) * Math.min(1, dt * 2)   // ~half-second smoothing
    if (this.frame > SLOW) this.scale = Math.min(MAX_BACKOFF, this.scale * (1 + dt * .9))
    else if (this.frame < FAST) this.scale = Math.max(1, this.scale * (1 - dt * .12))
    return TARGET[shot] * this.scale
  }

  /** What the person is getting, for the flight's telemetry. */
  get detail() { return 1 / this.scale }
}
