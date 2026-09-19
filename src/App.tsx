import { useCallback, useEffect, useRef, useState } from 'react'
import ErrorBoundary from './ui/ErrorBoundary'
import FlyDev from './fly/dev/FlyDev'
import PlanTest from './fly/dev/PlanTest'
import Flythrough from './fly/Flythrough'
import Desk, { type DeskResult } from './plan/ui/Desk'
import Home from './plan/ui/Home'
import Studio from './plan/ui/Studio'
import type { Day, LatLon } from './types'
import { breadcrumb, tag } from './telemetry'
import './plan/ui/journal.css'

/* The shell. One canvas (tiles, owned by src/fly) sits behind one overlay
 * (the desk and then the book, owned by src/plan) from the first frame, so
 * tiles preload while the trip is planned and read. Ownership hands over when
 * a day is flown.
 *
 *   home  ->  ask  ->  planning  ->  reading  ->  flying  ->  done
 *
 * A trip has no single route, so `flying` always carries one Day — and a Day
 * is a Plan, which is exactly what the flythrough has always taken.
 */
export type Phase = 'home' | 'ask' | 'studio' | 'flying' | 'done'

/* The front page is not a black screen with type on it: the tiles of a real
   city load under it from the first frame, which also means the renderer is
   warm and a session with Google is open by the time anyone presses a button. */
const LANDING: LatLon = { lat: 48.8584, lon: 2.2945 }

export default function App() {
  const [phase, setPhase] = useState<Phase>('home')
  // The trail an error will carry: which screen the person was on, and in which city.
  useEffect(() => { tag('phase', phase); breadcrumb('nav', `phase → ${phase}`) }, [phase])
  const [origin, setOrigin] = useState<LatLon | null>(LANDING)
  const [desk, setDesk] = useState<DeskResult | null>(null)
  const [flying, setFlying] = useState<Day | null>(null)
  const audioUrls = useRef<string[]>([])

  useEffect(() => () => { audioUrls.current.forEach(URL.revokeObjectURL) }, [])

  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search)
    if (q.has('fly-dev')) return <ErrorBoundary><FlyDev /></ErrorBoundary>
    if (q.has('plan-test')) {
      return <ErrorBoundary><PlanTest id={q.get('plan-test') || 'paris-short-v1'} /></ErrorBoundary>
    }
  }

  // Audio lives in the page, not on disk: a blob URL per beat, revoked when
  // the shell unmounts.
  const saveAudio = useCallback(async (_id: string, _name: string, bytes: ArrayBuffer) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
    audioUrls.current.push(url)
    return url
  }, [])

  const goHome = useCallback(() => { setDesk(null); setFlying(null); setPhase('home') }, [])

  const inFlight = phase === 'flying' || phase === 'done'

  return (
    <ErrorBoundary>
      <main data-ground={inFlight ? 'night' : 'parchment'} className="orion">
        {/* Always mounted, from the first frame: while no day is being flown it
            holds a slow view over the city and loads tiles; `begin` is what
            turns it into the flight. */}
        <div className={`orion-ground ${phase === 'home' ? 'is-landing' : ''}`} aria-hidden={!inFlight}>
          <Flythrough
            plan={inFlight ? flying : null}
            origin={origin}
            begin={phase === 'flying'}
            onStopReached={() => {}}
            onFinish={() => setPhase('done')}
            onExit={() => setPhase('studio')}
          />
        </div>

        {!inFlight && (
          <div className="jr-stage orion-overlay">
            {phase === 'home' && <Home onStart={() => setPhase('ask')} />}
            {phase === 'ask' && (
              <Desk
                onCity={p => p && setOrigin({ lat: p.lat, lon: p.lon })}
                onPlan={r => { setDesk(r); setOrigin({ lat: r.origin.lat, lon: r.origin.lon }); setPhase('studio') }}
                onHome={goHome}
              />
            )}
            {phase === 'studio' && desk && (
              /* Keyed on the desk result: a new set of preferences is a new
                 session, not an edit of the old one. */
              <Studio key={`${desk.origin.name}-${desk.wish.days}-${desk.mode}`}
                wish={desk.wish} mode={desk.mode} origin={desk.origin}
                onFly={day => { setFlying(day); setPhase('flying') }}
                onHome={goHome} onBack={() => setPhase('ask')} saveAudio={saveAudio} />
            )}
          </div>
        )}

        {phase === 'done' && (
          <div className="orion-done">
            <p>That was {flying ? `day ${flying.number}` : 'the day'}.</p>
            <button className="jr-btn" onClick={() => setPhase('studio')}>Back to the book</button>
            <button className="jr-btn ghost" onClick={goHome}>Plan another</button>
          </div>
        )}
      </main>
    </ErrorBoundary>
  )
}
