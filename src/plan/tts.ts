import { postBytesWith } from './net'
import { gooseRate, learnGooseRate } from './pace'
import type { Beat, Leg, Stop } from '../types'

/* Voice. ElevenLabs via the proxy, mp3_44100_128, which is constant-bitrate,
   so duration is exactly bytes*8/128000 (plus a few ms of header) — and
   the flight plays every clip gooseRate() faster than that (see plan/pace.ts).
   The paper journal never plays this; the flythrough does. */

const BITRATE = 128_000
const WORDS_PER_SEC = 2.6
const CONCURRENT = 6

export const estimateSec = (text: string) => text.trim().split(/\s+/).length / WORDS_PER_SEC

export async function speak(text: string): Promise<{ bytes: ArrayBuffer; durationSec: number }> {
  const { bytes, headers } = await postBytesWith('tts', { text })
  learnGooseRate(headers.get('x-goose-rate'))
  return { bytes, durationSec: +(bytes.byteLength * 8 / BITRATE / gooseRate()).toFixed(2) }
}

function limiter(max: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>(r => waiting.push(r))
    active++
    try { return await fn() } finally { active--; waiting.shift()?.() }
  }
}

const queue = limiter(CONCURRENT)

/* The page revokes its blob URLs when the shell unmounts, so a trip carried
   across that still names clips that no longer exist. A revoked URL is worse
   than none: this pass would see a clip already there and not speak the beat
   again, and the flight would then play silence. Reading a live blob is a
   memory read, so asking is cheap. */
async function playable(url: string): Promise<boolean> {
  if (!url.startsWith('blob:')) return true
  try { return (await fetch(url)).ok } catch { return false }
}

/** Speak every beat that still has no clip. Used when a day is about to fly,
    not when the journal is drawn. A plan is voiced as it is written now
    (PipelineOptions.voice), so this mostly finds nothing to do: it is what
    catches a clip that failed then, and a trip made before that was so.

    Every beat means every beat. The pages are the obvious ones, but the legs'
    bridge lines and the day's opening and closing are beats too, and each one
    that is missed is a stretch of flight with a caption on screen and nothing
    coming out of the speakers — which is worse than having written nothing,
    because the timeline still holds the camera there for as long as the words
    would have taken. */
export async function voiceDay<T extends { id: string; stops: Stop[]; legs?: Leg[]; opening?: Beat; closing?: Beat }>(
  day: T,
  saveAudio: (planId: string, name: string, bytes: ArrayBuffer) => Promise<string>,
): Promise<T> {
  const voice = async (b: Beat, name: string): Promise<Beat> => {
    if (!b.text.trim()) return b
    if (b.audioUrl && await playable(b.audioUrl)) return b
    const stale = !!b.audioUrl        // it named a clip, and the clip is gone
    try {
      const { bytes, durationSec } = await speak(b.text)
      return { ...b, audioUrl: await saveAudio(day.id, name, bytes), durationSec }
    } catch {
      // The caption still carries it; the flight is not stopped for a clip. A
      // dead URL is dropped so nothing downstream believes there is audio.
      return stale ? { ...b, audioUrl: null } : b
    }
  }
  const [stops, legs, opening, closing] = await Promise.all([
    Promise.all(day.stops.map(async (st): Promise<Stop> => ({
      ...st,
      beats: await Promise.all(st.beats.map((b, i) => queue(() => voice(b, `${st.id}-${i}.mp3`)))),
    }))),
    Promise.all((day.legs ?? []).map(async (l, i): Promise<Leg> =>
      l.bridge ? { ...l, bridge: await queue(() => voice(l.bridge!, `leg-${i}.mp3`)) } : l)),
    day.opening ? queue(() => voice(day.opening!, 'opening.mp3')) : Promise.resolve(undefined),
    day.closing ? queue(() => voice(day.closing!, 'closing.mp3')) : Promise.resolve(undefined),
  ])
  return {
    ...day, stops,
    ...(day.legs ? { legs } : {}),
    ...(opening ? { opening } : {}),
    ...(closing ? { closing } : {}),
  }
}
