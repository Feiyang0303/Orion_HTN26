import { postBytes } from './net'
import type { Beat, Leg, Stop } from '../types'

/* Voice. ElevenLabs via the proxy, mp3_44100_128, which is constant-bitrate,
   so duration is exactly bytes*8/128000 (plus a few ms of header).
   The paper journal never plays this; the flythrough does. */

const BITRATE = 128_000
const WORDS_PER_SEC = 2.6
const CONCURRENT = 6

export const estimateSec = (text: string) => text.trim().split(/\s+/).length / WORDS_PER_SEC

export async function speak(text: string): Promise<{ bytes: ArrayBuffer; durationSec: number }> {
  const bytes = await postBytes('tts', { text })
  return { bytes, durationSec: +(bytes.byteLength * 8 / BITRATE).toFixed(2) }
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

/** Speak every beat that still has no clip. Used when a day is about to fly,
    not when the journal is drawn. The legs' bridge lines are beats too: they
    are what the day sounds like between the places, and a day flown with the
    pages spoken and the seams silent is worse than either. */
export async function voiceDay<T extends { id: string; stops: Stop[]; legs?: Leg[] }>(
  day: T,
  saveAudio: (planId: string, name: string, bytes: ArrayBuffer) => Promise<string>,
): Promise<T> {
  const voice = async (b: Beat, name: string): Promise<Beat> => {
    if (b.audioUrl || !b.text.trim()) return b
    try {
      const { bytes, durationSec } = await speak(b.text)
      return { ...b, audioUrl: await saveAudio(day.id, name, bytes), durationSec }
    } catch {
      return b        // the caption still carries it; the flight is not stopped for a clip
    }
  }
  const [stops, legs] = await Promise.all([
    Promise.all(day.stops.map(async (st): Promise<Stop> => ({
      ...st,
      beats: await Promise.all(st.beats.map((b, i) => queue(() => voice(b, `${st.id}-${i}.mp3`)))),
    }))),
    Promise.all((day.legs ?? []).map(async (l, i): Promise<Leg> =>
      l.bridge ? { ...l, bridge: await queue(() => voice(l.bridge!, `leg-${i}.mp3`)) } : l)),
  ])
  return { ...day, stops, ...(day.legs ? { legs } : {}) }
}
