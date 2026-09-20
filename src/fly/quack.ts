/* The goose's voice, in the browser's hands.
 *
 * The voice itself comes from ElevenLabs, ideally a real cartoon duck from
 * its library (the proxy finds and keeps one). When there is no duck to be
 * had, a small human voice stands in and is pitched up here: an <audio>
 * element played faster with `preservesPitch` off goes up the way a sped-up
 * record does, and the proxy has asked for the lines slower by the inverse,
 * so the pace comes out normal.
 *
 * Which of the two applies is the proxy's to say (plan/pace.ts keeps its
 * answer), so the rate is set when the clip plays, by which time the flight
 * has asked. */

import { gooseRate, learnGooseRate } from '../plan/pace'
import { net } from '../plan/net'

export function quack(audio: HTMLAudioElement): HTMLAudioElement {
  audio.preservesPitch = false
  const a = audio as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean }
  a.mozPreservesPitch = false
  a.webkitPreservesPitch = false
  audio.playbackRate = gooseRate()
  audio.addEventListener('play', () => { audio.playbackRate = gooseRate() })
  return audio
}

/* Asks the proxy once which voice the goose has, so a flight of saved clips —
   which never calls /api/tts itself — plays them at the right rate. */
let asked: Promise<void> | null = null
export function primeGoose(): Promise<void> {
  asked ??= fetch(`${net.apiBase}/api/voices`)
    .then(r => r.ok ? r.json() : null)
    .then((d: { rate?: number } | null) => { if (d) learnGooseRate(d.rate) })
    .catch(() => { /* the default rate stands */ })
  return asked
}
