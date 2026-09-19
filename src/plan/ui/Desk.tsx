import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mark } from './Marks'
import { markFor } from './decor'
import MapSheet, { type MapPin } from './MapSheet'
import { locate, reverseGeocode, suggest, type Place } from '../geocode'
import {
  BUDGET_LABEL, LODGING_LABEL, PARTY_LABEL, TRANSPORT_LABEL,
  type Budget, type Lodging, type Meal, type Pace, type Party, type Transport, type Wish,
} from '../../types'

/* The desk.
 *
 * The crew plans the trip; this is where they are told what sort of trip it
 * should be. One sheet of preferences and a map, and everything on both
 * changes something real: the days decide how far afield the scout may look
 * and how the places are split up, the hours are the window each day has to
 * fit inside, the pace and the party multiply how long you linger, the
 * transport is what the router prices, the budget and the diet are what the
 * concierge and the table-setter are allowed to weigh.
 *
 * Pinning is optional and always was the point of the map: a place you already
 * know you want is never dropped, never overruled, and if you pin a street
 * corner the crew finds the nearest thing worth flying to and says how far it
 * moved. Pin nothing and the whole trip is theirs to invent.
 */

export const STOP_COLOURS = ['#3f7fd6', '#8e5fc9', '#3f9d63', '#e37d2d', '#d94a5e', '#2d9cb3']
const colourAt = (i: number) => STOP_COLOURS[i % STOP_COLOURS.length]

const INTERESTS = ['Art and museums', 'History', 'Food and markets', 'Parks and green space', 'Views', 'Music and theatre', 'Architecture', 'Nightlife']
const TRANSPORTS: Transport[] = ['walk', 'cycle', 'transit', 'drive']
const PACES: Pace[] = ['gentle', 'steady', 'full']
const PARTIES: Party[] = ['solo', 'couple', 'family', 'easy']
const BUDGETS: Budget[] = ['free', 'modest', 'any']
const LODGINGS: Lodging[] = ['hotel', 'hostel', 'guesthouse', 'apartment', 'any']
const MEALS: Meal[] = ['lunch', 'dinner']
const DAYS = [1, 2, 3, 4, 5, 6, 7]

export type DeskResult = { wish: Wish; mode: 'full' | 'short'; origin: Place }

