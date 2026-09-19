import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import ErrorBoundary from './ui/ErrorBoundary'
import FlyDev from './fly/dev/FlyDev'
import PlanTest from './fly/dev/PlanTest'
import VRPage from './vr/VRPage'
import { CURRENT } from './vr/share'
import CrewDev from './globe/CrewDev'
import GlobeScene from './globe/GlobeScene'
import type { CrewEvent } from './plan/events'
import Flythrough from './fly/Flythrough'
import type { MapView } from './fly/MapRig'
import Kickoff, { type KickoffResult } from './plan/ui/Kickoff'
import Studio from './plan/ui/Studio'
import SavedTrips from './plan/ui/SavedTrips'
import JournalLibrary from './plan/ui/JournalLibrary'
import { loadTrip, type Saved } from './trips/store'
import type { Day, LatLon } from './types'
import { voiceDay } from './plan/tts'
import { breadcrumb, report, tag, withProfiler } from './telemetry'
import Note from './ui/Note'

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
export type Phase = 'kickoff' | 'studio' | 'journal' | 'flying' | 'done'

/* Before a city is chosen the ground is Paris: complete coverage, and
   recognisable from above within a second of the tiles landing. */
const LANDING: LatLon = { lat: 48.8584, lon: 2.2945 }
const EMPTY_MAP: MapView = { pins: [], routes: [] }

const layer = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: .6, ease: [.22, .9, .24, 1] as const } },
  exit: { opacity: 0, transition: { duration: .35 } },
}

