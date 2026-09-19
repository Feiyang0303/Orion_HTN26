import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import CrewStage from './CrewStage'
import TripView from './TripView'
import Journal from './Journal'
import Icon from '../../ui/Icon'
import { vrLink } from '../../vr/share'
import { newId, saveTrip, type Saved } from '../../trips/store'
import { dayColour } from '../../ui/palette'
import type { MapView } from '../../fly/MapRig'
import type { CrewEvent } from '../events'
import {
  applyEdits, openSession, revise, stagePlaces, stagePlan, stageStay,
  type DayDraft, type Session,
} from '../session'
import { report } from '../../telemetry'
import type { Mode } from '../narrator'
import type { Place } from '../geocode'
import type { Day, LatLon, Stay, Trip, Wish } from '../../types'

/* The studio: where the crew works with someone watching, and where the result is read.
 *
 * It used to be three rooms, each ending in a decision the person had to make
 * before the crew would go on (a bed, then the places, then the plan). That was
 * the crew waiting for permission to do its job, and the person waiting for the
 * crew. Now the crew simply does the work, start to finish, in front of them: the
 * places appear on the real city as they are verified, the bed is chosen from the
 * finished plan, the days are routed and written, and then the trip is there to be
 * read and, in plain words, changed. Changing it is a conversation with the editor,
 * which can only ask for things from a fixed menu, so it can never invent a place.
 */

type Line = { who: 'you' | 'editor'; text: string }

