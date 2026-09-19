import type { LatLon } from '../types'
import { getJson } from './net'

export type Place = LatLon & { name: string; region: string }

/** Nominatim, first hit. (The public instance allows ~1 request/second.) */
export async function geocode(query: string, signal?: AbortSignal): Promise<Place> {
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', addressdetails: '0' })
  const rows = await getJson<{ lat: string; lon: string; name?: string; display_name: string }[]>(url, signal)
  const hit = rows[0]
  if (!hit) throw new Error(`Couldn't find a place called "${query}".`)
  const parts = hit.display_name.split(',').map(s => s.trim())
  return { lat: +hit.lat, lon: +hit.lon, name: hit.name || parts[0], region: parts.slice(1, 3).join(', ') }
}
