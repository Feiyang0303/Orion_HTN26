import { postBytes } from './net'
import type { Stop } from '../types'

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
    not when the journal is drawn. */
export async function voiceDay<T extends { id: string; stops: Stop[] }>(
  day: T,
  saveAudio: (planId: string, name: string, bytes: ArrayBuffer) => Promise<string>,
): Promise<T> {
  const stops = await Promise.all(day.stops.map(async (st): Promise<Stop> => ({
    ...st,
    beats: await Promise.all(st.beats.map((b, i) => queue(async () => {
      if (b.audioUrl || !b.text.trim()) return b
      try {
        const { bytes, durationSec } = await speak(b.text)
        return { ...b, audioUrl: await saveAudio(day.id, `${st.id}-${i}.mp3`, bytes), durationSec }
      } catch {
        return b
      }
    }))),
  })))
  return { ...day, stops }
}