function App() {
  const [phase, setPhase] = useState<Phase>('kickoff')
  // The trail an error will carry: which screen the person was on.
  useEffect(() => { tag('phase', phase); breadcrumb('nav', `phase → ${phase}`) }, [phase])
  const [origin, setOrigin] = useState<LatLon>(LANDING)
  const [kickoff, setKickoff] = useState<KickoffResult | null>(null)
  const [flying, setFlying] = useState<Day | null>(null)
  const [map, setMap] = useState<MapView>(EMPTY_MAP)
  const [globeCity, setGlobeCity] = useState<LatLon | null>(null)
  const [crewEvents, setCrewEvents] = useState<CrewEvent[]>([])
  const [crewWorking, setCrewWorking] = useState(false)
  const audioUrls = useRef<string[]>([])
  const [resume, setResume] = useState<Saved | null>(null)
  const [journalFrom, setJournalFrom] = useState<'kickoff' | 'studio'>('kickoff')
  const [flightFrom, setFlightFrom] = useState<'studio' | 'journal'>('studio')
  // The trip on screen, kept here so leaving the studio (to fly) and coming back does not plan it again.
  const [live, setLive] = useState<Saved | null>(null)

  useEffect(() => () => { audioUrls.current.forEach(URL.revokeObjectURL) }, [])

  // /vr is the headset's address and always shows the trip last sent to it; /?vr=<id> opens one by name.
  const vr = location.pathname === '/vr' ? CURRENT : new URLSearchParams(location.search).get('vr')
  if (vr) return <ErrorBoundary><VRPage id={vr} /></ErrorBoundary>
  // A saved trip, opened as it was: the same screen the crew ends on, with nothing planned again.
  const openSaved = useCallback((id: string) => {
    loadTrip(id).then(t => {
      setResume(t); setLive(null)
      setKickoff({ wish: t.trip.wish, mode: t.mode, origin: t.origin })
      setOrigin({ lat: t.origin.lat, lon: t.origin.lon }); setGlobeCity({ lat: t.origin.lat, lon: t.origin.lon })
      setPhase('studio')
    }).catch(e => report(e, 'trips.open', { level: 'warning' }))
  }, [])
  // /?trip=<id> is a trip's own address.
  useEffect(() => { const id = new URLSearchParams(location.search).get('trip'); if (id) openSaved(id) }, [openSaved])

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

  const onCrew = useCallback((events: CrewEvent[], working: boolean) => { setCrewEvents(events); setCrewWorking(working) }, [])
  const goHome = useCallback(() => { setResume(null); setLive(null); setKickoff(null); setFlying(null); setMap(EMPTY_MAP); setCrewEvents([]); setCrewWorking(false); setGlobeCity(null); setPhase('kickoff') }, [])
  const openJournal = useCallback((from: 'kickoff' | 'studio') => { setJournalFrom(from); setPhase('journal') }, [])
  const startFly = useCallback((day: Day, from: 'studio' | 'journal', saved?: Saved) => {
    void (async () => {
      const voiced = await voiceDay(day, saveAudio)
      if (saved) {
        setResume({ ...saved, trip: { ...saved.trip, days: saved.trip.days.map(d => d.number === voiced.number ? voiced : d) } })
        setKickoff({ wish: saved.trip.wish, mode: saved.mode, origin: saved.origin })
        setOrigin({ lat: saved.origin.lat, lon: saved.origin.lon })
        setGlobeCity({ lat: saved.origin.lat, lon: saved.origin.lon })
      }
      setLive(prev => prev
        ? { ...prev, trip: { ...prev.trip, days: prev.trip.days.map(d => d.number === voiced.number ? voiced : d) } }
        : prev)
      setFlying(voiced)
      setFlightFrom(from)
      setPhase('flying')
    })()
  }, [saveAudio])
  const flySavedDay = useCallback((saved: Saved, day: Day) => startFly(day, 'journal', saved), [startFly])
  const inFlight = phase === 'flying' || phase === 'done'
  // Which world is on screen. The globe is the stage until the trip is written; the real
  // city takes over then. The city's tiles only start loading once there are places to
  // put on them, so they arrive well before they are needed without competing with the globe.
  const onGlobe = phase === 'kickoff' || (phase === 'studio' && crewWorking)
  const showCity = !onGlobe
  const cityWanted = inFlight || (phase === 'studio' && (map.pins.length > 0 || !crewWorking))

  return (
    <ErrorBoundary>
      <main className="orion" data-ground="night">
        <div className="orion-ground" style={{ opacity: showCity ? 1 : 0 }}>
          <Flythrough
            plan={inFlight ? flying : null}
            origin={cityWanted ? origin : null}
            map={map}
            begin={phase === 'flying'}
            onStopReached={() => {}}
            onFinish={() => setPhase('done')}
            onExit={() => setPhase(flightFrom)}
          />
        </div>
        <div className="orion-veil" style={{ opacity: inFlight || !showCity ? 0 : 1 }} />

        <AnimatePresence>
          {onGlobe && (
            <motion.div key="globe" className="orion-globe" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .9 }}>
              <GlobeScene mode={phase === 'kickoff' ? 'kickoff' : 'crew'} city={globeCity} events={crewEvents} places={map.pins.filter(p => !p.home)} className="orion-globe-canvas" />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {phase === 'kickoff' && (
            <motion.div key="kickoff" className="orion-layer" {...layer}>
              <Kickoff onCity={p => { setOrigin({ lat: p.lat, lon: p.lon }); setGlobeCity({ lat: p.lat, lon: p.lon }) }}
                onStart={r => { setResume(null); setLive(null); setKickoff(r); setOrigin({ lat: r.origin.lat, lon: r.origin.lon }); setPhase('studio') }} />
              <SavedTrips onOpenJournal={() => openJournal('kickoff')} />
            </motion.div>
          )}
          {phase === 'studio' && kickoff && (
            <motion.div key="studio" className="orion-layer" {...layer}>
              {/* Keyed on the brief: new preferences are a new session, not an edit of the old one. */}
              <Studio key={resume?.id ?? `${kickoff.origin.name}-${kickoff.wish.days}-${kickoff.mode}`} saved={live ?? resume ?? undefined} onTrip={setLive}
                wish={kickoff.wish} mode={kickoff.mode} origin={kickoff.origin}
                onFly={day => startFly(day, 'studio')}
                onHome={goHome} onJournal={() => openJournal('studio')} onMap={setMap} onCrew={onCrew} saveAudio={saveAudio} />
            </motion.div>
          )}
          {phase === 'journal' && (
            <motion.div key="journal-library" className="orion-layer" {...layer}>
              <JournalLibrary
                onClose={() => setPhase(journalFrom)}
                onPlan={goHome}
                onOpenTrip={openSaved}
                onFly={flySavedDay}
              />
            </motion.div>
          )}
          {phase === 'done' && (
            <motion.div key="done" className="orion-done" {...layer}>
              <div className="o-glass orion-done-card">
                <p className="o-eyebrow">Landed</p>
                <h2 className="o-title" style={{ fontSize: 44 }}>That was {flying ? `day ${flying.number}` : 'the day'}.</h2>
                <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                  <button className="o-btn primary" onClick={() => setPhase(flightFrom)}>{flightFrom === 'journal' ? 'Back to the journal' : 'Back to the trip'}</button>
                  <button className="o-btn" onClick={goHome}>Plan another</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <Note />
      </main>
    </ErrorBoundary>
  )
}

export default withProfiler(App)
