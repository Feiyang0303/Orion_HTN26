import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mark } from './Marks'
import { markFor } from './decor'
import MapSheet, { type MapLeg, type MapPin } from './MapSheet'
import Storybook, { STOP_COLOURS } from './Storybook'
import type { CrewEvent } from '../events'
import {
  applyEdits, morePlaces, openSession, revise, stageBeds, stagePlaces, stagePlan,
  type DayDraft, type Session,
} from '../session'
import type { Mode } from '../narrator'
import type { Place } from '../geocode'
import type { Day, Stay, Trip, Wish } from '../../types'

/* The studio: where the crew works with someone watching.
 *
 * Three rooms and a conversation. Each room ends in a decision the person
 * makes, and the crew does not go further until they have made it — a bed,
 * then the places, then the plan itself, and after that a chat where the
 * plan is changed by saying what is wrong with it. The crew's own messages
 * run down the side the whole time as a thread, because a plan you watched
 * being made is a plan you trust to have been made.
 */

type Step = 'beds' | 'places' | 'plan'
const STEPS: { key: Step; title: string; hint: string }[] = [
  { key: 'beds', title: 'Sleep', hint: 'Three beds, ranked. Pick one, or ask for three more.' },
  { key: 'places', title: 'Places', hint: 'What the scout chose, by day. Move them, drop them, or take the default.' },
  { key: 'plan', title: 'The plan', hint: 'Routed, timed and fed. Tell the editor what to change.' },
]
const colourAt = (i: number) => STOP_COLOURS[i % STOP_COLOURS.length]

type Line = { who: 'you' | 'editor'; text: string }

