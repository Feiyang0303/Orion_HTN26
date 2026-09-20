import { useEffect, useState } from 'react'
import type { CrewEvent } from '../plan/events'
import GlobeScene from './GlobeScene'

/* Dev preview at /?crew-dev: the globe stage driven by a scripted run, so it can be
   judged without waiting for a real plan. Not shipped to users. */
const S = (agent: any, kind: 'tool' | 'agent', state: any, detail: string): CrewEvent => ({ type: 'crew', agent, kind, state, detail })
const SCRIPT: [number, CrewEvent][] = [
  [1.0, S('Geocode', 'tool', 'working', 'Fixing Paris on the map')],
  [3.0, S('Geocode', 'tool', 'done', 'Paris, Île-de-France')],
  [3.2, S('Scout', 'agent', 'working', 'Naming 7 well-known places in Paris')],
  [8.0, S('Scout', 'agent', 'done', 'Eiffel Tower · Louvre · Notre-Dame de Paris')],
  [8.2, S('Router', 'tool', 'working', 'Day 1: measuring real travel times')],
  [10.5, S('Router', 'tool', 'done', 'Day 1: 9.4 km')],
  [10.7, S('Timekeeper', 'tool', 'working', 'Fitting the day to 09:30–18:00')],
  [12.0, S('Timekeeper', 'tool', 'done', '438 min in all')],
  [12.2, { type: 'verdict', judge: 'Timekeeper', scope: 'day', ok: true, issues: [] }],
  [12.4, S('Critic', 'agent', 'working', 'Judging the day')],
  [14.0, { type: 'verdict', judge: 'Critic', scope: 'day', ok: false, issues: [{ id: 'j1', text: 'Three churches in a row — swap one for a park.', owner: 'Scout' }] }],
  [14.2, S('Critic', 'agent', 'failed', 'Three churches in a row — swap one for a park.')],
  [14.4, S('Scout', 'agent', 'reworking', 'Choosing again to fix: Three churches in a row')],
  [16.5, S('Scout', 'agent', 'done', 'Eiffel Tower · Louvre · Luxembourg Gardens')],
  [16.7, { type: 'verdict', judge: 'Critic', scope: 'day', ok: true, issues: [{ id: 'j1', text: 'Three churches in a row — swap one for a park.', owner: 'Scout' }] }],
  [16.8, S('Critic', 'agent', 'done', 'Approved')],
  [17.2, S('Narrator', 'agent', 'working', 'Writing 5 pages')],
  [22.0, S('Narrator', 'agent', 'done', '5 pages written')],
  [22.2, S('Voice', 'agent', 'working', 'Recording 12 lines')],
  [26.0, S('Voice', 'agent', 'done', '12 lines recorded')],
  [26.2, S('Director', 'agent', 'working', 'Day 1: walking round the Louvre (3 of 14)')],
  [33.0, S('Director', 'agent', 'done', 'Day 1: all 14 shots chosen by looking')],
]
const PLACES = [[48.8584, 2.2945], [48.8606, 2.3376], [48.853, 2.3499], [48.8738, 2.295], [48.8867, 2.3431], [48.86, 2.3266], [48.8566, 2.3122]].map(([lat, lon]) => ({ lat, lon }))

export default function CrewDev() {
  const [events, setEvents] = useState<CrewEvent[]>([])
  const [run, setRun] = useState(0)
  const [mode, setMode] = useState<'kickoff' | 'crew'>('kickoff')
  const [city, setCity] = useState<{ lat: number; lon: number } | null>(null)
  const [places, setPlaces] = useState<{ lat: number; lon: number }[]>([])
  useEffect(() => {
    setEvents([]); setPlaces([]); setMode('kickoff'); setCity(null)
    const timers = [
      setTimeout(() => setCity({ lat: 48.8589, lon: 2.32 }), 3500),
      setTimeout(() => setMode('crew'), 6500),
      ...SCRIPT.map(([t, e]) => setTimeout(() => setEvents(l => [...l, e]), (t + 8) * 1000)),
      ...PLACES.map((p, i) => setTimeout(() => setPlaces(l => [...l, p]), (12 + i * .7) * 1000)),
    ]
    return () => timers.forEach(clearTimeout)
  }, [run])
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(90% 70% at 50% 45%, #14161f, #06070a)' }}>
      <GlobeScene mode={mode} city={city} events={events} places={places} className="cs-full" />
      <button className="o-btn" style={{ position: 'absolute', left: 20, top: 20 }} onClick={() => setRun(r => r + 1)}>Replay</button>
    </div>
  )
}
