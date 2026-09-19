import { askJson } from './json'

/* CRITIC (LLM). The arithmetic checks live in timekeeper.audit and run first;
   this call is only for the judgement the numbers cannot make — and the one
   judgement it is uniquely placed to make is whether this day answers what the
   person actually asked for, which is why it is now shown the whole desk. */

const SYSTEM = `You review a proposed day over a real city. A camera flies to each stop,
holds above it while a guide speaks, and flies on. You are shown what the
person asked for and what the crew chose.

Reject only for real problems:
- The day ignores what the person said they wanted, and nothing in it answers
  those interests.
- Two or more stops are the same kind of thing with nothing to tell them apart.
- A stop is not worth flying to: nothing about it reads from above, or its
  whole interest is indoors.
- The day is wrong for who is travelling — steep or scattered for someone
  taking it easy, hushed and grown-up throughout for a day with children,
  ticketed interiors when only free things were wanted.
- The shape is wrong for the hours: exhausting, or so empty it is not a day.

Do not nitpick. Do not ask for a different city, more stops than the hours
allow, or places you cannot see in the list. A stop marked ASKED FOR BY
NAME was chosen by the person: it is not yours to reject, and a complaint about
one will be discarded.

If the day is good, approve it and say nothing.

Reply with a JSON object: {"ok": true|false, "complaints":[{"stopId":"<id or omit>","issue":"<one sentence, and what would fix it>"}]}`

export type Review = { ok: boolean; complaints: string[] }

export async function critic(summary: string): Promise<Review> {
  const r = await askJson<{ ok: boolean; complaints?: { stopId?: string; issue: string }[] }>('critic', SYSTEM, summary, 3000)
  const complaints = (r.complaints ?? []).map(c => (c.stopId ? `${c.stopId}: ` : '') + c.issue)
  return { ok: r.ok !== false && complaints.length === 0, complaints }
}
