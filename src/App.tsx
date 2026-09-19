import { useCallback, useEffect, useRef, useState } from 'react'
import ErrorBoundary from './ui/ErrorBoundary'
import FlyDev from './fly/dev/FlyDev'
import PlanTest from './fly/dev/PlanTest'
import Flythrough from './fly/Flythrough'
import Desk, { type DeskResult } from './plan/ui/Desk'
import Home from './plan/ui/Home'
import Storybook from './plan/ui/Storybook'
import type { CrewEvent } from './plan/events'
import { planTrip } from './plan/pipeline'
import type { Day, LatLon, Trip } from './types'
import { HHMM, MINS } from './types'
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
export type Phase = 'home' | 'ask' | 'planning' | 'reading' | 'flying' | 'done'

/* The front page is not a black screen with type on it: the tiles of a real
   city load under it from the first frame, which also means the renderer is
   warm and a session with Google is open by the time anyone presses a button. */
const LANDING: LatLon = { lat: 48.8584, lon: 2.2945 }

export default function App() {
  const [phase, setPhase] = useState<Phase>('home')
  const [origin, setOrigin] = useState<LatLon | null>(LANDING)
  const [trip, setTrip] = useState<Trip | null>(null)
  const [flying, setFlying] = useState<Day | null>(null)
  const [events, setEvents] = useState<CrewEvent[]>([])
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  const audioUrls = useRef<string[]>([])

  useEffect(() => () => {
    abort.current?.abort()
    audioUrls.current.forEach(URL.revokeObjectURL)
  }, [])

  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search)
    if (q.has('fly-dev')) return <ErrorBoundary><FlyDev /></ErrorBoundary>
    if (q.has('plan-test')) {
      return <ErrorBoundary><PlanTest id={q.get('plan-test') || 'paris-short-v1'} /></ErrorBoundary>
    }
  }

  /* ------------------------------------------------------------ planning -- */

  const run = useCallback(async ({ wish, mode, origin: city }: DeskResult) => {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    setOrigin({ lat: city.lat, lon: city.lon })
    setTrip(null); setEvents([]); setError(''); setPhase('planning')

    /* The book opens before the trip exists and fills as the crew reports:
       each finished day arrives as its own event, so page one is readable
       while day three is still being written. */
    const provisional = (days: Day[]): Trip => ({
      id: 'in-progress', city: city.name, origin: { lat: city.lat, lon: city.lon },
      wish, days, stays: [], preface: '', generatedAt: new Date().toISOString(),
      provenance: { places: 'Wikipedia', lodging: 'OpenStreetMap', food: 'OpenStreetMap', router: 'Google Routes', narrator: 'llm', tts: 'elevenlabs' },
    })

    try {
      const made = await planTrip(wish, {
        mode, signal: ctl.signal,
        onEvent: e => {
          if (ctl.signal.aborted) return
          setEvents(list => [...list, e])
          if (e.type === 'plan') {
            setTrip(t => {
              const days = [...(t?.days ?? [])]
              const number = days.length + 1
              days.push({ ...e.plan, number, title: `Day ${number}`, tables: [] })
              return t ? { ...t, days } : provisional(days)
            })
          }
          if (e.type === 'trip') setTrip(e.trip)
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
      setTrip(made); setPhase('reading')
    } catch (e) {
      if (ctl.signal.aborted) return
      setError(e instanceof Error ? e.message : String(e))
      setPhase('ask')
    }
  }, [])

  /* Home abandons whatever is in flight. Anything half-planned is cheap to
     make again and expensive to leave running behind a page that says nothing
     is happening. */
  const goHome = useCallback(() => {
    abort.current?.abort()
    setTrip(null); setFlying(null); setEvents([]); setError(''); setPhase('home')
  }, [])

  /* The one edit the book allows. Changing how long you stay somewhere moves
     every arrival after it on that day — otherwise the book quietly starts
     lying about the one number a person actually relies on. */
  const onStay = useCallback((dayNumber: number, stopId: string, minutes: number) => setTrip(t => {
    if (!t) return t
    return {
      ...t,
      days: t.days.map(d => {
        if (d.number !== dayNumber) return d
        const stops = d.stops.map(s => s.id === stopId ? { ...s, visitMin: minutes } : s)
        let clock = MINS(d.wish.startAt) + (d.approach?.durationSec ?? 0) / 60
        return {
          ...d,
          stops: stops.map((s, i) => {
            const arrival = HHMM(clock)
            clock += s.visitMin + (d.legs[i]?.durationSec ?? 0) / 60
            return { ...s, arrival }
          }),
        }
      }),
    }
  }), [])

  const planning = phase === 'planning'
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
            onExit={() => setPhase('reading')}
          />
        </div>

        {!inFlight && (
          <div className="jr-stage orion-overlay">
            {phase === 'home' && <Home onStart={() => setPhase('ask')} />}
            {phase === 'ask' && (
              <Desk
                onCity={p => p && setOrigin({ lat: p.lat, lon: p.lon })}
                onPlan={r => void run(r)}
                onHome={goHome}
                error={error}
              />
            )}
            {(planning || phase === 'reading') && trip && (
              <Storybook trip={trip} events={events} planning={planning}
                onFly={day => { setFlying(day); setPhase('flying') }}
                onClose={() => { abort.current?.abort(); setPhase('ask') }}
                onHome={goHome}
                onStay={onStay} />
            )}
            {planning && !trip && <Waiting events={events} />}
          </div>
        )}

        {phase === 'done' && (
          <div className="orion-done">
            <p>That was {flying ? `day ${flying.number}` : 'the day'}.</p>
            <button className="jr-btn" onClick={() => setPhase('reading')}>Back to the book</button>
            <button className="jr-btn ghost" onClick={goHome}>Plan another</button>
          </div>
        )}
      </main>
    </ErrorBoundary>
  )
}

/* The gap between pressing the key and the first page existing: the geocoder,
   Wikipedia and the scout, some seconds. It shows what is actually happening
   rather than a spinner, because there is something true to say. */
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
