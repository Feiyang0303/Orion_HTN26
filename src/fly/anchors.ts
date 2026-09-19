import type { Plan } from '../types'
import type { Anchor } from './ground'
import { resample } from './geo'

/* Everything in a Plan that needs a place on the real ground, as real lon/lat.
 * The flight and the headset both put the same things on the same tiles, so
 * they share this list and its keys. */

export const SAMPLE_STEP_M = 30
export const keyStop = (i: number) => `s${i}`
export const keyTarget = (i: number, id: string) => `t${i}:${id}`
export const keyLeg = (i: number, j: number) => `l${i}:${j}`

export function anchorsFor(plan: Plan): Anchor[] {
  const out: Anchor[] = [{ key: 'origin', ...plan.origin }]
  plan.stops.forEach((s, i) => {
    out.push({ key: keyStop(i), lat: s.lat, lon: s.lon })
    s.targets.forEach(t => out.push({ key: keyTarget(i, t.id), lat: t.lat, lon: t.lon }))
  })
  plan.legs.forEach((leg, i) => resample(leg.polyline, SAMPLE_STEP_M).forEach((p, j) => out.push({ key: keyLeg(i, j), ...p })))
  return out
}
