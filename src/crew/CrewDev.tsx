import { useEffect, useState } from 'react'
import type { CrewEvent } from '../plan/events'
import CrewScene from './CrewScene'

/* Dev preview at /?crew-dev: replays a scripted run of the crew so the scene can be
   built and judged without waiting for a real plan. Not shipped to users. */
const S = (agent: any, kind: 'tool' | 'agent', state: any, detail: string): CrewEvent => ({ type: 'crew', agent, kind, state, detail })
const SCRIPT: [number, CrewEvent][] = [
  [0.5, S('Geocode', 'tool', 'working', 'Fixing Paris on the map')],
  [2.0, S('Geocode', 'tool', 'done', 'Paris, Île-de-France')],
  [2.2, S('Scout', 'agent', 'working', 'Naming 7 well-known places in Paris')],
  [6.5, S('Scout', 'agent', 'done', 'Eiffel Tower · Louvre · Notre-Dame de Paris · Arc de Triomphe · Sacré-Cœur')],
  [6.8, S('Router', 'tool', 'working', 'Day 1: measuring real travel times')],
  [8.6, S('Router', 'tool', 'done', 'Day 1: 9.4 km, walking and transit')],
  [8.8, S('Timekeeper', 'tool', 'working', 'Fitting the day to 09:30–18:00')],
  [10.0, S('Timekeeper', 'tool', 'done', '438 min in all, 96 of them at the table')],
  [10.2, S('Critic', 'agent', 'working', 'Reviewing the day')],
  [13.0, S('Critic', 'agent', 'done', 'Approved')],
  [13.2, S('Narrator', 'agent', 'working', 'Writing 5 pages')],
  [16.0, S('Auditor', 'tool', 'failed', 'Louvre: 2 statements not in the source — sent back')],
  [17.0, S('Auditor', 'tool', 'done', 'Louvre: 4 of 6 statements traced at first, all 4 after the rewrite')],
  [18.5, S('Narrator', 'agent', 'done', '5 pages written')],
  [18.7, S('Voice', 'agent', 'working', 'Recording 12 lines')],
  [22.0, S('Voice', 'agent', 'done', '12 lines recorded')],
]

export default function CrewDev() {
  const [events, setEvents] = useState<CrewEvent[]>([])
  const [run, setRun] = useState(0)
  useEffect(() => {
    setEvents([])
    const timers = SCRIPT.map(([t, e]) => setTimeout(() => setEvents(list => [...list, e]), t * 1000))
    return () => timers.forEach(clearTimeout)
  }, [run])
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(90% 70% at 50% 45%, #171922, #07080b)' }}>
      <CrewScene events={events} className="cs-full" />
      <button className="o-btn" style={{ position: 'absolute', left: 20, top: 20 }} onClick={() => setRun(r => r + 1)}>Replay</button>
    </div>
  )
}
