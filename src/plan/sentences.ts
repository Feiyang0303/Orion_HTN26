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
