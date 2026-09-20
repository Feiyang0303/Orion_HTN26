/* Where one sentence ends and the next begins.
 *
 * It matters more than it looks, because the Auditor works a sentence at a time: a statement it cannot trace to the
 * source is taken out before it is voiced. Split "…past the George Washington Bridge as part of U.S. Route 9." at
 * the abbreviation and there are two statements, the second of which ("Route 9.") traces to nothing and is removed,
 * and the guide is left saying "…as part of U.S." and stopping. The same cut printed pages that ended at "the
 * Basilica of St."
 *
 * The platform's own segmenter (Intl.Segmenter) does not know abbreviations either: it breaks at "U.S.", "St.",
 * "Frederick L." and "Mt." alike. So this splits at the plain places and then mends: a piece that ends on an
 * abbreviation or an initial did not end there, and is joined to what follows. Joining two real sentences now and
 * then ("…on Wall St. Today…") costs nothing, since a longer sentence is still traced as a whole; breaking one in
 * two costs the second half.
 */

const TITLES = 'St|Ste|Mt|Ft|Dr|Mr|Mrs|Ms|Prof|Sr|Jr|Gen|Col|Capt|Cmdr|Lt|Sgt|Maj|Adm|Rev|Hon|Gov|Pres|Sen|Rep|Fr|Msgr'
const FIRMS = 'Bros|Co|Corp|Inc|Ltd|Assn|Dept|Univ'
const STREETS = 'Ave|Blvd|Rd|Pl|Sq|Hwy|Rte'
const MISC = 'No|Nos|vs|etc|ca|c|cf|approx|est|fl|b|d|r|ed|vol|pp|p'
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
