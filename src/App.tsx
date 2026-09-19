import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import ErrorBoundary from './ui/ErrorBoundary'
import FlyDev from './fly/dev/FlyDev'
import PlanTest from './fly/dev/PlanTest'
import CrewDev from './crew/CrewDev'
import Flythrough from './fly/Flythrough'
import type { MapView } from './fly/MapRig'
import Kickoff, { type KickoffResult } from './plan/ui/Kickoff'
import Studio from './plan/ui/Studio'
import type { Day, LatLon } from './types'
import { breadcrumb, tag } from './telemetry'

/* The shell. One canvas (the real city, in 3D, owned by src/fly) is the ground
 * of every screen from the first frame, and each screen is a layer of glass laid
 * over it. Nothing ever replaces the city: kickoff, the crew at work, the
 * itinerary and the flight are five views of one place, so the tiles are warm
 * by the time anyone needs them and the world never changes under their hands.
 *
 *   kickoff  ->  studio (the crew works, then the trip is read)  ->  flying  ->  done
 *
 * A trip has no single route, so `flying` always carries one Day, and a Day is a
 * Plan, which is exactly what the flythrough has always taken.
 */
export type Phase = 'kickoff' | 'studio' | 'flying' | 'done'

/* Before a city is chosen the ground is Paris: complete coverage, and
   recognisable from above within a second of the tiles landing. */
const LANDING: LatLon = { lat: 48.8584, lon: 2.2945 }
const EMPTY_MAP: MapView = { pins: [], routes: [] }

const layer = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: .6, ease: [.22, .9, .24, 1] as const } },
  exit: { opacity: 0, transition: { duration: .35 } },
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('kickoff')
  // The trail an error will carry: which screen the person was on.
  useEffect(() => { tag('phase', phase); breadcrumb('nav', `phase → ${phase}`) }, [phase])
  const [origin, setOrigin] = useState<LatLon>(LANDING)
  const [kickoff, setKickoff] = useState<KickoffResult | null>(null)
  const [flying, setFlying] = useState<Day | null>(null)
  const [map, setMap] = useState<MapView>(EMPTY_MAP)
  const audioUrls = useRef<string[]>([])

  useEffect(() => () => { audioUrls.current.forEach(URL.revokeObjectURL) }, [])

  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search)
    if (q.has('crew-dev')) return <ErrorBoundary><CrewDev /></ErrorBoundary>
    if (q.has('fly-dev')) return <ErrorBoundary><FlyDev /></ErrorBoundary>
    if (q.has('plan-test')) return <ErrorBoundary><PlanTest id={q.get('plan-test') || 'paris-short-v1'} /></ErrorBoundary>
  }

  // Audio lives in the page, not on disk: a blob URL per beat, revoked when the shell unmounts.
  const saveAudio = useCallback(async (_id: string, _name: string, bytes: ArrayBuffer) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
    audioUrls.current.push(url)
    return url
  }, [])

  const goHome = useCallback(() => { setKickoff(null); setFlying(null); setMap(EMPTY_MAP); setPhase('kickoff') }, [])
  const inFlight = phase === 'flying' || phase === 'done'

  return (
    <ErrorBoundary>
      <main className="orion" data-ground="night">
        <div className="orion-ground">
          <Flythrough
            plan={inFlight ? flying : null}
            origin={origin}
            map={map}
            begin={phase === 'flying'}
            onStopReached={() => {}}
            onFinish={() => setPhase('done')}
            onExit={() => setPhase('studio')}
          />
        </div>
        <div className="orion-veil" style={{ opacity: inFlight ? 0 : 1 }} />

        <AnimatePresence mode="wait">
          {phase === 'kickoff' && (
            <motion.div key="kickoff" className="orion-layer" {...layer}>
              <Kickoff onCity={p => setOrigin({ lat: p.lat, lon: p.lon })}
                onStart={r => { setKickoff(r); setOrigin({ lat: r.origin.lat, lon: r.origin.lon }); setPhase('studio') }} />
            </motion.div>
          )}
          {phase === 'studio' && kickoff && (
            <motion.div key="studio" className="orion-layer" {...layer}>
              {/* Keyed on the brief: new preferences are a new session, not an edit of the old one. */}
              <Studio key={`${kickoff.origin.name}-${kickoff.wish.days}-${kickoff.mode}`}
                wish={kickoff.wish} mode={kickoff.mode} origin={kickoff.origin}
                onFly={day => { setFlying(day); setPhase('flying') }}
                onHome={goHome} onMap={setMap} saveAudio={saveAudio} />
            </motion.div>
          )}
          {phase === 'done' && (
            <motion.div key="done" className="orion-done" {...layer}>
              <div className="o-glass orion-done-card">
                <p className="o-eyebrow">Landed</p>
                <h2 className="o-title" style={{ fontSize: 44 }}>That was {flying ? `day ${flying.number}` : 'the day'}.</h2>
                <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                  <button className="o-btn primary" onClick={() => setPhase('studio')}>Back to the trip</button>
                  <button className="o-btn" onClick={goHome}>Plan another</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </ErrorBoundary>
  )
}
