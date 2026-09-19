/* THE DIRECTOR. Where a shot is taken from depends on what is being shot: a
 * cathedral needs a wide, high frame to be seen whole, a statue needs a close
 * one, and the camera used to give both the same 170 m. Wikipedia only says
 * where a thing is, and the tiles have no labels, but they do have surfaces:
 * a few rays down around a target (roof height against the street around it)
 * say how tall it stands, which is enough to frame it. Pure, so it can be
 * tested without a scene; the measuring itself is GroundPlacer.measure. */

export type Frame = { dist: number; up: number; lookUp: number }

/** `heightM` is what was measured (null if the tiles were not there yet). */
export function frameFor(heightM: number | null, wide: boolean): Frame {
  const h = heightM ?? 25                            // unknown: assume something building-sized
  const t = Math.min(1, Math.max(0, h / 120))        // 0 = at street level, 1 = tower-sized
  return wide
    ? { dist: 230 + 190 * t, up: 130 + 90 * t, lookUp: 12 + 30 * t }   // the stop, seen whole
    : { dist: 150 + 170 * t, up: 80 + 100 * t, lookUp: 8 + 28 * t }    // a target, from higher and farther than the chase
}
