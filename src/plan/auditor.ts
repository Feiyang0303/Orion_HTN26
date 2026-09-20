import type { Claim, Source } from '../types'
import { sentences } from './sentences'

/* AUDITOR (code, not a model). The Narrator may only say what the supplied text
 * says; narrator.validate() enforces the easy half of that (no number the
 * sources lack, no target that was not offered). This is the other half: every
 * sentence is traced to the sentence it came from, and the trace is kept, so
 * the book can show it and a sceptical reader can check it.
 *
 * It is deliberately not clever. A sentence is supported when most of its
 * content words appear together in one source sentence. That is a strong test
 * for text a model was told to stay close to, and it is a test a person can
 * follow. A sentence that fails is marked unverified, not deleted: an
 * unverified line is information, and a silent edit is not.
 */

export type Doc = { text: string; source: Source }

const STOP = new Set(('a an the and or but if then of in on at to from by for with as is are was were be been being it its this that these those ' +
  'there here he she they them their his her we you your our i not no so than too very can could would should will may might do does did ' +
  'has have had which who whom whose what when where while about into over under between through during before after above below up down out off ' +
  'also just only some any each every both more most other such own same one two').split(' '))

// Words a guide uses to point rather than to state: no fact hangs on them.
const POINTING = new Set(('look looking see seen watch notice spot toward towards left right ahead behind beyond near nearby just across along ' +
  'below aboveside corner stand standing sits sit stands lies lie rises rise across over there').split(' '))

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).map(w => w.replace(/^['-]+|['-]+$/g, '').replace(/'s$/, ''))
  .filter(Boolean)
const stem = (w: string) => w.length > 4 ? w.replace(/(ies)$/, 'y').replace(/(es|s|ed|ing)$/, '') : w
const content = (s: string) => new Set(words(s).filter(w => !STOP.has(w) && (w.length > 2 || /\d/.test(w))).map(stem))


const SUPPORT = 0.5          // share of a sentence's content words that must sit together in one source sentence
const QUOTE_MAX = 240

/** Trace each sentence of `text` to the supplied `docs`. `names` are the stop
    and target names the sentence is allowed to mention without needing a source. */
export function auditText(text: string, docs: Doc[], names: string[] = []): Claim[] {
  const nameWords = new Set(names.flatMap(n => [...content(n)]))
  const indexed = docs.flatMap(d => sentences(d.text).map(s => ({ s, w: content(s), source: d.source })))
  return sentences(text).map((sentence): Claim => {
    const need = [...content(sentence)]
    const fact = need.filter(w => !nameWords.has(w) && !POINTING.has(w))
    // Nothing left once names and pointing words are set aside: "Look toward the Army Museum."
    if (fact.length <= 1) return { text: sentence, supported: true, framing: true }

    let best = { score: 0, s: '', source: undefined as Source | undefined }
    for (const it of indexed) {
      const hit = fact.filter(w => it.w.has(w)).length / fact.length
      if (hit > best.score) best = { score: hit, s: it.s, source: it.source }
    }
    const supported = best.score >= SUPPORT
    return {
      text: sentence, supported,
      ...(supported ? { quote: best.s.length > QUOTE_MAX ? best.s.slice(0, QUOTE_MAX - 1) + '…' : best.s, source: best.source } : {}),
      score: +best.score.toFixed(2),
    }
  })
}

/** How a page did, for the crew's log line and for anything that wants to say so. */
export function tally(beats: { claims?: Claim[] }[]) {
  const all = beats.flatMap(b => b.claims ?? []).filter(c => !c.framing)
  return { traced: all.filter(c => c.supported).length, total: all.length }
}

/** The statements of a set of beats that could not be traced. */
export const unsupportedIn = (beats: { claims?: Claim[] }[]) =>
  beats.flatMap(b => b.claims ?? []).filter(c => !c.supported).map(c => c.text)

/** Take the untraceable sentences out of a beat before it is voiced. A beat with
    nothing left is dropped. What remains is exactly what the sources support, in
    the order it was said, with the trace kept. */
export function repair<T extends { text: string; claims?: Claim[] }>(d: T): T | null {
  if (!d.claims?.length || d.claims.every(c => c.supported)) return d
  const kept = d.claims.filter(c => c.supported)
  if (!kept.length) return null
  return { ...d, text: kept.map(c => c.text).join(' '), claims: kept }
}