export default function Desk({ seedCity, onCity, onPlan, onHome, error }: {
  seedCity?: string
  onCity?: (place: Place | null) => void
  onPlan: (r: DeskResult) => void
  onHome?: () => void
  error?: string
}) {
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
  const said = useRef<Place | null>(null)

  const [wish, setWish] = useState<Omit<Wish, 'city' | 'wants' | 'from'>>({
    startAt: '09:30', endAt: '18:00', interests: ['History'], pace: 'steady',
    transport: 'walk', party: 'solo', budget: 'modest', meals: ['lunch', 'dinner'],
    days: 3, lodging: 'any', diet: '',
  })

  /* ---------------------------------------------------------------- city -- */

  const resolveCity = useCallback(async (text: string) => {
    if (!text.trim()) return
    setCityBusy(true); setNote('')
    const c = await locate(text.trim())
    setCityBusy(false)
    if (!c) { setNote(`No such place as “${text}”.`); return }
    setCity(c); setCityText(c.name); setPins([]); setFrom(null)
    if (c.alternatives?.length) setNote(`Taking ${c.name}. Also: ${c.alternatives.map(a => a.name).join('; ')}.`)
  }, [])

  useEffect(() => { if (seedCity) void resolveCity(seedCity) }, [seedCity, resolveCity])
  useEffect(() => {
    if (!cityText.trim() || (city && city.name === cityText)) return
    const t = setTimeout(() => void resolveCity(cityText), 800)
    return () => clearTimeout(t)
  }, [cityText, city, resolveCity])

  // The shell hears about the city once, as soon as it is known: the 3D tiles
  // of the real place start loading behind this page while the trip is set up.
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
    if (hints[0]) { pin(hints[0]); return }
    setBusy(text); setNote('')
    const hit = await locate(text.trim(), city)
    setBusy(null)
    if (!hit) { setNote(`Could not find “${text}” near ${city.name}.`); return }
    pin(hit)
    if (hit.alternatives?.length) setNote(`Pinned ${hit.name} — it was ambiguous; also ${hit.alternatives[0].name}.`)
  }, [city, hints, pin])

  /* A pin on bare ground is named by what is there, not by its coordinates. */
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

  const mapPins = useMemo<MapPin[]>(() => [
    ...(from ? [{ id: 'from', lat: from.lat, lon: from.lon, label: '·', name: from.name, colour: '#6d5a3c', start: true }] : []),
    ...pins.map((p, i) => ({
      id: `${p.name}${p.lat}`, lat: p.lat, lon: p.lon, label: String(i + 1),
      name: p.name, colour: colourAt(i), fresh: fresh === p.name,
    })),
  ], [pins, from, fresh])

  const toggle = <T,>(list: T[], x: T) => list.includes(x) ? list.filter(i => i !== x) : [...list, x]

  const plan = () => {
    if (!city) return
    onPlan({
      wish: { city: city.name, wants: pins.map(p => p.name), from: from?.name ?? '', ...wish },
      mode, origin: city,
    })
  }

  const perDay = mode === 'short' ? 3 : 4

  return (
    <div className="jr-planner">
      <aside className="jr-planner-side">
        <header className="jr-planner-head">
          {onHome
            ? <button type="button" className="jr-kicker jr-home-link" onClick={onHome}>← Orion</button>
            : <p className="jr-kicker">Orion · one</p>}
          <h1>Tell the crew about the trip</h1>
        </header>

        <label className="jr-field">
          <span>City</span>
          <div className="jr-inline">
            <input value={cityText} onChange={e => setCityText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void resolveCity(cityText) } }}
              placeholder="Kyoto" autoComplete="off" autoFocus />
            {cityBusy && <span className="jr-busy" aria-hidden />}
            {city && !cityBusy && <Mark name="compass" size={16} className="fade" />}
          </div>
          {city && <p className="jr-caption">{city.region}</p>}
        </label>

        <fieldset className="jr-chips"><legend>How many days <em>{wish.days * perDay} places, split into {wish.days} day{wish.days === 1 ? '' : 's'}</em></legend>
          {DAYS.map(d => (
            <button key={d} type="button" aria-pressed={wish.days === d}
              onClick={() => setWish({ ...wish, days: d })}>{d}</button>
          ))}
        </fieldset>

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

        <div className="jr-row">
          <label className="jr-field"><span>Each day from</span>
            <input type="time" value={wish.startAt} onChange={e => setWish({ ...wish, startAt: e.target.value })} /></label>
          <label className="jr-field"><span>Until</span>
            <input type="time" value={wish.endAt} onChange={e => setWish({ ...wish, endAt: e.target.value })} /></label>
        </div>

        <fieldset className="jr-chips"><legend>Where to sleep <em>chosen from what OpenStreetMap lists nearby</em></legend>
          {LODGINGS.map(l => (
            <button key={l} type="button" aria-pressed={wish.lodging === l}
              onClick={() => setWish({ ...wish, lodging: l })}>{LODGING_LABEL[l]}</button>
          ))}
        </fieldset>

        <fieldset className="jr-chips"><legend>Meals to plan <em>the clock leaves the gap and the crew finds the table</em></legend>
          {MEALS.map(m => (
            <button key={m} type="button" aria-pressed={wish.meals.includes(m)}
              onClick={() => setWish({ ...wish, meals: toggle(wish.meals, m) })}>{m}</button>
          ))}
        </fieldset>

        <label className="jr-field">
          <span>At the table <em>optional — anything the kitchen should know</em></span>
          <input value={wish.diet} onChange={e => setWish({ ...wish, diet: e.target.value })}
            placeholder="vegetarian, no pork, we like noodles" autoComplete="off" />
        </label>

        <details className="jr-more">
          <summary>Pace, transport, budget, starting point, length of the telling</summary>

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

          <fieldset className="jr-chips"><legend>Budget</legend>
            {BUDGETS.map(b => (
              <button key={b} type="button" aria-pressed={wish.budget === b}
                onClick={() => setWish({ ...wish, budget: b })}>{BUDGET_LABEL[b]}</button>
            ))}
          </fieldset>

          <label className="jr-field">
            <span>Arriving at <em>optional — a station, an airport, a hotel you have booked</em></span>
            <input value={fromText} onChange={e => setFromText(e.target.value)} onBlur={() => void resolveFrom()}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void resolveFrom() } }}
              placeholder="Kyoto Station" disabled={!city} autoComplete="off" />
          </label>

          <fieldset className="jr-chips"><legend>Length of the telling <em>{mode === 'short' ? 'three stops a day, briefly told' : 'four a day, told properly'}</em></legend>
            <button type="button" aria-pressed={mode === 'full'} onClick={() => setMode('full')}>Full</button>
            <button type="button" aria-pressed={mode === 'short'} onClick={() => setMode('short')}>Short</button>
          </fieldset>
        </details>

        <hr className="jr-rule" />

        <label className="jr-field">
          <span>Anywhere you already know you want <em>optional · Enter to pin it</em></span>
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
        <p className="jr-caption">
          …or click the map. A pin is never dropped from the trip; if it lands on nothing notable the
          crew finds the nearest thing worth flying to and tells you how far it moved.
        </p>

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
          {!pins.length && <li className="jr-empty">Nothing pinned — the whole trip is theirs to invent.</li>}
        </ul>

        {note && <p className="jr-note-line">{note}</p>}
        {error && <p className="jr-error">{error}</p>}

        <footer className="jr-planner-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="jr-btn primary big" disabled={!city || !!busy} onClick={plan}>
            <Mark name="key" size={16} /> Plan the trip
          </button>
        </footer>
      </aside>

      <div className={`jr-planner-map ${city ? 'has-city' : ''}`}>
        {city
          ? <MapSheet centre={city} pins={mapPins} busy={busy}
              focus={focus ? { at: focus.at, serial: focus.serial } : null}
              onPick={dropPin}
              onRemove={id => setPins(ps => ps.filter(p => `${p.name}${p.lat}` !== id))} />
          : <div className="jr-planner-blank"><Mark name="compass" size={44} className="fade" /><p>Name a city and the ground appears here.</p></div>}
      </div>
    </div>
  )
}