export default function Studio({ wish, mode, origin, saved: given, onTrip, onFly, onHome, onMap, onCrew, saveAudio }: {
  wish: Wish
  mode: Mode
  origin: Place
  /** A trip that was saved earlier: opened as it was, with nothing planned again. */
  saved?: Saved
  /** Told whenever there is a trip (and each time it changes), so the shell can hand it back if this screen is left and returned to. */
  onTrip?: (s: Saved) => void
  onFly: (day: Day) => void
  onHome: () => void
  onMap: (view: MapView) => void
  /** What the crew is doing, for the globe behind the screen. */
  onCrew: (events: CrewEvent[], working: boolean) => void
  saveAudio: (planId: string, name: string, bytes: ArrayBuffer) => Promise<string>
}) {
  // Read once. The shell keeps the current trip up to date in this prop, and that must never restart the run.
  const [saved] = useState(given)
  const [events, setEvents] = useState<CrewEvent[]>([])
  const [drafts, setDrafts] = useState<DayDraft[]>([])
  const [stay, setStay] = useState<Stay | null>(null)
  const [partial, setPartial] = useState<Day[]>([])
  const [trip, setTrip] = useState<Trip | null>(null)
  const [error, setError] = useState('')
  const [eventId, setEventId] = useState<string | undefined>()
  const [attempt, setAttempt] = useState(0)
  const [dayIx, setDayIx] = useState<number | 'all'>('all')
  const [focus, setFocus] = useState<LatLon | null>(null)
  const [chat, setChat] = useState<Line[]>([])
  const [draftMsg, setDraftMsg] = useState('')
  const [editing, setEditing] = useState(false)
  const [asking, setAsking] = useState(false)
  const session = useRef<Session | null>(null)

  const onEvent = useCallback((e: CrewEvent) => {
    setEvents(list => [...list, e])
    if (e.type === 'plan') setPartial(p => [...p.filter(d => d.number !== (e.plan as Day).number), e.plan as Day])
    if (e.type === 'trip') setTrip(e.trip)
  }, [])

  /* ------------------------------------------------------ the whole run -- */

  useEffect(() => {
    const ctl = new AbortController()
    setEvents([]); setDrafts([]); setStay(null); setPartial([]); setTrip(null); setError(''); setEventId(undefined)
    void (async () => {
      try {
        const s = await openSession(wish, mode, origin, onEvent, ctl.signal)
        session.current = s
        if (saved) {
          // Resuming: the trip is as it was, so the editor is handed what it needs to change it without writing the rest again.
          for (const d of saved.trip.days) for (const st of d.stops) s.written.set(st.id, st)
          // The bed matters as much: days are routed out from it, so an edit that rebuilds one must still start there.
          s.bed = saved.trip.stays[0] ?? null; s.offered.push(...saved.trip.stays.map(b => b.id))
          setStay(s.bed); setTrip(saved.trip)
          return
        }
        const found = await stagePlaces(s)
        if (ctl.signal.aborted) return
        setDrafts(found)
        // Where to sleep depends on where the days are, so it waits for the places, and nothing else does.
        const stays = await stageStay(s, found)
        if (ctl.signal.aborted) return
        setStay(stays[0] ?? null)
        const made = await stagePlan(s, found, { saveAudio, onEvent, signal: ctl.signal })
        if (!ctl.signal.aborted) setTrip(made)
      } catch (e) {
        if (!ctl.signal.aborted) {
          const id = report(e, 'studio.plan', { extra: { city: origin.name, days: wish.days } })
          setEventId(id)
          setError(e instanceof Error ? e.message : String(e))
        }
      }
    })()
    return () => ctl.abort()
  }, [wish, mode, origin, saved, attempt, saveAudio, onEvent])

  /* ---------------------------------------------------------- keeping it -- */

  // Every trip is saved as soon as it exists and again after each change the editor makes.
  const tripKey = useRef(saved?.id ?? newId())
  const lastSaved = useRef<Trip | null>(saved?.trip ?? null)
  const [keep, setKeep] = useState<'idle' | 'saving' | 'saved' | 'local' | 'failed'>('idle')
  const persist = useCallback(async (t: Trip) => {
    setKeep('saving')
    try { const r = await saveTrip(tripKey.current, t, mode, origin); lastSaved.current = t; setKeep(r.persistent ? 'saved' : 'local'); return true }
    catch { setKeep('failed'); return false }
  }, [mode, origin])
  useEffect(() => { if (trip) onTrip?.({ id: tripKey.current, trip, mode, origin, updatedAt: Date.now() }) }, [trip, mode, origin, onTrip])
  useEffect(() => {
    if (!trip || trip === lastSaved.current) return
    const t = setTimeout(() => { void persist(trip) }, 1200)
    return () => clearTimeout(t)
  }, [trip, persist])

  const [vr, setVr] = useState<{ state: 'idle' | 'busy' | 'ready' | 'failed'; url?: string }>({ state: 'idle' })
  const openInVr = useCallback(async () => {
    if (!trip) return
    setVr({ state: 'busy' })
    try {
      if (trip !== lastSaved.current && !(await persist(trip))) throw new Error('not saved')
      setVr({ state: 'ready', url: await vrLink(tripKey.current) })
    } catch { setVr({ state: 'failed' }) }
  }, [trip, persist])

  /* ------------------------------------------------------------- the map -- */

  const stage = trip ? 'trip' : 'crew'
  useEffect(() => { onCrew(events, !trip) }, [events, trip, onCrew])
  useEffect(() => {
    const days = trip?.days ?? partial
    const pins: MapView['pins'] = []
    const routes: MapView['routes'] = []
    if (stay) pins.push({ id: 'stay', lat: stay.lat, lon: stay.lon, label: '⌂', name: stay.name, colour: '#ffffff', home: true })
    if (days.length) {
      // How long each leg takes is written on it, unless several days are on the map at once and it would be a thicket.
      const pills = !!trip && (dayIx !== 'all' || days.length === 1)
      days.forEach((d, di) => {
        const c = dayColour((d.number ?? di + 1) - 1)
        const dim = dayIx !== 'all' && dayIx !== d.number
        d.stops.forEach((s, k) => pins.push({ id: `${d.number}:${s.id}`, lat: s.lat, lon: s.lon, label: String(k + 1), name: dim ? undefined : s.name, colour: c }))
        d.legs.forEach((l, k) => routes.push({ id: `${d.number}:${k}`, points: l.polyline, colour: c, dim, transport: l.transport, estimated: l.estimated, label: pills ? `${Math.max(1, Math.round(l.durationSec / 60))} min` : undefined }))
        if (d.approach) routes.push({ id: `${d.number}:approach`, points: d.approach.polyline, colour: c, dim, transport: d.approach.transport, estimated: d.approach.estimated, label: pills ? `${Math.max(1, Math.round(d.approach.durationSec / 60))} min` : undefined })
      })
    } else {
      drafts.forEach((d, di) => d.stops.forEach((c, k) => pins.push({ id: `${di}:${c.id}`, lat: c.lat, lon: c.lon, label: String(k + 1), name: c.name, colour: dayColour(di), fresh: true })))
    }
    onMap({ pins, routes, focus, distance: trip ? 0.85 : 1 })
  }, [drafts, partial, trip, stay, dayIx, focus, onMap])

  /* ------------------------------------------------------------ the editor -- */

  const send = useCallback(async () => {
    const text = draftMsg.trim()
    if (!text || !trip || !session.current || asking) return
    setDraftMsg(''); setEditing(true)
    setChat(c => [...c, { who: 'you', text }])
    setAsking(true)
    try {
      const r = await revise(trip, text)
      setChat(c => [...c, { who: 'editor', text: r.reply || 'Done.' }])
      const real = r.edits.filter(e => e.op !== 'none')
      if (real.length) {
        const { trip: next, rebuilt, notes } = await applyEdits(session.current, trip, real, { saveAudio, onEvent })
        setTrip(next)
        if (notes.length) setChat(c => [...c, { who: 'editor', text: `${notes.join('; ')}.${rebuilt.length ? ` Day${rebuilt.length === 1 ? '' : 's'} ${rebuilt.join(', ')} redone.` : ''}` }])
      }
    } catch (e) {
      const id = report(e, 'studio.revise', { extra: { city: origin.name } })
      setChat(c => [...c, { who: 'editor', text: `That did not work: ${e instanceof Error ? e.message : String(e)}${id ? ` (${id})` : ''}` }])
    }
    finally { setAsking(false) }
  }, [draftMsg, trip, asking, saveAudio, onEvent])

  const last = useMemo(() => events.filter(e => e.type === 'crew').at(-1) as Extract<CrewEvent, { type: 'crew' }> | undefined, [events])
  /* The same trip, read as a book: paper spreads, the map that unfolds, the
     bed's page with the street outside it. It is a way of reading the plan,
     not a second plan — the editor below still changes the one trip. */
  const [book, setBook] = useState(false)

  if (stage === 'crew') {
    return <CrewStage city={origin.name} events={events} drafts={drafts} error={error} eventId={eventId} onRetry={() => setAttempt(a => a + 1)} onBack={onHome} />
  }

  return (
    <div className="tv">
      <div className="tv-bar">
        <button className="o-btn quiet small" onClick={onHome}>← New trip</button>
        <button className="o-btn small" onClick={openInVr} disabled={vr.state === 'busy' || asking}>{vr.state === 'busy' ? 'Preparing…' : 'View in VR'}</button>
        {keep !== 'idle' && (
          <span className={`tv-keep is-${keep}`} role="status">{{ saving: 'Saving…', saved: 'Saved to your trips', local: 'Saved until the server restarts', failed: 'Not saved', idle: '' }[keep]}</span>
        )}
        {vr.state === 'ready' && vr.url && (
          <p className="tv-vr o-glass">
            Open this on the headset’s browser: <a href={vr.url} target="_blank" rel="noreferrer">{vr.url}</a>
            {!vr.url.startsWith('https:') && <em> VR needs https: restart with “npm run vr”.</em>}
          </p>
        )}
        {vr.state === 'failed' && <p className="tv-vr o-glass">Couldn’t prepare the trip for VR.</p>}
      </div>
      <TripView trip={trip!} day={dayIx} onDay={setDayIx} onFly={onFly} onFocus={setFocus} planning={asking} onBook={() => setBook(true)} />

      <AnimatePresence>
        {/* Fixed and above the trip panel, below the editor bar, which stays
            where it is: the journal is a way of reading the plan, the editor
            is how the plan is changed, and both belong on screen together. */}
        {book && trip && (
          <motion.div key="book" style={{ position: 'fixed', inset: 0, zIndex: 5 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .45 }}>
            <Journal trip={trip} onFly={onFly} onHome={onHome} onClose={() => setBook(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.section className="ed o-glass" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .6, duration: .7, ease: [.22, .9, .24, 1] }}>
        <AnimatePresence initial={false}>
          {(editing || chat.length > 0) && (
            <motion.div key="log" className="ed-log" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              <ol>
                {chat.map((l, i) => <li key={i} className={`is-${l.who}`}><span>{l.text}</span></li>)}
                {asking && <li className="is-editor is-busy"><span>{last ? `${last.agent}: ${last.detail}` : 'Reading the plan…'}</span></li>}
              </ol>
            </motion.div>
          )}
        </AnimatePresence>
        <form onSubmit={e => { e.preventDefault(); void send() }}>
          <Icon name="spark" size={17} className="ed-spark" />
          <input value={draftMsg} onChange={e => setDraftMsg(e.target.value)} disabled={asking} onFocus={() => setEditing(true)}
            placeholder="Ask the editor to change something: “make day 2 quieter”, “skip the museum”…" aria-label="Ask the editor" />
          <button type="submit" className="o-btn primary small" disabled={asking || !draftMsg.trim()} aria-label="Send"><Icon name="send" size={15} /></button>
        </form>
      </motion.section>
    </div>
  )
}
