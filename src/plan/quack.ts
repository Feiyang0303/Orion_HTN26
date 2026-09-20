/* The goose's voice is a duck's: a human voice pitched up.
 *
 * ElevenLabs has no pitch dial, and the browser does: an <audio> element
 * played faster with `preservesPitch` off goes up in pitch the way a record
 * does. Faster alone would be a chipmunk reading too quickly to follow, so
 * the proxy asks ElevenLabs for the same lines spoken slower by the inverse
 * amount (`ELEVENLABS_GOOSE_SPEED`, 1 / QUACK_RATE), and the two cancel:
 * normal pace, small voice. The proxy's default speed and this rate are a
 * pair — change one, change the other. */

export const QUACK_RATE = 1.22

/* Typed by shape rather than as HTMLAudioElement: the planning pipeline is
   also run from node scripts, where there is no DOM, and it imports the rate. */
type Pitched = { playbackRate: number; preservesPitch?: boolean; mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean }

export function quack<T extends Pitched>(audio: T): T {
  audio.playbackRate = QUACK_RATE
  audio.preservesPitch = false
  audio.mozPreservesPitch = false
  audio.webkitPreservesPitch = false
  return audio
}
