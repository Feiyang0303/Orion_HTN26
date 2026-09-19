import type { LatLon } from '../types'

export const DEG = Math.PI / 180

export function metresBetween(a: LatLon, b: LatLon): number {
  const R = 6371000
  const dLat = (b.lat - a.lat) * DEG, dLon = (b.lon - a.lon) * DEG
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Points along a polyline at most `step` metres apart, interpolating inside
    long segments so the ground is sampled along the street, not only at its
    bends. Always keeps both ends. Capped at `max` points. */
export function resample(line: LatLon[], step: number, max = 400): LatLon[] {
  if (line.length < 2) return line
  const out: LatLon[] = [line[0]]
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i]
    const n = Math.max(1, Math.ceil(metresBetween(a, b) / step))
    for (let k = 1; k <= n; k++) out.push({ lat: a.lat + (b.lat - a.lat) * k / n, lon: a.lon + (b.lon - a.lon) * k / n })
  }
  if (out.length <= max) return out
  const k = Math.ceil(out.length / max)
  return out.filter((_, i) => i % k === 0 || i === out.length - 1)
}

export const smootherstep = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * c * (c * (c * 6 - 15) + 10) }
