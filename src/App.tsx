import { useCallback, useEffect, useRef, useState } from 'react'
import ErrorBoundary from './ui/ErrorBoundary'
import FlyDev from './fly/dev/FlyDev'
import Flythrough from './fly/Flythrough'
import Desk from './plan/ui/Desk'
import Home from './plan/ui/Home'
import Storybook from './plan/ui/Storybook'
import type { CrewEvent } from './plan/events'
import { writePages } from './plan/pipeline'
import type { Skeleton } from './plan/crew'
import type { LatLon, Plan } from './types'
import { HHMM, MINS } from './types'
import './plan/ui/journal.css'

/* The shell. One canvas (tiles, owned by src/fly) sits behind one overlay
 * (the desk and then the book, owned by src/plan) from the first frame, so
 * tiles preload while the day is being planned and read. Ownership hands over
 * at "Begin the flight".
 *
 *   ask  ->  planning  ->  reading  ->  flying  ->  done
 *   A owns everything up to and including reading; B owns flying.
 *
 * The seam is the city: the moment the desk resolves it, the coordinate goes
 * to the canvas and Google's tiles start coming down. By the time the book is
 * written the city underneath it is already there, which is why "Begin the
 * flight" dives instead of loading.
 */
export type Phase = 'home' | 'ask' | 'planning' | 'reading' | 'flying' | 'done'

/* The front page is not a black screen with type on it: it is the thing the
   app does, already happening. The tiles of a real city load under the title
   from the first frame — which also means that by the time anyone has read the
   three panels, the renderer has warmed up and a session with Google is open.
   Paris, because its coverage is complete and it is recognisable from above
   within a second of the tiles landing. */
const LANDING: LatLon = { lat: 48.8584, lon: 2.2945 }

export default function App() {
  const [phase, setPhase] = useState<Phase>('home')
  const [origin, setOrigin] = useState<LatLon | null>(LANDING)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [events, setEvents] = useState<CrewEvent[]>([])
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  const audioUrls = useRef<string[]>([])

  useEffect(() => () => {
    abort.current?.abort()
    audioUrls.current.forEach(URL.revokeObjectURL)
  }, [])

  if (import.meta.env.DEV && new URLSearchParams(location.search).has('fly-dev')) {
    return <ErrorBoundary><FlyDev /></ErrorBoundary>
  }

  /* ------------------------------------------------------------ planning -- */

  const run = useCallback(async (skeleton: Skeleton) => {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setOrigin({ lat: skeleton.origin.lat, lon: skeleton.origin.lon })
    setPlan(null); setEvents([]); setError(''); setPhase('planning')
    try {
      const made = await writePages(skeleton, {
        signal: ctl.signal,
        onEvent: e => {
          if (ctl.signal.aborted) return
          setEvents(list => [...list, e])
          // A stop is shown the moment it exists, so the book fills as the crew
          // works rather than appearing all at once at the end.
          if (e.type === 'stop') {
            setPlan(p => p && ({ ...p, stops: p.stops.map(s => s.id === e.stop.id ? e.stop : s) }))
          }
          if (e.type === 'plan') setPlan(e.plan)
        },
        // Audio lives in the page, not on disk: a blob URL per beat, revoked
        // when the shell unmounts.
        saveAudio: async (_id, _name, bytes) => {
          const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
          audioUrls.current.push(url)
          return url
        },
      })
      if (ctl.signal.aborted) return
      setPlan(made); setPhase('reading')
    } catch (e) {
      if (ctl.signal.aborted) return
      setError(e instanceof Error ? e.message : String(e))
      setPhase('ask')
    }
  }, [])

  /* The one edit the book allows. Changing how long you stay somewhere moves
     every arrival after it — otherwise the book quietly starts lying about the
     one number a person actually relies on. */
  const onStay = useCallback((stopId: string, minutes: number) => setPlan(p => {
    if (!p) return p
    const stops = p.stops.map(s => s.id === stopId ? { ...s, visitMin: minutes } : s)
    let clock = MINS(p.wish.startAt) + (p.approach?.durationSec ?? 0) / 60
    return {
      ...p,
      stops: stops.map((s, i) => {
        const arrival = HHMM(clock)
        clock += s.visitMin + (p.legs[i]?.durationSec ?? 0) / 60
        return { ...s, arrival }
      }),
    }
  }), [])

  const planning = phase === 'planning'
  const flying = phase === 'flying' || phase === 'done'

  return (
    <ErrorBoundary>
      <main data-ground={flying ? 'night' : 'parchment'} className="orion">
        {/* Always mounted, from the first frame: while there is no plan it holds
            a slow view over the city and loads tiles; `begin` is what turns it
            into the flight. */}
        <div className={`orion-ground ${phase === 'home' ? 'is-landing' : ''}`} aria-hidden={!flying}>
          <Flythrough
            plan={flying ? plan : null}
            origin={origin}
            begin={phase === 'flying'}
            onStopReached={() => {}}
            onFinish={() => setPhase('done')}
            onExit={() => setPhase('reading')}
          />
        </div>

        {!flying && (
          <div className="jr-stage orion-overlay">
            {phase === 'home' && <Home onStart={() => setPhase('ask')} />}
            {phase === 'ask' && (
              <Desk
                onCity={p => p && setOrigin({ lat: p.lat, lon: p.lon })}
                onUnfold={s => void run(s)}
                error={error}
              />
            )}
            {(planning || phase === 'reading') && plan && (
              <Storybook plan={plan} events={events} planning={planning}
                onBegin={() => setPhase('flying')}
                onClose={() => { abort.current?.abort(); setPhase('ask') }}
                onStay={onStay} />
            )}
            {planning && !plan && <Waiting events={events} />}
          </div>
        )}

        {phase === 'done' && (
          <div className="orion-done">
            <p>That was the day.</p>
            <button className="jr-btn" onClick={() => setPhase('reading')}>Back to the book</button>
            <button className="jr-btn ghost" onClick={() => setPhase('home')}>Plan another</button>
          </div>
        )}
      </main>
    </ErrorBoundary>
  )
}

/* The gap between pressing the key and the first page existing: the geocoder
   and Wikipedia, a few seconds. It shows what is actually happening rather
   than a spinner, because there is something true to say. */
function Waiting({ events }: { events: CrewEvent[] }) {
  const last = [...events].reverse().find(e => e.type === 'crew') as Extract<CrewEvent, { type: 'crew' }> | undefined
  return (
    <div className="jr-desk orion-waiting">
      <p className="jr-kicker">Orion · two</p>
      <h1 className="jr-cover-title" style={{ fontSize: 32, margin: '4px 0 10px' }}>Opening the book</h1>
      <p className="jr-caption">{last ? `${last.agent}: ${last.detail}` : 'Looking the city up…'}</p>
      <p className="jr-caption">The city itself is already loading behind this page.</p>
    </div>
  )
}
