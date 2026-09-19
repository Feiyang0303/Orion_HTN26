import { useCallback, useEffect, useRef, useState } from 'react'
import { ask, voice, type Flown, type Turn } from './guide'
import { useListening } from './useListening'
import { report } from '../telemetry'

/* Talking to the guide, while the flight is held.
 *
 * It opens paused and stays paused: someone in the middle of asking a question
 * does not want the city moving under them, and the narration talking over the
 * answer would be two guides at once. Closing it lets the flight go on.
 */

export default function GuideTalk({ day, city, stopIndex, caption, onClose }: {
  day: Flown
  city: string
  stopIndex: number
  /** What the narrator was saying when they stopped it — the "that" in "what's that?". */
  caption: string
  onClose: () => void
}) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [typed, setTyped] = useState('')
  const [thinking, setThinking] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [trouble, setTrouble] = useState('')
  const audio = useRef<HTMLAudioElement | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const live = useRef({ turns, stopIndex, caption })
  live.current = { turns, stopIndex, caption }

  const hush = useCallback(() => { audio.current?.pause(); audio.current = null; setSpeaking(false) }, [])

  const send = useCallback(async (question: string) => {
    const q = question.trim()
    if (!q || thinking) return
    hush()
    setTyped(''); setTrouble('')
    setTurns(t => [...t, { who: 'you', text: q }])
    setThinking(true)
    try {
      const { spoken, shown } = await ask(q, live.current.turns, day, city, live.current.stopIndex, live.current.caption)
      setTurns(t => [...t, { who: 'guide', text: shown }])
      setThinking(false)
      const a = await voice(spoken)
      if (a) {
        audio.current = a
        setSpeaking(true)
        a.addEventListener('ended', () => setSpeaking(false), { once: true })
        await a.play().catch(() => setSpeaking(false))
      }
    } catch (e) {
      setThinking(false)
      const id = report(e, 'guide.ask', { extra: { city, stop: live.current.stopIndex } })
      setTrouble(`The guide could not answer that${id ? ` (${id})` : ''}. Try again?`)
    }
  }, [thinking, day, city, hush])

  const ear = useListening(send)

  // Always scrolled to the newest line: this is a conversation, not a document.
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }) }, [turns, thinking])
  useEffect(() => () => { audio.current?.pause() }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { hush(); onClose() } }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [hush, onClose])

  const busy = thinking || ear.listening
  return (
    <aside className="gt o-glass" aria-label="Ask the guide">
      <header className="gt-head">
        <div>
          <p className="o-eyebrow">The guide · listening</p>
          <b>{day.stops[stopIndex]?.name.split(',')[0] ?? city}</b>
        </div>
        <button type="button" className="o-btn quiet small" onClick={() => { hush(); onClose() }}>
          Close &amp; fly on
        </button>
      </header>

      <div className="gt-log" ref={log}>
        {turns.length === 0 && !thinking && (
          <p className="gt-hint">
            The tour is held. Ask anything — what you are looking at, why it is here,
            what to do with the rest of the afternoon.
          </p>
        )}
        {turns.map((t, i) => (
          <p key={i} className={`gt-line is-${t.who}`}><span>{t.text}</span></p>
        ))}
        {thinking && <p className="gt-line is-guide is-wait"><span><i /><i /><i /></span></p>}
      </div>

      {ear.listening && <p className="gt-heard">{ear.heard || 'Listening…'}</p>}
      {(trouble || ear.trouble) && <p className="gt-trouble" role="alert">{trouble || ear.trouble}</p>}

      <form className="gt-ask" onSubmit={e => { e.preventDefault(); void send(typed) }}>
        {ear.supported && (
          <button type="button" className={`gt-mic${ear.listening ? ' is-on' : ''}`}
            onClick={() => (ear.listening ? ear.stop() : ear.start())}
            aria-label={ear.listening ? 'Stop listening' : 'Speak to the guide'}>
            <span />
          </button>
        )}
        <input value={typed} onChange={e => setTyped(e.target.value)} disabled={busy}
          placeholder={ear.listening ? 'Listening…' : 'Ask the guide…'} aria-label="Ask the guide" />
        <button type="submit" className="o-btn small" disabled={!typed.trim() || busy}>Ask</button>
        {speaking && <button type="button" className="o-btn quiet small" onClick={hush}>Stop talking</button>}
      </form>
    </aside>
  )
}
