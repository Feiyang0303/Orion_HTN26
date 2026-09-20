/* How much faster (and so higher) the flight plays every clip the goose
   speaks. The proxy decides: a real duck voice is played as it comes
   (rate 1); a human voice standing in for one is asked for slower and
   played faster by the inverse, which lifts it without hurrying it. The
   proxy says which on every /api/tts response (`x-goose-rate`) and from
   /api/voices, and the number is kept here. Clip durations are worked out
   from it at planning time, which also runs from node scripts, so there is
   no DOM in this file. */

let rate = 1.22          // the stand-in's rate, until the proxy says otherwise

export const gooseRate = () => rate

/** Called with whatever the proxy reports; anything unreadable is ignored. */
export function learnGooseRate(said: string | number | null | undefined) {
  const r = Number(said)
  if (Number.isFinite(r) && r > 0.5 && r < 2) rate = r
}
