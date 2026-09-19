import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mark } from './Marks'
import { markFor } from './decor'
import MapSheet, { type MapLeg, type MapPin } from './MapSheet'
import { locate, reverseGeocode, suggest, type Place } from '../geocode'
import { catalogueFor, findStops, matchWant, roomFor, type Candidate, type Skeleton } from '../crew'
import { bestOrder, legsFor } from '../router'
import { schedule, windowOf } from '../timekeeper'
import type { CrewEvent } from '../events'
import {
  BUDGET_LABEL, MINS, PARTY_LABEL, TRANSPORT_LABEL,
  type Budget, type Leg, type Meal, type Pace, type Party, type Transport, type Wish,
} from '../../types'

/* The desk, as a table with a map on it.
 *
 * Four moves, each one visible on the map as it happens:
 *
 *   1. Places   — name them, or put a pin down on the ground. Each one is
 *                 resolved the moment it is typed and drops in where the
 *                 geocoder put it. If the day has room left, the scout fills
 *                 it and its choices land as pins beside yours.
 *   2. Order    — the router prices every pair and settles an order; a faint
 *                 dashed line joins the pins so you can see it. Move any stop
 *                 and the line redraws. The router's order is the default, not
 *                 the law, and the page says which one you are looking at.
 *   3. Stays    — how long at each. The clock walks forward as you drag, and
 *                 it says so when the day runs past the hour you gave.
 *   4. Connect  — the road itself, leg by leg, inked onto the map as each
 *                 polyline comes back from the router, in the colour of the
 *                 stop it arrives at.
 *
 * Everything that moves here moves because something happened: a pin drops
 * because a place resolved, a line draws because a polyline arrived. There is
 * no progress bar and nothing waits on a timer.
 */

export const STOP_COLOURS = ['#3f7fd6', '#8e5fc9', '#3f9d63', '#e37d2d', '#d94a5e', '#2d9cb3']
const colourAt = (i: number) => STOP_COLOURS[i % STOP_COLOURS.length]

const INTERESTS = ['Art and museums', 'History', 'Food and markets', 'Parks and green space', 'Views', 'Music and theatre', 'Architecture']
const TRANSPORTS: Transport[] = ['walk', 'cycle', 'transit', 'drive']
const PACES: Pace[] = ['gentle', 'steady', 'full']
const PARTIES: Party[] = ['solo', 'couple', 'family', 'easy']
const BUDGETS: Budget[] = ['free', 'modest', 'any']
const MEALS: Meal[] = ['lunch', 'dinner']

type Step = 'places' | 'order' | 'stays' | 'connect'
const STEPS: { key: Step; title: string; hint: string }[] = [
  { key: 'places', title: 'Places', hint: 'Name them, or put a pin on the map' },
  { key: 'order', title: 'Order', hint: 'The router’s, unless you move one' },
  { key: 'stays', title: 'Stays', hint: 'How long at each' },
  { key: 'connect', title: 'Connect', hint: 'The road between them' },
]

