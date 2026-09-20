/* Where one sentence ends and the next begins: a stop's blurb is the first sentence of its article, and the journal
 * prints the first few.
 *
 * The platform's own segmenter (Intl.Segmenter) does not know abbreviations: it breaks at "U.S.", "St.",
 * "Frederick L." and "Mt." alike, and a plain split on full stops does the same, which printed pages that ended at
 * "the Basilica of St." So this splits at the plain places and then mends: a piece that ends on an abbreviation or
 * an initial did not end there, and is joined to what follows. Joining two real sentences now and then ("…on Wall
 * St. Today…") costs little; breaking one in two loses its second half.
 */

const TITLES = 'St|Ste|Mt|Ft|Dr|Mr|Mrs|Ms|Prof|Sr|Jr|Gen|Col|Capt|Cmdr|Lt|Sgt|Maj|Adm|Rev|Hon|Gov|Pres|Sen|Rep|Fr|Msgr'
const FIRMS = 'Bros|Co|Corp|Inc|Ltd|Assn|Dept|Univ'
const STREETS = 'Ave|Blvd|Rd|Pl|Sq|Hwy|Rte'
const MISC = 'No|Nos|vs|etc|ca|c|cf|approx|est|fl|b|d|r|ed|vol|pp|p|transl|lit|pron|abbr|incl|esp|viz'
const MONTHS = 'Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec'
// An initial ("Frederick L."), dotted letters ("U.S.", "D.C.", "e.g."), or one of the words above: at the very end of a piece.
const UNFINISHED = new RegExp(`(?:^|[\\s(\\["“‘'-])(?:[A-Z]|(?:[A-Za-z]\\.)+[A-Za-z]|${[TITLES, FIRMS, STREETS, MISC, MONTHS].join('|')})\\.$`)

export function sentences(text: string): string[] {
  const pieces = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?]["”’)]?)\s+(?=[A-ZÀ-Ý"“‘'(])/).map(p => p.trim()).filter(Boolean)
  const out: string[] = []
  let carry = ''
  for (const p of pieces) {
    const whole = carry ? `${carry} ${p}` : p
    if (UNFINISHED.test(p)) carry = whole
    else { out.push(whole); carry = '' }
  }
  if (carry) out.push(carry)
  return out
}

/* An encyclopaedia opens by saying how a name is pronounced and what it is in its own language: "The Praça do Comércio
   (Portuguese pronunciation: [ˈpɾasɐ ðu kuˈmɛɾsju]; transl. Commerce Plaza) is…". On a page meant to be read at a glance
   that is a line of phonetics before the first fact, so the asides that are about the name and not the place are taken
   out of what is shown. Asides about the place ("(1,815 ft)", "(built 1922)") are left. */
const ABOUT_THE_NAME = /^\([^A-Za-z0-9]*\)$|pronunciation|pronounced|\bIPA\b|\[[^\]]*\]|\b(?:transl|lit|abbr)\.|^\(\s*(?:\p{Lu}\p{Ll}+(?:\s\p{Lu}?\p{Ll}+)?|\p{Ll}+):\s/u
export const withoutNameAsides = (text: string) => text
  .replace(/\s*\((?:[^()]|\([^()]*\))*\)/g, aside => ABOUT_THE_NAME.test(aside.trim()) ? '' : aside)
  .replace(/\s*\(?\s*\[[^\]]*\]\s*\)?/g, '')         // phonetics left outside a bracket, or inside one the article never closed
  .replace(/\s+([,.;:])/g, '$1').replace(/\s{2,}/g, ' ').trim()

