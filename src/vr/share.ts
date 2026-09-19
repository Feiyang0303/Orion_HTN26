import type { Trip } from '../types'
import { loadTrip } from '../trips/store'

/* Getting a saved trip in front of a headset. The trip itself is already on the proxy
 * (saving put it there, with its narration); all that is left is the address a headset
 * on the same network can open. */

/** Makes this the trip the headset opens, and returns the short link to open it. There is one
    headset session at a time, so the link has no trip in it: it always shows the latest one sent. */
export async function vrLink(id: string): Promise<string> {
  const r = await fetch(`/api/vr/current?id=${encodeURIComponent(id)}`, { method: 'POST' })
  if (!r.ok) throw new Error(`could not set the VR trip (${r.status})`)
  const host = ['localhost', '127.0.0.1'].includes(location.hostname)
    ? ((await (await fetch('/api/lan')).json()) as { ips: string[] }).ips[0] ?? location.hostname
    : location.hostname
  return `${location.protocol}//${host}${location.port ? `:${location.port}` : ''}/vr`
}

/** A saved trip's days, or (in development) `fixture:<id>` for a generated plan on disk. */
/** The id VRPage uses for "whatever was last sent", the address /vr. */
export const CURRENT = 'current'

export async function loadDays(id: string) {
  if (id.startsWith('fixture:')) {
    const r = await fetch(`/plans/${id.slice(8)}/plan.json`)
    if (!r.ok) throw new Error(`no plan at /plans/${id.slice(8)}/plan.json (${r.status})`)
    const plan = await r.json()
    return { city: plan.city as string, days: [{ ...plan, number: 1, title: 'The day', tables: [] }] as Trip['days'] }
  }
  if (id === CURRENT) {
    const r = await fetch('/api/vr/current')
    if (!r.ok) throw new Error('nothing has been sent to VR yet: click VR on a trip first')
    id = ((await r.json()) as { id: string }).id
  }
  const { trip } = await loadTrip(id)
  return { city: trip.city, days: trip.days }
}
