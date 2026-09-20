/* The goose's voice: a small, clear, child's voice.
 *
 * It is a human voice from ElevenLabs, pitched up here. An <audio> element
 * played faster with `preservesPitch` off goes up the way a sped-up record
 * does. Faster alone would be a chipmunk reading too quickly to follow, so
 * the proxy asks ElevenLabs for every line spoken slower by the inverse
 * amount (`ELEVENLABS_GOOSE_SPEED`, 1 / QUACK_RATE), and the two cancel:
 * normal pace, small voice.
 *
 * QUACK_RATE itself lives in plan/pace.ts, which has no DOM in it, because
 * the planning pipeline needs it to work out clip durations and is also run
 * from node scripts. (A raspy cartoon-duck treatment was tried here and
 * taken out: it was not cute.) */

import { QUACK_RATE } from '../plan/pace'

export function quack(audio: HTMLAudioElement): HTMLAudioElement {
  audio.playbackRate = QUACK_RATE
  audio.preservesPitch = false
  const a = audio as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean }
  a.mozPreservesPitch = false
  a.webkitPreservesPitch = false
  return audio
}
