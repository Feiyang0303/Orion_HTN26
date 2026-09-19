import { useCallback, useEffect, useRef, useState } from 'react'

/* Hearing the question.
 *
 * The browser's own speech recognition, which on Chrome is free, instant and
 * needs no key — and which does not exist at all in Firefox and is uneven in
 * Safari. So it is offered when it is there and the typed box is always there
 * underneath, rather than making the whole feature depend on a vendor prefix.
 *
 * Interim results are surfaced as they arrive because watching the words
 * appear is most of what tells someone the microphone is actually working.
 */

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
type Ctor = new () => SpeechRecognitionLike

const engine = (): Ctor | null => {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function useListening(onSaid: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState('')
  const [trouble, setTrouble] = useState('')
  const rec = useRef<SpeechRecognitionLike | null>(null)
  const said = useRef(onSaid)
  said.current = onSaid
  const supported = !!engine()

  const stop = useCallback(() => { rec.current?.stop() }, [])

  const start = useCallback(() => {
    const Engine = engine()
    if (!Engine || rec.current) return
    const r = new Engine()
    r.lang = navigator.language || 'en-US'
    r.interimResults = true
    r.continuous = false
    r.maxAlternatives = 1
    let best = ''
    r.onresult = e => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const alt = e.results[i][0]?.transcript ?? ''
        if (e.results[i].isFinal) best += alt
        else live += alt
      }
      setHeard((best + live).trim())
    }
    r.onerror = e => {
      setTrouble(e.error === 'not-allowed'
        ? 'The microphone is blocked for this page — allow it, or type instead.'
        : e.error === 'no-speech' ? '' : `The microphone stopped: ${e.error}`)
    }
    r.onend = () => {
      rec.current = null
      setListening(false)
      const text = best.trim()
      setHeard('')
      if (text) said.current(text)
    }
    rec.current = r
    setTrouble(''); setHeard(''); setListening(true)
    try { r.start() } catch { rec.current = null; setListening(false) }
  }, [])

  useEffect(() => () => { rec.current?.abort(); rec.current = null }, [])

  return { supported, listening, heard, trouble, start, stop }
}
