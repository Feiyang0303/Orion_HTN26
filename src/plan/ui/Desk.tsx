import { useCallback, useEffect, useRef, useState } from 'react'
import { Mark } from './Marks'
import { markFor } from './decor'
import { locate, suggest, type Place } from '../geocode'
import { TRANSPORT_LABEL, type Pace, type Transport, type Wish } from '../../types'

/* The desk.
 *
 * One sheet of paper, and everything on it changes the day: the hours are the
 * window the Timekeeper has to fit inside, the pace multiplies how long you
 * linger, the transport is what the Router prices and draws, the interests
 * steer the Scout, and a place you name yourself is never dropped by anybody.
 * A field that did nothing would be the one dishonest thing on the page, so
 * there isn't one.
 *
 * The city resolves as you type, and the moment it does the coordinate goes up
 * to the shell — which is how the tiles of the real city are already loading
 * behind this paper while you are still deciding where to go.
 */

const INTERESTS = ['Art and museums', 'History', 'Food and markets', 'Parks and green space', 'Views', 'Music and theatre', 'Architecture']
const TRANSPORTS: Transport[] = ['walk', 'cycle', 'transit', 'drive']
const PACES: Pace[] = ['gentle', 'steady', 'full']
const PACE_HINT: Record<Pace, string> = {
  gentle: 'linger — fewer minutes on the move',
  steady: 'the usual',
  full: 'keep moving; see more, stand about less',
}

export type DeskResult = { wish: Wish; mode: 'full' | 'short'; origin: Place }

export default function Desk({ seedCity, onCity, onUnfold, error }: {
  seedCity?: string
  onCity?: (place: Place | null) => void
  onUnfold: (r: DeskResult) => void
  error?: string
}) {
  const [cityText, setCityText] = useState(seedCity ?? '')
  const [city, setCity] = useState<Place | null>(null)
  const [cityBusy, setCityBusy] = useState(false)
  const [wants, setWants] = useState<Place[]>([])
  const [placeText, setPlaceText] = useState('')
  const [hints, setHints] = useState<Place[]>([])
  const [fromText, setFromText] = useState('')
  const [from, setFrom] = useState<Place | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [mode, setMode] = useState<'full' | 'short'>('full')
  const [wish, setWish] = useState<Omit<Wish, 'city' | 'wants' | 'from'>>({
    startAt: '09:30', endAt: '18:00', interests: ['History'], pace: 'steady', transport: 'walk',
  })
  const said = useRef<Place | null>(null)

  /* ---------------------------------------------------------------- city -- */

  const resolveCity = useCallback(async (text: string) => {
    if (!text.trim()) return
    setCityBusy(true); setNote('')
    const c = await locate(text.trim())
    setCityBusy(false)
    if (!c) { setNote(`No such place as “${text}”.`); return }
    setCity(c); setCityText(c.name); setWants([]); setFrom(null)
    if (c.alternatives?.length) setNote(`Taking ${c.name}. Also: ${c.alternatives.map(a => a.name).join('; ')}.`)
  }, [])

  // A name already in the box resolves on its own; a new one resolves a moment
  // after you stop typing.
  useEffect(() => { if (seedCity) void resolveCity(seedCity) }, [seedCity, resolveCity])
  useEffect(() => {
    if (!cityText.trim() || (city && city.name === cityText)) return
    const t = setTimeout(() => void resolveCity(cityText), 800)
    return () => clearTimeout(t)
  }, [cityText, city, resolveCity])

  // The shell hears about the city once, as soon as it is known: the tiles
  // start loading behind the paper while the rest of the desk is filled in.
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
    setWants(ws => ws.some(w => Math.hypot(w.lat - hit.lat, w.lon - hit.lon) < 0.0002) ? ws : [...ws, hit])
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

  const resolveFrom = useCallback(async () => {
    if (!city || !fromText.trim()) { setFrom(null); return }
    const hit = await locate(fromText.trim(), city)
    setFrom(hit)
    if (hit) setFromText(hit.name); else setNote(`Could not find “${fromText}”.`)
  }, [city, fromText])

  const unfold = () => {
    if (!city) return
    onUnfold({
      wish: { city: city.name, wants: wants.map(w => w.name), from: from?.name ?? '', ...wish },
      mode, origin: city,
    })
  }

  const toggle = (list: string[], x: string) => list.includes(x) ? list.filter(i => i !== x) : [...list, x]

  return (
    <div className="jr-desk">
      <header>
        <p className="jr-kicker">Orion · one</p>
        <h1 className="jr-cover-title" style={{ fontSize: 40, margin: '2px 0 6px' }}>Plan the day</h1>
        <p className="jr-caption">
          Name a city. Name the places you already know you want, if you have any — the rest of the
          day is found for you. Then the book is written, and then you fly it.
        </p>
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
        {city && <p className="jr-caption">{city.region || `${city.lat.toFixed(3)}, ${city.lon.toFixed(3)}`} — the ground is already loading behind this page.</p>}
      </label>

      <label className="jr-field">
        <span>A place you want to see <em>optional · Enter to pin it</em></span>
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

      <ul className="jr-cands">
        {wants.map((w, i) => (
          <li key={`${w.name}${w.lat}`}>
            <span className="jr-disc">{i + 1}</span>
            <Mark name={markFor(w.name, i)} size={16} />
            <b>{w.name}</b>
            <button type="button" className="jr-x" aria-label={`Remove ${w.name}`}
              onClick={() => setWants(ws => ws.filter(x => x !== w))}>×</button>
          </li>
        ))}
        {!wants.length && <li className="jr-empty">Nothing named yet — the scout will choose the whole day.</li>}
      </ul>

      <details className="jr-more" open>
        <summary>Start, hours, interests, pace, transport</summary>

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

        <fieldset className="jr-chips"><legend>Interests <em>they steer the scout</em></legend>
          {INTERESTS.map(i => (
            <button key={i} type="button" aria-pressed={wish.interests.includes(i)}
              onClick={() => setWish({ ...wish, interests: toggle(wish.interests, i) })}>{i}</button>
          ))}
        </fieldset>

        <fieldset className="jr-chips"><legend>Pace <em>{PACE_HINT[wish.pace]}</em></legend>
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

      {note && <p className="jr-note-line">{note}</p>}
      {error && <p className="jr-error">{error}</p>}

      <footer className="jr-planner-foot">
        <span style={{ flex: 1 }} />
        <button type="button" className="jr-btn primary big" disabled={!city || !!busy} onClick={unfold}>
          <Mark name="key" size={16} /> Unfold the day
        </button>
      </footer>
    </div>
  )
}
