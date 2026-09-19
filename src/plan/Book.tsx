import { useState } from 'react'
import type { Plan } from '../types'
import type { CrewEvent } from './events'
import type { Mode } from './narrator'
import './book.css'

export type BookProps = {
  phase: 'ask' | 'planning' | 'reading'
  overCity: boolean
  mode: Mode
  city: string
  events: CrewEvent[]
  plan: Plan | null
  error: string | null
  busy: boolean
  onSubmit: (query: string, mode: Mode) => void
  onDemo: () => void
  onBegin: () => void
  onReset: () => void
}

export default function Book({
  phase, overCity, mode, city, events, plan, error, busy, onSubmit, onDemo, onBegin, onReset,
}: BookProps) {
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<Mode>(mode)
  const crew = events.filter((e): e is Extract<CrewEvent, { type: 'crew' }> => e.type === 'crew')
  const stops = plan?.stops ?? events.flatMap(e => e.type === 'stop' ? [e.stop] : [])
  const walkKm = plan ? (plan.legs.reduce((s, l) => s + l.distanceM, 0) / 1000).toFixed(1) : ''
  const walkMin = plan ? Math.round(plan.legs.reduce((s, l) => s + l.durationSec, 0) / 60) : 0

  return (
    <div className="book" data-ground="parchment" data-over-city={overCity || undefined}>
      <div className="book-panel">
        {phase === 'ask' && (
          <>
            <header className="book-brand">
              <small>A walking tour, then a flight</small>
              <h1>Orion</h1>
              <p>Name a place. An AI crew plans your day on real streets, then a guide flies you through it over the real city.</p>
            </header>
            <form className="book-form" onSubmit={e => { e.preventDefault(); const q = query.trim(); if (q) onSubmit(q, chosen) }}>
              <div className="book-search">
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Kyoto, the Marais, a neighbourhood…"
                  aria-label="Place to tour"
                  disabled={busy}
                />
                <button type="submit" disabled={busy || !query.trim()}>{busy ? 'Looking…' : 'Plan the day'}</button>
              </div>
              <div className="book-modes" role="group" aria-label="Tour length">
                <button type="button" aria-pressed={chosen === 'short'} onClick={() => setChosen('short')}>Short walk</button>
                <button type="button" aria-pressed={chosen === 'full'} onClick={() => setChosen('full')}>Full day</button>
              </div>
            </form>
            <button className="book-demo" type="button" onClick={onDemo}>Watch a Paris flythrough (demo)</button>
          </>
        )}

        {phase === 'planning' && (
          <>
            <header className="book-city">
              <small style={{ letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--faint)', fontSize: 11 }}>The crew is at work</small>
              <h2>{city || 'Finding the place'}</h2>
              <p>{city ? `Choosing a ${mode === 'short' ? 'short' : 'full'} walk nearby.` : 'Looking the name up…'}</p>
            </header>
            <button className="book-demo" type="button" onClick={onReset}>Cancel</button>
            <ol className="book-log" aria-live="polite">
              {crew.map((e, i) => (
                <li key={i} data-state={e.state} data-kind={e.kind}>
                  <b>{e.agent}</b>
                  {e.kind === 'tool' && <em>code</em>}
                  {e.kind === 'agent' && <em>model</em>}
                  <span>{e.detail}</span>
                </li>
              ))}
            </ol>
          </>
        )}

        {phase === 'reading' && plan && (
          <>
            <header className="book-city">
              <small style={{ letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--faint)', fontSize: 11 }}>
                {plan.mode === 'short' ? 'A short walk' : 'A day on foot'}
              </small>
              <h2>{plan.city}</h2>
              <p>{plan.stops.length} stops · {walkKm} km · about {walkMin} min of walking</p>
            </header>
            <div className="book-stops">
              {plan.stops.map((s, i) => (
                <article className="book-stop" key={s.id}>
                  {s.photo
                    ? <img src={s.photo.url} alt="" />
                    : <div className="ph" aria-hidden>{i + 1}</div>}
                  <div>
                    <h3>{s.name}</h3>
                    <p>{s.blurb}</p>
                  </div>
                  <time>~{s.visitMin} min</time>
                </article>
              ))}
            </div>
            <div className="book-actions">
              <button type="button" onClick={onBegin}>Begin tour</button>
              <button type="button" className="quiet" onClick={onReset}>Plan another</button>
            </div>
          </>
        )}

        {phase === 'planning' && stops.length > 0 && (
          <div className="book-stops">
            {stops.map((s, i) => (
              <article className="book-stop" key={s.id}>
                {s.photo ? <img src={s.photo.url} alt="" /> : <div className="ph" aria-hidden>{i + 1}</div>}
                <div>
                  <h3>{s.name}</h3>
                  <p>{s.blurb}</p>
                </div>
                <time>~{s.visitMin} min</time>
              </article>
            ))}
          </div>
        )}

        {error && (
          <p className="book-error" role="alert">
            {error}
            {phase !== 'ask' && <> <button type="button" className="book-demo" onClick={onReset}>Start over</button></>}
          </p>
        )}
      </div>
    </div>
  )
}
