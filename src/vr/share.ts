import type { Trip } from '../types'
import { loadTrip } from '../trips/store'

/* Getting a saved trip in front of a headset. The trip itself is already on the proxy
 * (saving put it there, with its narration); all that is left is the address a headset
 * on the same network can open. */

/** The link to open on a headset: this machine as another device sees it, and the trip's id. */
export async function vrLink(id: string): Promise<string> {
  const host = ['localhost', '127.0.0.1'].includes(location.hostname)
    ? ((await (await fetch('/api/lan')).json()) as { ips: string[] }).ips[0] ?? location.hostname
    : location.hostname
  return `${location.protocol}//${host}${location.port ? `:${location.port}` : ''}/?vr=${id}`
}

/** A saved trip's days, or (in development) `fixture:<id>` for a generated plan on disk. */
export async function loadDays(id: string) {
  if (id.startsWith('fixture:')) {
    const r = await fetch(`/plans/${id.slice(8)}/plan.json`)
    if (!r.ok) throw new Error(`no plan at /plans/${id.slice(8)}/plan.json (${r.status})`)
    const plan = await r.json()
    return { city: plan.city as string, days: [{ ...plan, number: 1, title: 'The day', tables: [] }] as Trip['days'] }
  }
  const { trip } = await loadTrip(id)
  return { city: trip.city, days: trip.days }
}
