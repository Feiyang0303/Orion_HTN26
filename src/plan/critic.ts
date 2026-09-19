import { askJson } from './json'

/* CRITIC (LLM). The arithmetic checks live in timekeeper.audit and run first;
   this call is only for judgement the numbers can't make. */

const SYSTEM = `You review a proposed walking tour of a city, on real streets, on foot.
Reject only for real problems: stops that are the same kind of thing back to
back with nothing to tell them apart, a stop that is not worth standing in
front of, a stop whose sight is inside (a museum's collection) rather than
visible from the street, or a pace that is exhausting or empty. Do not nitpick;
if the plan is good, approve it.

Reply with a JSON object: {"ok": true|false, "complaints":[{"stopId":"<id or omit>","issue":"<one sentence>"}]}`

export type Review = { ok: boolean; complaints: string[] }

export async function critic(summary: string): Promise<Review> {
  const r = await askJson<{ ok: boolean; complaints?: { stopId?: string; issue: string }[] }>('critic', SYSTEM, summary, 3000)
  const complaints = (r.complaints ?? []).map(c => (c.stopId ? `${c.stopId}: ` : '') + c.issue)
  return { ok: r.ok !== false && complaints.length === 0, complaints }
}
