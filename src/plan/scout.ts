import type { Article } from './wikipedia'
import { askJson } from './json'

/* SCOUT (LLM). Chooses which places belong in the day, from the supplied
   catalogue only. `kind` feeds the Timekeeper's visit-length table. */

export const KINDS = ['viewpoint', 'monument', 'plaza', 'street', 'bridge', 'church', 'park', 'market', 'museum', 'other'] as const
export type Kind = typeof KINDS[number]
export type Pick = { article: Article; why: string; kind: Kind }

const SYSTEM = `You choose the stops for a walking tour of a small area of a city.
You are given a numbered catalogue of Wikipedia articles near the centre. Most
are ordinary; choose only places a visitor would want to stand in front of and
that reward being seen from the street: monuments, plazas, bridges, historic
streets, cathedral facades, viewpoints, parks. Be wary of museums whose draw is
inside; a museum earns a place only when its building is itself the sight.
Prefer variety of kind, and stops that are not clustered on one block.

Reply with a JSON object: {"picks":[{"id":"<catalogue id>","why":"<max 12 words, specific to the place>","kind":"<one of: ${KINDS.join(', ')}>"}]}
Choose exactly the number requested, only ids from the catalogue, no repeats.`

export async function scout(
  catalogue: Article[], count: number, complaints: string[] = [], previous: string[] = [],
): Promise<Pick[]> {
  const byId = new Map(catalogue.map(a => [`c${a.pageId}`, a]))
  const lines = catalogue.map(a => `c${a.pageId} | ${a.title} | ${Math.round(a.distM)} m from centre | ${a.extract.replace(/\s+/g, ' ').slice(0, 170)}`)
  const user = `Choose exactly ${count} stops.\n\nCatalogue:\n${lines.join('\n')}` +
    (complaints.length ? `\n\nA previous plan (${previous.join(', ')}) was rejected:\n- ${complaints.join('\n- ')}\nFix these.` : '')
  const { picks } = await askJson<{ picks: { id: string; why: string; kind: string }[] }>('scout', SYSTEM, user, 4000)

  const seen = new Set<string>()
  const out: Pick[] = []
  for (const p of picks ?? []) {
    const article = byId.get(p.id)
    if (!article || seen.has(p.id)) continue      // ids not in the catalogue are ignored, never trusted
    seen.add(p.id)
    out.push({ article, why: String(p.why).trim(), kind: (KINDS as readonly string[]).includes(p.kind) ? p.kind as Kind : 'other' })
  }
  if (out.length < Math.min(count, 2)) throw new Error('The scout could not find enough good places nearby.')
  return out.slice(0, count)
}