export default function Desk({ seedCity, onCity, onUnfold, error }: {
  seedCity?: string
  onCity?: (place: Place | null) => void
  onUnfold: (skeleton: Skeleton) => void
  error?: string
}) {
  const [step, setStep] = useState<Step>('places')
  const [cityText, setCityText] = useState(seedCity ?? '')
  const [city, setCity] = useState<Place | null>(null)
  const [cityBusy, setCityBusy] = useState(false)
  const [pins, setPins] = useState<Place[]>([])
  const [placeText, setPlaceText] = useState('')
  const [hints, setHints] = useState<Place[]>([])
  const [fromText, setFromText] = useState('')
  const [from, setFrom] = useState<Place | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [mode, setMode] = useState<'full' | 'short'>('full')
  const [fresh, setFresh] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ at: Place; serial: number } | null>(null)
  const serial = useRef(0)

  const [wish, setWish] = useState<Omit<Wish, 'city' | 'wants' | 'from'>>({
    startAt: '09:30', endAt: '18:00', interests: ['History'], pace: 'steady',
    transport: 'walk', party: 'solo', budget: 'modest', meals: ['lunch'],
  })

  // Settled by the order step and edited by hand afterwards.
  const [cands, setCands] = useState<Candidate[]>([])
  const [seq, setSeq] = useState<number[]>([])
  const [routed, setRouted] = useState<{ minutes: number[][]; estimated: boolean; byRouter: number[] } | null>(null)
  const [legs, setLegs] = useState<Map<number, Leg>>(new Map())
  const [reveal, setReveal] = useState<Map<number, number>>(new Map())
  const [events, setEvents] = useState<CrewEvent[]>([])
  const abort = useRef<AbortController | null>(null)
  const said = useRef<Place | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  /* ---------------------------------------------------------------- city -- */

  const resolveCity = useCallback(async (text: string) => {
    if (!text.trim()) return
    setCityBusy(true); setNote('')
    const c = await locate(text.trim())
    setCityBusy(false)
    if (!c) { setNote(`No such place as “${text}”.`); return }
    setCity(c); setCityText(c.name); setPins([]); setFrom(null); setCands([]); setSeq([])
    if (c.alternatives?.length) setNote(`Taking ${c.name}. Also: ${c.alternatives.map(a => a.name).join('; ')}.`)
  }, [])

  useEffect(() => { if (seedCity) void resolveCity(seedCity) }, [seedCity, resolveCity])
  useEffect(() => {
    if (!cityText.trim() || (city && city.name === cityText)) return
    const t = setTimeout(() => void resolveCity(cityText), 800)
    return () => clearTimeout(t)
  }, [cityText, city, resolveCity])

  // The shell hears about the city once, as soon as it is known: the 3D tiles
  // of the real place start loading behind this page while the day is planned.
  useEffect(() => {
    if (city && said.current !== city) { said.current = city; onCity?.(city) }
  }, [city, onCity])

  /* -------------------------------------------------------------- places -- */

  useEffect(() => {
    if (!city || placeText.trim().length < 3) { setHints([]); return }
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      const list = await suggest(placeText, city, ctl.signal)
      if (!ctl.signal.aborted) setHints(list)
    }, 420)
    return () => { clearTimeout(t); ctl.abort() }
  }, [placeText, city])

  const pin = useCallback((hit: Place) => {
    setPins(ps => {
      if (ps.some(p => Math.hypot(p.lat - hit.lat, p.lon - hit.lon) < 0.0002)) { setNote(`${hit.name} is already down.`); return ps }
      return [...ps, hit]
    })
    setFocus({ at: hit, serial: ++serial.current })
    setFresh(hit.name)
    setTimeout(() => setFresh(f => f === hit.name ? null : f), 900)
    setPlaceText(''); setHints([])
  }, [])

  const addPlace = useCallback(async (text: string) => {
    if (!city || !text.trim()) return
    // The first suggestion, if there is one, is what Enter means: it is already
    // resolved, so nothing waits.
    if (hints[0]) { pin(hints[0]); return }
    setBusy(text); setNote('')
    const hit = await locate(text.trim(), city)
    setBusy(null)
    if (!hit) { setNote(`Could not find “${text}” near ${city.name}.`); return }
    pin(hit)
    if (hit.alternatives?.length) setNote(`Pinned ${hit.name} — it was ambiguous; also ${hit.alternatives[0].name}.`)
  }, [city, hints, pin])

  /* A pin on bare ground is named by what is there, not by its coordinates:
     a click beside the square comes back as the square. */
  const dropPin = useCallback(async (at: { lat: number; lon: number }) => {
    if (!city) return
    setBusy('the pin'); setNote('')
    const hit = await reverseGeocode(at)
    setBusy(null)
    pin(hit ?? { asked: 'a pin', name: `Pin ${pins.length + 1}`, region: '', lat: at.lat, lon: at.lon })
  }, [city, pins.length, pin])

  const resolveFrom = useCallback(async () => {
    if (!city || !fromText.trim()) { setFrom(null); return }
    const hit = await locate(fromText.trim(), city)
    setFrom(hit)
    if (hit) setFromText(hit.name); else setNote(`Could not find “${fromText}”.`)
  }, [city, fromText])

  /* --------------------------------------------------------------- order -- */

  const fullWish = useCallback((): Wish => ({
    city: city?.name ?? '', wants: pins.map(p => p.name), from: from?.name ?? '', ...wish,
  }), [city, pins, from, wish])

  /** Leaving Places is where the crew first does anything: the pinned places
      are matched to what Wikipedia knows, the scout fills whatever room is
      left, and the router prices every pair. */
  const runOrder = useCallback(async () => {
    if (!city) return
    abort.current?.abort()
    const ctl = new AbortController(); abort.current = ctl
    setBusy('the day'); setEvents([]); setRouted(null); setLegs(new Map()); setReveal(new Map())
    const w = fullWish()
    try {
      const catalogue = await catalogueFor(city)
      if (ctl.signal.aborted) return
      const taken = new Set<number>()
      const fixed: Candidate[] = []
      for (const p of pins) fixed.push(await matchWant(p, catalogue, taken, w))

      const room = roomFor(mode, fixed.length)
      const extra = room
        ? await findStops({
            catalogue, wish: w, mode, fixed, count: room,
            onEvent: e => !ctl.signal.aborted && setEvents(list => [...list, e]),
            legSecs: async all => (await legsFor(all.map(c => ({ id: c.id, lat: c.lat, lon: c.lon })), w.transport)).map(l => l.durationSec),
          })
        : []
      if (ctl.signal.aborted) return

      const all = [...fixed, ...extra]
      if (all.length < 2) { setNote('A day needs at least two places.'); setBusy(null); return }

      const points = [...(from ? [from] : []), ...all]
      const r = await bestOrder(points, w.transport, !!from)
      if (ctl.signal.aborted) return
      const visit = r.order.filter(i => !(from && i === 0)).map(i => from ? i - 1 : i)
      setCands(all); setSeq(visit)
      setRouted({ minutes: r.minutes, estimated: r.estimated, byRouter: visit })
      setStep('order')
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      if (!ctl.signal.aborted) setBusy(null)
    }
  }, [city, pins, from, mode, fullWish])

  const move = (pos: number, d: number) => setSeq(s => {
    const j = pos + d
    if (j < 0 || j >= s.length) return s
    const next = [...s]; [next[pos], next[j]] = [next[j], next[pos]]
    return next
  })

  /** Minutes between consecutive stops in the current order, from the matrix —
      the number the stays step walks the clock with before the road is drawn. */
  const hop = useCallback((k: number) => {
    if (!routed) return 0
    const off = from ? 1 : 0
    const a = k === 0 ? (from ? 0 : -1) : seq[k - 1] + off
    const b = seq[k] + off
    return a < 0 ? 0 : routed.minutes[a]?.[b] ?? 0
  }, [routed, seq, from])

  /* ------------------------------------------------------------- connect -- */

  const runConnect = useCallback(async () => {
    abort.current?.abort()
    const ctl = new AbortController(); abort.current = ctl
    setLegs(new Map()); setReveal(new Map()); setBusy('the road')
    const chain = [
      ...(from ? [{ id: 'from', lat: from.lat, lon: from.lon }] : []),
      ...seq.map(i => ({ id: cands[i].id, lat: cands[i].lat, lon: cands[i].lon })),
    ]
    for (let i = 0; i < chain.length - 1; i++) {
      const [leg] = await legsFor([chain[i], chain[i + 1]], wish.transport)
      if (ctl.signal.aborted) return
      setLegs(m => new Map(m).set(i, leg))
      // Ink it on over a moment, so you can watch the line find its way.
      const t0 = performance.now(), dur = 850
      await new Promise<void>(res => {
        const tick = () => {
          const f = Math.min(1, (performance.now() - t0) / dur)
          setReveal(m => new Map(m).set(i, f))
          if (f < 1 && !ctl.signal.aborted) requestAnimationFrame(tick); else res()
        }
        requestAnimationFrame(tick)
      })
    }
    if (!ctl.signal.aborted) setBusy(null)
  }, [cands, seq, from, wish.transport])

  const go = (next: Step) => {
    if (next === 'order') { void runOrder(); return }
    setStep(next)
    if (next === 'connect') void runConnect()
  }

  /* ----------------------------------------------------- what the map shows */

  const mapPins = useMemo<MapPin[]>(() => {
    if (step === 'places') {
      return [
        ...(from ? [{ id: 'from', lat: from.lat, lon: from.lon, label: '·', name: from.name, colour: '#6d5a3c', start: true }] : []),
        ...pins.map((p, i) => ({
          id: `${p.name}${p.lat}`, lat: p.lat, lon: p.lon, label: String(i + 1),
          name: p.name, colour: colourAt(i), fresh: fresh === p.name,
        })),
      ]
    }
    return [
      ...(from ? [{ id: 'from', lat: from.lat, lon: from.lon, label: '·', name: from.name, colour: '#6d5a3c', start: true }] : []),
      ...seq.map((ci, k) => ({
        id: cands[ci].id, lat: cands[ci].lat, lon: cands[ci].lon, label: String(k + 1),
        name: cands[ci].name, colour: colourAt(k),
      })),
    ]
  }, [step, pins, seq, cands, from, fresh])

  const mapLegs = useMemo<MapLeg[]>(() => {
    if (step === 'places') return []
    const chain = [...(from ? [from] : []), ...seq.map(i => cands[i])]
    return chain.slice(1).map((b, k) => {
      const a = chain[k]
      const real = legs.get(k)
      const colour = colourAt(from ? k : k + 1)
      if (real && real.polyline.length >= 2 && !real.estimated) {
        return { points: real.polyline, colour, reveal: step === 'connect' ? reveal.get(k) ?? 0 : 1, minutes: real.durationSec / 60 }
      }
      if (real) {
        return { points: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }], colour, estimated: true, minutes: real.durationSec / 60 }
      }
      return { points: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }], colour, draft: true }
    })
  }, [step, seq, cands, from, legs, reveal])

  /* --------------------------------------------------------------- clock -- */

  const window_ = windowOf(wish)
  const clock = useMemo(() => schedule(
    seq.map(i => cands[i]?.visitMin ?? 20),
    seq.map((_, k) => hop(k + 1) * 60),
    window_, from ? hop(0) * 60 : 0, wish.meals,
  ), [seq, cands, hop, from, wish.meals, window_.startMin, window_.endMin])   // eslint-disable-line react-hooks/exhaustive-deps

  const late = MINS(clock.endsAt) > MINS(wish.endAt)

  /* -------------------------------------------------------------- unfold -- */

  const unfold = () => {
    if (!city) return
    const stops = seq.map(i => cands[i])
    const off = from ? 1 : 0
    onUnfold({
      wish: fullWish(), mode, origin: city, from,
      stops,
      approach: from ? legs.get(0) ?? null : null,
      legs: stops.slice(1).map((_, k) => legs.get(k + off)).filter(Boolean) as Leg[],
    })
  }

  const toggle = <T,>(list: T[], x: T) => list.includes(x) ? list.filter(i => i !== x) : [...list, x]
  const stepIndex = STEPS.findIndex(s => s.key === step)
  const newest = [...events].reverse().find(e => e.type === 'crew') as Extract<CrewEvent, { type: 'crew' }> | undefined
  const anyLegs = legs.size > 0
  const enough = seq.length >= 2

  return (
    <div className="jr-planner">
      <aside className="jr-planner-side">
        <header className="jr-planner-head">
          <p className="jr-kicker">Orion · one</p>
          <h1>Plan a day, then fly it</h1>
        </header>

        <ol className="jr-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.key} className={i === stepIndex ? 'is-on' : i < stepIndex ? 'is-done' : ''}>
              <b>{i + 1}</b><span>{s.title}</span>
            </li>
          ))}
        </ol>
        <p className="jr-step-hint">{STEPS[stepIndex].hint}</p>

        {step === 'places' && (
          <section className="jr-step jr-step-places">
            <label className="jr-field">
              <span>City</span>
              <div className="jr-inline">
                <input value={cityText} onChange={e => setCityText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void resolveCity(cityText) } }}
                  placeholder="Kyoto" autoComplete="off" autoFocus />
                {cityBusy && <span className="jr-busy" aria-hidden />}
                {city && !cityBusy && <Mark name="compass" size={16} className="fade" />}
              </div>
            </label>

            <label className="jr-field">
              <span>A place you want to see <em>Enter to pin it</em></span>
              <div className="jr-inline">
                <input value={placeText} onChange={e => setPlaceText(e.target.value)} disabled={!city}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addPlace(placeText) } }}
                  placeholder={city ? 'Type a place, press Enter' : 'Name the city first'} autoComplete="off" />
                <button type="button" className="jr-btn tiny" disabled={!city || !placeText.trim() || !!busy}
                  onClick={() => void addPlace(placeText)}>Pin</button>
              </div>
              {hints.length > 0 && (
                <ul className="jr-hints">
                  {hints.map((h, i) => (
                    <li key={`${h.name}${h.lat}`}>
                      <button type="button" onClick={() => pin(h)} className={i === 0 ? 'is-first' : ''}>
                        <Mark name={markFor(h.name, i)} size={14} /><b>{h.name}</b><span>{h.region}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </label>
            <p className="jr-caption">…or click anywhere on the map and a pin goes down there, named by what is at that spot.</p>

            <ul className="jr-cands">
              {pins.map((p, i) => (
                <li key={`${p.name}${p.lat}`} style={{ '--c': colourAt(i) } as React.CSSProperties}
                  className={fresh === p.name ? 'is-fresh' : ''}>
                  <span className="jr-disc">{i + 1}</span>
                  <Mark name={markFor(p.name, i)} size={16} />
                  <b>{p.name}</b>
                  <button type="button" className="jr-x" aria-label={`Remove ${p.name}`}
                    onClick={() => setPins(ps => ps.filter(x => x !== p))}>×</button>
                </li>
              ))}
              {!pins.length && <li className="jr-empty">Nothing pinned — the scout will choose the whole day.</li>}
            </ul>
            {pins.length < (mode === 'short' ? 3 : 5) && (
              <p className="jr-caption">
                The scout will add {roomFor(mode, pins.length)} more to fill the day, chosen for what you say below.
              </p>
            )}

            <details className="jr-more">
              <summary>Start, hours, who, interests, pace, transport, budget</summary>

              <label className="jr-field">
                <span>Starting from <em>optional — a hotel, a station</em></span>
                <input value={fromText} onChange={e => setFromText(e.target.value)} onBlur={() => void resolveFrom()}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void resolveFrom() } }}
                  placeholder="Kyoto Station" disabled={!city} autoComplete="off" />
              </label>

              <div className="jr-row">
                <label className="jr-field"><span>From</span>
                  <input type="time" value={wish.startAt} onChange={e => setWish({ ...wish, startAt: e.target.value })} /></label>
                <label className="jr-field"><span>Until</span>
                  <input type="time" value={wish.endAt} onChange={e => setWish({ ...wish, endAt: e.target.value })} /></label>
              </div>

              <fieldset className="jr-chips"><legend>Who is going <em>it changes the choices and the pace</em></legend>
                {PARTIES.map(p => (
                  <button key={p} type="button" aria-pressed={wish.party === p}
                    onClick={() => setWish({ ...wish, party: p })}>{PARTY_LABEL[p]}</button>
                ))}
              </fieldset>

              <fieldset className="jr-chips"><legend>Interests <em>they steer the scout</em></legend>
                {INTERESTS.map(i => (
                  <button key={i} type="button" aria-pressed={wish.interests.includes(i)}
                    onClick={() => setWish({ ...wish, interests: toggle(wish.interests, i) })}>{i}</button>
                ))}
              </fieldset>

              <fieldset className="jr-chips"><legend>Budget</legend>
                {BUDGETS.map(b => (
                  <button key={b} type="button" aria-pressed={wish.budget === b}
                    onClick={() => setWish({ ...wish, budget: b })}>{BUDGET_LABEL[b]}</button>
                ))}
              </fieldset>

              <fieldset className="jr-chips"><legend>Keep time clear for <em>the clock leaves the gap</em></legend>
                {MEALS.map(m => (
                  <button key={m} type="button" aria-pressed={wish.meals.includes(m)}
                    onClick={() => setWish({ ...wish, meals: toggle(wish.meals, m) })}>{m}</button>
                ))}
              </fieldset>

              <fieldset className="jr-chips"><legend>Pace</legend>
                {PACES.map(p => (
                  <button key={p} type="button" aria-pressed={wish.pace === p}
                    onClick={() => setWish({ ...wish, pace: p })}>{p}</button>
                ))}
              </fieldset>

              <fieldset className="jr-chips"><legend>Getting about</legend>
                {TRANSPORTS.map(t => (
                  <button key={t} type="button" aria-pressed={wish.transport === t}
                    onClick={() => setWish({ ...wish, transport: t })}>{TRANSPORT_LABEL[t]}</button>
                ))}
              </fieldset>

              <fieldset className="jr-chips"><legend>Length <em>{mode === 'short' ? 'three stops, briefly told' : 'five stops, told properly'}</em></legend>
                <button type="button" aria-pressed={mode === 'full'} onClick={() => setMode('full')}>The full day</button>
                <button type="button" aria-pressed={mode === 'short'} onClick={() => setMode('short')}>A short pass</button>
              </fieldset>
            </details>
          </section>
        )}

        {step === 'order' && (
          <section className="jr-step">
            <ol className="jr-order">
              {seq.map((ci, k) => (
                <li key={cands[ci].id} style={{ '--c': colourAt(k) } as React.CSSProperties}>
                  <span className="jr-disc">{k + 1}</span>
                  <b>{cands[ci].name}{cands[ci].asked ? '' : ' ·'}</b>
                  {k > 0 && <em>{Math.round(hop(k))}′ {TRANSPORT_LABEL[wish.transport].toLowerCase()}</em>}
                  <span className="jr-order-moves">
                    <button type="button" className="jr-btn tiny" disabled={k === 0} onClick={() => move(k, -1)} aria-label="Earlier">↑</button>
                    <button type="button" className="jr-btn tiny" disabled={k === seq.length - 1} onClick={() => move(k, 1)} aria-label="Later">↓</button>
                  </span>
                </li>
              ))}
            </ol>
            <p className="jr-caption">
              {!routed ? ''
                : routed.byRouter.join() === seq.join()
                  ? `The router’s order${routed.estimated ? ', from straight-line estimates — it could not be reached' : ', from real travel times'}.`
                  : 'Your order. The router’s was different; the times are still real.'}
              {routed && routed.byRouter.join() !== seq.join() && (
                <> <button type="button" className="jr-btn tiny ghost" onClick={() => setSeq(routed.byRouter)}>Put it back</button></>
              )}
            </p>
            <p className="jr-caption">A dot marks the ones the scout chose; the rest are yours.</p>
          </section>
        )}

        {step === 'stays' && (
          <section className="jr-step">
            <ol className="jr-stays">
              {seq.map((ci, k) => (
                <li key={cands[ci].id} style={{ '--c': colourAt(k) } as React.CSSProperties}>
                  <span className="jr-disc">{k + 1}</span>
                  <div className="jr-stay-body">
                    <div className="jr-stay-head"><em>{clock.arrivals[k]}</em><b>{cands[ci].name}</b></div>
                    <label>
                      <input type="range" min={10} max={180} step={5} value={cands[ci].visitMin}
                        onChange={e => setCands(cs => cs.map((c, i) => i === ci ? { ...c, visitMin: Number(e.target.value) } : c))} />
                      <span>{cands[ci].visitMin} min</span>
                    </label>
                    {clock.breaks.some(b => b.after === k) && (
                      <p className="jr-caption" style={{ margin: '2px 0 0' }}>
                        then {clock.breaks.find(b => b.after === k)!.minutes} minutes kept clear for {clock.breaks.find(b => b.after === k)!.label}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <p className={late ? 'jr-warn' : 'jr-caption'}>
              The day ends about <b>{clock.endsAt}</b>
              {late ? ` — later than the ${wish.endAt} you gave. Shorten a stay, or drop a stop.` : '.'}
            </p>
            <p className="jr-caption">
              Lengths came from what each place is, at a {wish.pace} pace, for {PARTY_LABEL[wish.party].toLowerCase()}.
            </p>
          </section>
        )}

        {step === 'connect' && (
          <section className="jr-step">
            <ol className="jr-legs">
              {mapLegs.map((l, k) => {
                const a = k === 0 && from ? from.name : cands[seq[from ? k - 1 : k]]?.name ?? ''
                const b = cands[seq[from ? k : k + 1]]?.name ?? ''
                return (
                  <li key={k} style={{ '--c': l.colour } as React.CSSProperties} className={l.draft ? 'is-waiting' : 'is-drawn'}>
                    <i aria-hidden />
                    <span>{a} → {b}</span>
                    <em>{l.draft ? '…' : `${Math.round(l.minutes ?? 0)}′${l.estimated ? ' est.' : ''}`}</em>
                  </li>
                )
              })}
            </ol>
            <p className="jr-caption">
              {busy === 'the road'
                ? 'Asking the router for each leg, and inking it as it comes back.'
                : anyLegs ? 'Every leg is drawn. The road on the map is the router’s own geometry.' : ''}
            </p>
          </section>
        )}

        {note && <p className="jr-note-line">{note}</p>}
        {error && <p className="jr-error">{error}</p>}
        {busy === 'the day' && newest && <p className="jr-crew-line">{newest.agent}: {newest.detail}</p>}

        <footer className="jr-planner-foot">
          {stepIndex > 0 && <button type="button" className="jr-btn ghost" disabled={!!busy}
            onClick={() => setStep(STEPS[stepIndex - 1].key)}>Back</button>}
          <span style={{ flex: 1 }} />
          {step === 'places' && (
            <button type="button" className="jr-btn primary" disabled={!city || !!busy} onClick={() => go('order')}>
              {busy === 'the day' ? 'The crew is choosing…' : 'Put them in order →'}
            </button>
          )}
          {step === 'order' && <button type="button" className="jr-btn primary" disabled={!enough} onClick={() => setStep('stays')}>How long at each →</button>}
          {step === 'stays' && <button type="button" className="jr-btn primary" onClick={() => go('connect')}>Connect them →</button>}
          {step === 'connect' && (
            <button type="button" className="jr-btn primary big" disabled={!!busy || !anyLegs} onClick={unfold}>
              <Mark name="key" size={16} /> Unfold the trip
            </button>
          )}
        </footer>
      </aside>

      <div className={`jr-planner-map ${city ? 'has-city' : ''}`}>
        {city
          ? <MapSheet centre={city} pins={mapPins} legs={mapLegs} busy={busy}
              focus={focus ? { at: focus.at, serial: focus.serial } : null}
              onPick={step === 'places' ? dropPin : undefined}
              onRemove={step === 'places' ? id => setPins(ps => ps.filter(p => `${p.name}${p.lat}` !== id)) : undefined} />
          : <div className="jr-planner-blank"><Mark name="compass" size={44} className="fade" /><p>Name a city and the ground appears here.</p></div>}
      </div>
    </div>
  )
}
