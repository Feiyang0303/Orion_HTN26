import type { Beat, Target } from '../types'
import { askJson } from './json'

/* NARRATOR (LLM, fast, one call per stop, run in parallel). It may only say
   what the supplied text says, and may only point at supplied targets. Both
   are enforced below, not just requested. */

export type Draft = { text: string; targetId?: string }
export type Mode = 'full' | 'short'

const LIMITS = { short: { beats: 2, words: 22 }, full: { beats: 3, words: 34 } }

const SYSTEM = `You are a walking-tour guide speaking aloud, standing at one stop. Voice: warm,
concrete, unhurried, like a well-made guidebook read aloud. No exclamation marks.

Hard rules:
- State ONLY facts found in the supplied text. If the text does not say it, do not say it.
  Do not add dates, numbers, names or history from memory.
- Each beat is one or two spoken sentences. The first beat is about the stop itself.
- A beat may point at one nearby target: set "targetId" to that target's id and
  mention it naturally ("Look to your left..."). Never invent a target.
- Later beats should usually point at a target, if any were supplied.

Reply with a JSON object: {"beats":[{"text":"...","targetId":"<id, optional>"}]}`

const numbersIn = (s: string) => (s.match(/\d[\d,.]*\d|\d/g) ?? []).map(n => n.replace(/[,.]+$/, '').replace(/,/g, ''))

/** Beats that keep their targetId only if it was supplied, and that contain
    no number absent from the source text. Returns what survived plus why
    anything was dropped. */
export function validate(drafts: Draft[], source: string, targets: Target[], mode: Mode) {
  const haystack = source.replace(/,/g, '')
  const ids = new Set(targets.map(t => t.id))
  const problems: string[] = []
  const beats: Draft[] = []
  for (const d of drafts) {
    const text = String(d.text ?? '').trim()
    if (!text) continue
    const bad = numbersIn(text).filter(n => !haystack.includes(n))
    if (bad.length) { problems.push(`dropped a beat with unsupported number(s) ${bad.join(', ')}`); continue }
    const targetId = d.targetId && ids.has(d.targetId) ? d.targetId : undefined
    if (d.targetId && !targetId) problems.push(`ignored unknown target ${d.targetId}`)
    beats.push({ text, ...(targetId ? { targetId } : {}) })
  }
  return { beats: beats.slice(0, LIMITS[mode].beats), problems }
}

export async function narrate(
  stop: { name: string; extract: string }, targets: Target[], mode: Mode,
): Promise<{ beats: Draft[]; problems: string[] }> {
  const { beats: n, words } = LIMITS[mode]
  const source = [stop.name, stop.extract, ...targets.flatMap(t => [t.name, t.summary])].join('\n')
  const user = `Stop: ${stop.name}\n${stop.extract}\n\nNearby targets you may point at:\n` +
    (targets.length ? targets.map(t => `${t.id} | ${t.name} | ${t.summary.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n') : '(none)') +
    `\n\nWrite exactly ${n} beats, each at most ${words} words.`
  let last: ReturnType<typeof validate> = { beats: [], problems: [] }
  for (let attempt = 0; attempt < 2; attempt++) {       // one retry if validation empties the page
    const r = await askJson<{ beats: Draft[] }>('narrator', SYSTEM, user, 2000)
    last = validate(r.beats ?? [], source, targets, mode)
    if (last.beats.length) break
  }
  if (!last.beats.length) throw new Error(`the narrator produced nothing usable for ${stop.name}`)
  return last
}

export const withAudio = (d: Draft, audioUrl: string | null, durationSec: number): Beat => ({ ...d, audioUrl, durationSec })
