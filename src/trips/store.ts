import type { Place } from '../plan/geocode'
import type { Beat, Trip } from '../types'

/* Trips that outlive the page. The proxy keeps them (in MongoDB when it is
 * configured, in memory when it is not); this is the browser's side of that.
 *
 * A trip's narration lives in the page as blob URLs, which nothing else can open,
 * so saving uploads each clip once and stores the trip with addresses the proxy
 * serves. The trip in the page is left as it is.
 *
 * Every clip, not just the stops': a leg's bridge line is spoken the same way
 * and would otherwise be stored as a blob URL that is dead the moment the page
 * reloads — and a dead URL is worse than none, because the voicing pass sees a
 * clip already there and leaves the leg silent for good. */

export type Saved = { id: string; trip: Trip; mode: 'full' | 'short'; origin: Place; updatedAt: number }
export type Summary = { id: string; city: string; days: number; places: number; updatedAt: number }

const OWNER_KEY = 'orion.owner'
let memoryOwner = ''

/** A random id this browser keeps, which is what lets it list and change its own trips. */
export function owner(): string {
  try {
    let o = localStorage.getItem(OWNER_KEY)
    if (!o) { o = newId(); localStorage.setItem(OWNER_KEY, o) }
    return o
  } catch { return memoryOwner ||= newId() }        // storage blocked: this tab still works, it just cannot find its trips next time
}

export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')

const call = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, init)
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${url.split('?')[0]} answered ${r.status}`)
  return r
}

const uploaded = new Map<string, string>()          // `${tripId}|${blobUrl}` -> the address the proxy serves it at

/** Saves the trip. `persistent` is false when the proxy has no database and will forget it on restart. */
export async function saveTrip(id: string, trip: Trip, mode: Saved['mode'], origin: Place): Promise<{ updatedAt: number; persistent: boolean }> {
  const copy: Trip = structuredClone(trip)
  const upload = async (beat: Beat | undefined) => {
    if (!beat?.audioUrl?.startsWith('blob:')) return
    const key = `${id}|${beat.audioUrl}`
    let url = uploaded.get(key)
    if (!url) {
      const name = `${newId()}.mp3`
      await call(`/api/trips/clip?id=${id}&name=${name}`, { method: 'PUT', body: await (await fetch(beat.audioUrl)).arrayBuffer() })
      url = `/api/trips/clip?id=${id}&name=${name}`
      uploaded.set(key, url)
    }
    beat.audioUrl = url
  }
  for (const day of copy.days) {
    for (const stop of day.stops) for (const beat of stop.beats) await upload(beat)
    for (const leg of day.legs) await upload(leg.bridge)
  }
  const r = await call(`/api/trips/save?id=${id}&owner=${owner()}`, { method: 'POST', body: JSON.stringify({ trip: copy, mode, origin }) })
  return r.json()
}

export async function loadTrip(id: string): Promise<Saved> {
  return (await call(`/api/trips/get?id=${encodeURIComponent(id)}`)).json()
}

export async function listTrips(): Promise<{ trips: Summary[]; persistent: boolean }> {
  return (await call(`/api/trips/list?owner=${owner()}`)).json()
}

export async function deleteTrip(id: string): Promise<void> {
  await call(`/api/trips/delete?id=${encodeURIComponent(id)}&owner=${owner()}`, { method: 'DELETE' })
}
