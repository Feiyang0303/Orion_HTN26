import type { LatLon } from '../types'

export function metresBetween(a: LatLon, b: LatLon): number {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Google's encoded polyline format (precision 5). */
export function decodePolyline(encoded: string): LatLon[] {
  const out: LatLon[] = []
  let i = 0, lat = 0, lon = 0
  const next = () => {
    let shift = 0, result = 0, b: number
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 31) << shift; shift += 5 } while (b >= 32)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (i < encoded.length) {
    lat += next(); lon += next()
    out.push({ lat: lat / 1e5, lon: lon / 1e5 })
  }
  return out
}

export const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
