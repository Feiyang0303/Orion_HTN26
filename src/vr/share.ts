import type { Trip } from '../types'

/* Getting a trip from the laptop that planned it to the headset that will show
 * it. The proxy holds the trip and its narration; the link points at this
 * machine's address on the local network. */

const send = async (url: string, init: RequestInit) => {
  const r = await fetch(url, init)
  if (!r.ok) throw new Error(`${url} answered ${r.status}`)
  return r
}

/** Uploads the trip with its audio, and returns the address a headset should open. */
export async function shareTrip(trip: Trip): Promise<{ id: string; url: string }> {
  const { id } = await (await send('/api/share', { method: 'POST' })).json() as { id: string }
  // Narration is blob URLs in this page; the headset can only reach what the proxy serves.
  const copy: Trip = structuredClone(trip)
  let n = 0
  for (const day of copy.days) for (const stop of day.stops) for (const beat of stop.beats) {
    if (!beat.audioUrl) continue
    const name = `a${n++}.mp3`
    const bytes = await (await fetch(beat.audioUrl)).arrayBuffer()
    await send(`/api/share/audio?id=${id}&name=${name}`, { method: 'PUT', body: bytes })
    beat.audioUrl = `/api/share/audio?id=${id}&name=${name}`
  }
  await send(`/api/share/trip?id=${id}`, { method: 'PUT', body: JSON.stringify(copy) })
  const host = await lanHost()
  return { id, url: `${location.protocol}//${host}${location.port ? `:${location.port}` : ''}/?vr=${id}` }
}

/** This machine's address as another device sees it. On a page already opened by that
    address there is nothing to look up. */
async function lanHost(): Promise<string> {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return location.hostname
  const { ips } = await (await send('/api/lan', {})).json() as { ips: string[] }
  return ips[0] ?? location.hostname
}

/** A shared trip's days, or (in development) `fixture:<id>` for a generated plan on disk. */
export async function loadDays(id: string) {
  if (id.startsWith('fixture:')) {
    const plan = await (await send(`/plans/${id.slice(8)}/plan.json`, {})).json()
    return { city: plan.city as string, days: [{ ...plan, number: 1, title: 'The day', tables: [] }] as Trip['days'] }
  }
  const trip = await (await send(`/api/share/trip?id=${encodeURIComponent(id)}`, {})).json() as Trip
  return { city: trip.city, days: trip.days }
}