export default function Studio({ wish, mode, origin, onFly, onHome, onBack, saveAudio }: {
  wish: Wish
  mode: Mode
  origin: Place
  onFly: (day: Day) => void
  onHome: () => void
  onBack: () => void
  saveAudio: (planId: string, name: string, bytes: ArrayBuffer) => Promise<string>
}) {
  const [step, setStep] = useState<Step>('beds')
  const [events, setEvents] = useState<CrewEvent[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  // Finding a bed runs in the background: a slow OpenStreetMap must never hold the rest of the trip hostage.
  const [bedsBusy, setBedsBusy] = useState(false)
  const step_ = useRef<Step>('beds')
  const [error, setError] = useState('')
  const [beds, setBeds] = useState<Stay[]>([])
  const [bed, setBed] = useState<Stay | null>(null)
  const [drafts, setDrafts] = useState<DayDraft[]>([])
  const [trip, setTrip] = useState<Trip | null>(null)
  const [chat, setChat] = useState<Line[]>([])
  const [draftMsg, setDraftMsg] = useState('')
  const session = useRef<Session | null>(null)
  const abort = useRef(new AbortController())

  const onEvent = useCallback((e: CrewEvent) => {
    setEvents(list => [...list, e])
    if (e.type === 'plan') setTrip(t => t ? { ...t, days: [...t.days, { ...e.plan, number: t.days.length + 1, title: `Day ${t.days.length + 1}`, tables: [] }] } : t)
    if (e.type === 'trip') setTrip(e.trip)
  }, [])

  /* ------------------------------------------------------------- stage 1 */

  const runBeds = useCallback(async () => {
    setBedsBusy(true); setError('')
    try {
      if (!session.current) session.current = await openSession(wish, mode, onEvent, abort.current.signal)
      const found = await stageBeds(session.current)
      if (step_.current !== 'beds') return           // they carried on without one; do not change their mind for them
      setBeds(found); setBed(found[0] ?? null)
    } catch (e) { if (step_.current === 'beds') setError(e instanceof Error ? e.message : String(e)) }
    finally { setBedsBusy(false) }
  }, [wish, mode, onEvent])

  useEffect(() => { void runBeds(); return () => abort.current.abort() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------------------- stage 2 */

  const runPlaces = useCallback(async () => {
    if (!session.current) return
    setBusy('the places'); setError('')
    try {
      step_.current = 'places'
      setDrafts(await stagePlaces(session.current, bed))
      setStep('places')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }, [bed])

  const move = (di: number, k: number, dir: -1 | 1) => setDrafts(ds => {
    const next = ds.map(d => ({ ...d, stops: [...d.stops] }))
    const j = k + dir
    const day = next[di]
    if (j >= 0 && j < day.stops.length) { [day.stops[k], day.stops[j]] = [day.stops[j], day.stops[k]]; return next }
    // Past the end of a day: on to the next one, or back to the previous.
    const to = di + dir
    if (to < 0 || to >= next.length) return ds
    const [c] = day.stops.splice(k, 1)
    if (dir > 0) next[to].stops.unshift(c); else next[to].stops.push(c)
    return next
  })
  const drop = (di: number, k: number) => setDrafts(ds => ds.map((d, i) => i === di ? { ...d, stops: d.stops.filter((_, x) => x !== k) } : d))

  const refill = useCallback(async (di: number) => {
    if (!session.current) return
    setBusy('more places'); setError('')
    try {
      const avoid = drafts.flatMap(d => d.stops)
      const want = Math.max(1, Math.round(drafts.reduce((n, d) => n + d.stops.length, 0) / drafts.length) - drafts[di].stops.length)
      const extra = await morePlaces(session.current, avoid, want)
      setDrafts(ds => ds.map((d, i) => i === di ? { ...d, stops: [...d.stops, ...extra] } : d))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }, [drafts])

  /* ------------------------------------------------------------- stage 3 */

  const runPlan = useCallback(async () => {
    if (!session.current) return
    setBusy('the plan'); setError(''); setTrip(null); setStep('plan')
    try {
      setTrip(await stagePlan(session.current, drafts, { saveAudio, onEvent }))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }, [drafts, saveAudio, onEvent])

  /* ------------------------------------------------------------- stage 4 */

  const send = useCallback(async () => {
    const text = draftMsg.trim()
    if (!text || !trip || !session.current || busy) return
    setDraftMsg('')
    setChat(c => [...c, { who: 'you', text }])
    setBusy('the editor')
    try {
      const r = await revise(trip, text)
      setChat(c => [...c, { who: 'editor', text: r.reply || 'Done.' }])
      const real = r.edits.filter(e => e.op !== 'none')
      if (real.length) {
        const { trip: next, rebuilt, notes } = await applyEdits(session.current, trip, real, { saveAudio, onEvent })
        setTrip(next)
        if (notes.length) setChat(c => [...c, { who: 'editor', text: `${notes.join('; ')}.${rebuilt.length ? ` Day${rebuilt.length === 1 ? '' : 's'} ${rebuilt.join(', ')} redone.` : ''}` }])
      }
    } catch (e) { setChat(c => [...c, { who: 'editor', text: `That did not work: ${e instanceof Error ? e.message : String(e)}` }]) }
    finally { setBusy(null) }
  }, [draftMsg, trip, busy, saveAudio, onEvent])

  /* ----------------------------------------------------------------- map */

  const pins = useMemo<MapPin[]>(() => {
    if (step === 'beds') return beds.map((b, i) => ({ id: b.id, lat: b.lat, lon: b.lon, label: String(i + 1), name: b.name, colour: bed?.id === b.id ? '#9a6b3f' : '#b49b6c', start: true }))
    const out: MapPin[] = bed ? [{ id: bed.id, lat: bed.lat, lon: bed.lon, label: '·', name: bed.name, colour: '#6d5a3c', start: true }] : []
    drafts.forEach((d, di) => d.stops.forEach((c, k) => out.push({ id: c.id, lat: c.lat, lon: c.lon, label: `${di + 1}.${k + 1}`, name: c.name, colour: colourAt(di) })))
    return out
  }, [step, beds, bed, drafts])

  const legs = useMemo<MapLeg[]>(() => {
    if (step === 'beds') return []
    return drafts.flatMap((d, di) => d.stops.slice(1).map((b, k) => ({
      points: [{ lat: d.stops[k].lat, lon: d.stops[k].lon }, { lat: b.lat, lon: b.lon }], colour: colourAt(di), draft: true,
    })))
  }, [step, drafts])

  const stepIndex = STEPS.findIndex(x => x.key === step)
  const crew = events.filter(e => e.type === 'crew') as Extract<CrewEvent, { type: 'crew' }>[]

  /* ---------------------------------------------------------------- plan */

  if (step === 'plan') {
    return (
      <div className="jr-studio-plan">
        <div className="jr-studio-book">
          {trip
            ? <Storybook trip={trip} events={events} planning={busy === 'the plan'} onFly={onFly} onHome={onHome}
                onClose={() => setStep('places')} />
            : <div className="jr-desk orion-waiting">
                <p className="jr-kicker">Orion · three</p>
                <h1 className="jr-cover-title" style={{ fontSize: 30, margin: '4px 0 10px' }}>Building the plan</h1>
                <Thread crew={crew.slice(-6)} />
                {error && <p className="jr-error">{error}</p>}
              </div>}
        </div>
        <aside className="jr-editor">
          <header>
            <p className="jr-kicker">The editor</p>
            <p className="jr-caption">Say what is wrong and it becomes an edit: drop a place, move it to another day, stay longer, add somewhere, change the hours or the bed. Only the days touched are redone.</p>
          </header>
          <ol className="jr-editor-log">
            {chat.map((l, i) => <li key={i} className={`is-${l.who}`}><span>{l.text}</span></li>)}
            {busy === 'the editor' && <li className="is-editor is-busy"><span>Reading the plan…</span></li>}
            {busy && busy !== 'the editor' && crew.at(-1) && <li className="is-crew"><span>{crew.at(-1)!.agent}: {crew.at(-1)!.detail}</span></li>}
          </ol>
          <form className="jr-editor-ask" onSubmit={e => { e.preventDefault(); void send() }}>
            <input value={draftMsg} onChange={e => setDraftMsg(e.target.value)} disabled={!trip || !!busy}
              placeholder={trip ? 'Swap day 2 for something quieter, and skip the museum' : 'The plan is still being built'} />
            <button type="submit" className="jr-btn primary" disabled={!trip || !!busy || !draftMsg.trim()}>Send</button>
          </form>
        </aside>
      </div>
    )
  }

  /* ------------------------------------------------------------ the desk */

  return (
    <div className="jr-planner">
      <aside className="jr-planner-side">
        <header className="jr-planner-head">
          <button type="button" className="jr-kicker jr-home-link" onClick={onHome}>← Orion</button>
          <h1>{origin.name}, {wish.days} day{wish.days === 1 ? '' : 's'}</h1>
        </header>

        <ol className="jr-steps" aria-label="Steps">
          {STEPS.map((x, i) => (
            <li key={x.key} className={i === stepIndex ? 'is-on' : i < stepIndex ? 'is-done' : ''}><b>{i + 1}</b><span>{x.title}</span></li>
          ))}
        </ol>
        <p className="jr-step-hint">{STEPS[stepIndex].hint}</p>

        {step === 'beds' && (
          <section className="jr-step">
            <ol className="jr-beds">
              {beds.map((b, i) => (
                <li key={b.id} className={bed?.id === b.id ? 'is-on' : ''}>
                  <button type="button" onClick={() => setBed(b)}>
                    <span className="jr-disc">{i + 1}</span>
                    <span className="jr-bed-body">
                      <b>{b.name}</b>
                      <em>{b.kind.replace('_', ' ')}{b.stars != null ? ` · ${b.stars} stars, self-declared` : ''}{b.address ? ` · ${b.address}` : ''}</em>
                      <span>{b.why}</span>
                    </span>
                  </button>
                </li>
              ))}
              {bedsBusy && <li className="jr-empty is-busy">Asking OpenStreetMap for somewhere to sleep… you do not have to wait for it.</li>}
              {!beds.length && !bedsBusy && <li className="jr-empty">Couldn't get a list of places to sleep just now. You can carry on without a bed; the days will start from the city centre.</li>}
            </ol>
            <p className="jr-caption">Ranked on distance from where the days will be, the sort of bed you asked for, and the tags OpenStreetMap has. Nothing here knows prices or availability.</p>
            <div className="jr-order-moves">
              <button type="button" className="jr-btn tiny ghost" disabled={!!busy || bedsBusy} onClick={() => void runBeds()}>Three different ones</button>
            </div>
          </section>
        )}

        {step === 'places' && (
          <section className="jr-step">
            {drafts.map((d, di) => (
              <div key={di} className="jr-draft-day" style={{ '--c': colourAt(di) } as React.CSSProperties}>
                <h3><span className="jr-disc">{di + 1}</span>{d.title}<em>{d.stops.reduce((n, c) => n + c.visitMin, 0)} min of visiting</em></h3>
                <ol className="jr-order">
                  {d.stops.map((c, k) => (
                    <li key={c.id} style={{ '--c': colourAt(di) } as React.CSSProperties}>
                      <Mark name={markFor(c.name, k)} size={15} />
                      <b>{c.name}{c.asked ? '' : ' ·'}</b>
                      <em>{c.visitMin}′</em>
                      <span className="jr-order-moves">
                        <button type="button" className="jr-btn tiny" onClick={() => move(di, k, -1)} disabled={di === 0 && k === 0} aria-label="Earlier">↑</button>
                        <button type="button" className="jr-btn tiny" onClick={() => move(di, k, 1)} disabled={di === drafts.length - 1 && k === d.stops.length - 1} aria-label="Later">↓</button>
                        <button type="button" className="jr-x" onClick={() => drop(di, k)} aria-label={`Drop ${c.name}`}>×</button>
                      </span>
                    </li>
                  ))}
                  {!d.stops.length && <li className="jr-empty">Empty — this day will be skipped.</li>}
                </ol>
                <button type="button" className="jr-btn tiny ghost" disabled={!!busy} onClick={() => void refill(di)}>Find more for this day</button>
              </div>
            ))}
            <p className="jr-caption">A dot marks the scout's choices; the rest are yours. Moving a place past the end of its day carries it to the next. The router settles the order within each day; this is only which day it belongs to.</p>
          </section>
        )}

        {busy && <Thread crew={crew.slice(-4)} />}
        {error && <p className="jr-error">{error}</p>}

        <footer className="jr-planner-foot">
          <button type="button" className="jr-btn ghost" disabled={!!busy} onClick={() => { if (step === 'beds') return onBack(); step_.current = 'beds'; setStep('beds') }}>Back</button>
          <span style={{ flex: 1 }} />
          {step === 'beds' && <button type="button" className="jr-btn primary" disabled={!!busy || !session.current} onClick={() => void runPlaces()}>{busy === 'the places' ? 'The scout is choosing…' : bed ? `Sleep at ${short(bed.name)} →` : bedsBusy ? 'Skip the bed for now →' : 'Carry on without a bed →'}</button>}
          {step === 'places' && <button type="button" className="jr-btn primary big" disabled={!!busy || !drafts.some(d => d.stops.length)} onClick={() => void runPlan()}><Mark name="key" size={16} /> Build the plan</button>}
        </footer>
      </aside>

      <div className="jr-planner-map has-city">
        <MapSheet centre={bed ?? origin} pins={pins} legs={legs} busy={busy} />
      </div>
    </div>
  )
}

const short = (s: string) => s.length > 22 ? `${s.slice(0, 21)}…` : s

/** The crew, as a thread: who said what, most recent last. */
function Thread({ crew }: { crew: Extract<CrewEvent, { type: 'crew' }>[] }) {
  return (
    <ol className="jr-thread" aria-live="polite">
      {crew.map((c, i) => (
        <li key={i} className={`is-${c.state}`}><b>{c.agent}</b><span>{c.detail}</span></li>
      ))}
    </ol>
  )
}
