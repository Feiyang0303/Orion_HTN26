import { postBytes } from './net'

/* Voice. ElevenLabs via the proxy, mp3_44100_128, which is constant-bitrate,
   so duration is exactly bytes*8/128000 (plus a few ms of header). */

const BITRATE = 128_000
const WORDS_PER_SEC = 2.6

export const estimateSec = (text: string) => text.trim().split(/\s+/).length / WORDS_PER_SEC

export async function speak(text: string): Promise<{ bytes: ArrayBuffer; durationSec: number }> {
  const bytes = await postBytes('tts', { text })
  return { bytes, durationSec: +(bytes.byteLength * 8 / BITRATE).toFixed(2) }
}
