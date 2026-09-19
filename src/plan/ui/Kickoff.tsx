import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { locate, suggest, type Place } from '../geocode'
import {
  PARTY_LABEL, TRANSPORT_WISH_LABEL,
  type Pace, type Party, type TransportWish, type Wish,
} from '../../types'

/* The kickoff: the only screen a person fills in.
 *
 * One question first (where?), asked large, over the real city; the rest of the
 * brief unfolds beneath it once there is a city to plan. Everything here changes
 * something real (the days decide how far afield the scout may look, the hours
 * are the window each day must fit, the pace and party stretch or squeeze every
 * visit, the transport is what the router prices), and everything has a
 * default, so "Paris, go" is a complete brief.
 *
 * Where to sleep is deliberately not asked. The crew picks a bed that suits the
 * finished plan; a choice made before any place exists can only be a guess.
 */

export type KickoffResult = { wish: Wish; mode: 'full' | 'short'; origin: Place }

const INTERESTS = ['History', 'Art and museums', 'Food and markets', 'Parks and green space', 'Views', 'Architecture', 'Music and theatre', 'Nightlife']
const PACES: { id: Pace; label: string }[] = [{ id: 'gentle', label: 'Slow' }, { id: 'steady', label: 'Steady' }, { id: 'full', label: 'Full' }]
const PARTIES = Object.keys(PARTY_LABEL) as Party[]
const TRANSPORTS = Object.keys(TRANSPORT_WISH_LABEL) as TransportWish[]
const DAYS = [1, 2, 3, 4, 5, 6, 7]

const rise = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: .6, delay: .08 * i, ease: [.22, .9, .24, 1] as const },
})

export default function Kickoff({ seedCity, onCity, onStart }: {
  seedCity?: string
  onCity?: (place: Place) => void
  onStart: (r: KickoffResult) => void
}) {
  const [cityText, setCityText] = useState(seedCity ?? '')
  const [city, setCity] = useState<Place | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const [days, setDays] = useState(1)
  const [pace, setPace] = useState<Pace>('steady')
  const [party, setParty] = useState<Party>('solo')
  const [transport, setTransport] = useState<TransportWish>('auto')
  const [interests, setInterests] = useState<string[]>(['History'])
  const [startAt, setStartAt] = useState('09:30')
  const [endAt, setEndAt] = useState('18:00')
  const [diet, setDiet] = useState('')
  const [quick, setQuick] = useState(false)

  const [wants, setWants] = useState<Place[]>([])
  const [wantText, setWantText] = useState('')
  const [hints, setHints] = useState<Place[]>([])
  const said = useRef<Place | null>(null)

  /* ---------------------------------------------------------------- city -- */

  const resolve = useCallback(async (text: string) => {
    if (!text.trim()) return
    setBusy(true); setNote('')
    const hit = await locate(text.trim(), undefined, undefined, { settlement: true }).catch(() => null)
    setBusy(false)
    if (!hit) { setNote(`No place called “${text.trim()}”. Try a city name.`); return }
    setCity(hit); setCityText(hit.name); setWants([])
    setNote(hit.alternatives?.length ? `Also found: ${hit.alternatives.slice(0, 3).map(a => a.name).join(' · ')}` : '')
  }, [])

  useEffect(() => { if (seedCity) void resolve(seedCity) }, [seedCity, resolve])
  useEffect(() => {
    if (!cityText.trim() || (city && city.name === cityText)) return
    const t = setTimeout(() => void resolve(cityText), 850)
    return () => clearTimeout(t)
  }, [cityText, city, resolve])

  // The shell hears about the city once: the real place's 3D tiles start
  // loading behind this page while the rest of the brief is filled in.
  useEffect(() => { if (city && said.current !== city) { said.current = city; onCity?.(city) } }, [city, onCity])

  /* --------------------------------------------------------- must-see list -- */

  useEffect(() => {
    if (!city || wantText.trim().length < 3) { setHints([]); return }
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      const list = await suggest(wantText, city, ctl.signal).catch(() => [])
      if (!ctl.signal.aborted) setHints(list.slice(0, 4))
    }, 420)
    return () => { clearTimeout(t); ctl.abort() }
  }, [wantText, city])

  const addWant = useCallback(async (given?: Place) => {
    if (!city) return
    const text = wantText.trim()
    if (!given && !text) return
    const hit = given ?? hints[0] ?? await locate(text, city).catch(() => null)
    if (!hit) { setNote(`Couldn't find “${text}” near ${city.name}.`); return }
    setWants(w => w.some(x => Math.hypot(x.lat - hit.lat, x.lon - hit.lon) < 0.0002) ? w : [...w, hit])
    setWantText(''); setHints([])
  }, [city, wantText, hints])

  /* ---------------------------------------------------------------- go -- */

  const toggle = (list: string[], x: string) => list.includes(x) ? list.filter(i => i !== x) : [...list, x]

  const go = () => {
    if (!city) return
    onStart({
      origin: city, mode: quick ? 'short' : 'full',
      wish: {
        city: city.name, wants: wants.map(p => p.name), from: '',
        startAt, endAt, interests, pace, transport, party, budget: 'modest',
        meals: ['lunch', 'dinner'], days, diet,
      },
    })
  }

  return (
    <div className="k-wrap">
      <div className="k-brand"><b>Orion</b><span>a day, planned and then flown</span></div>

      <motion.div className="k-card o-glass" initial={{ opacity: 0, y: 26, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .8, ease: [.22, .9, .24, 1] }}>
        <div className="k-head">
          <motion.p className="o-eyebrow" {...rise(0)}>Trip kickoff</motion.p>
          <motion.h1 className="o-title" {...rise(1)} style={{ marginTop: 14 }}>Where shall we <em>fly</em>?</motion.h1>
          <motion.p className="o-lede" {...rise(2)}>
            Name a place. A crew of agents plans your days on real streets, then a guide flies you through them over the real city.
          </motion.p>
        </div>

        <motion.div className="k-city" {...rise(3)}>
          <input className="o-input" value={cityText} autoFocus autoComplete="off" spellCheck={false}
            onChange={e => setCityText(e.target.value)} placeholder="Paris, Kyoto, Lisbon…"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void resolve(cityText) } }}
            aria-label="City" />
          <div className="k-state" aria-live="polite">
            <AnimatePresence mode="wait">
              {busy && <motion.span key="b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="o-spinner" />}
              {city && !busy && <motion.span key="c" initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} style={{ color: 'var(--ok)' }}>{city.region.split(',')[0] || 'found'} ✓</motion.span>}
            </AnimatePresence>
          </div>
          <p className="k-note">{note || (city ? '' : 'Type a city and pause: the real place loads behind this page.')}</p>
        </motion.div>

        <AnimatePresence>
          {city && (
            <motion.div key="brief" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              transition={{ duration: .7, ease: [.22, .9, .24, 1] }} style={{ overflow: 'hidden', margin: '0 -6px', padding: '0 6px' }}>
              <div className="k-grid">
                <div className="k-pair">
                  <motion.div className="k-field" {...rise(0)}>
                    <span className="k-label">How long</span>
                    <div className="k-days">
                      {DAYS.map(d => <button key={d} type="button" className="o-chip" aria-pressed={days === d} onClick={() => setDays(d)}>{d}</button>)}
                    </div>
                  </motion.div>

                  <motion.div className="k-field" {...rise(1)}>
                    <span className="k-label">Pace</span>
                    <div className="k-chips">
                      {PACES.map(p => <button key={p.id} type="button" className="o-chip" aria-pressed={pace === p.id} onClick={() => setPace(p.id)}>{p.label}</button>)}
                    </div>
                  </motion.div>
                </div>

                <motion.div className="k-field" {...rise(2)}>
                  <span className="k-label">Who is coming</span>
                  <div className="k-chips">
                    {PARTIES.map(p => <button key={p} type="button" className="o-chip" aria-pressed={party === p} onClick={() => setParty(p)}>{PARTY_LABEL[p]}</button>)}
                  </div>
                </motion.div>

                <motion.div className="k-field" {...rise(3)}>
                  <span className="k-label">What draws you <em>steers the scout</em></span>
                  <div className="k-chips">
                    {INTERESTS.map(i => <button key={i} type="button" className="o-chip" aria-pressed={interests.includes(i)} onClick={() => setInterests(l => toggle(l, i))}>{i}</button>)}
                  </div>
                </motion.div>

                <motion.div className="k-field" {...rise(4)}>
                  <span className="k-label">Getting around</span>
                  <div className="k-chips">
                    {TRANSPORTS.map(t => <button key={t} type="button" className="o-chip" aria-pressed={transport === t} onClick={() => setTransport(t)}>{TRANSPORT_WISH_LABEL[t]}</button>)}
                  </div>
                </motion.div>

                <div className="k-pair k-hours">
                  <motion.div className="k-field" {...rise(5)}>
                    <span className="k-label">Each day</span>
                    <div className="k-times">
                      <input className="o-input" type="time" value={startAt} onChange={e => setStartAt(e.target.value)} aria-label="Start" />
                      <span>to</span>
                      <input className="o-input" type="time" value={endAt} onChange={e => setEndAt(e.target.value)} aria-label="End" />
                    </div>
                  </motion.div>

                  <motion.div className="k-field" {...rise(6)}>
                    <span className="k-label">Anything to eat around <em>optional</em></span>
                    <input className="o-input" value={diet} onChange={e => setDiet(e.target.value)} placeholder="vegetarian, we like noodles…" />
                  </motion.div>
                </div>

                <motion.div className="k-field" {...rise(7)}>
                  <span className="k-label">Places you already want <em>never dropped</em></span>
                  <input className="o-input" value={wantText} onChange={e => setWantText(e.target.value)} placeholder="Type a place and press Enter"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addWant() } }} />
                  <AnimatePresence>
                    {hints.length > 0 && (
                      <motion.div className="k-chips" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                        {hints.map(h => <button key={`${h.lat}${h.lon}`} type="button" className="o-chip" onClick={() => void addWant(h)}>+ {h.name}</button>)}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="k-tokens">
                    <AnimatePresence>
                      {wants.map(w => (
                        <motion.span key={`${w.lat}${w.lon}`} className="k-token" layout initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .8 }}>
                          {w.name}
                          <button type="button" aria-label={`Remove ${w.name}`} onClick={() => setWants(l => l.filter(x => x !== w))}>×</button>
                        </motion.span>
                      ))}
                    </AnimatePresence>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div className="k-foot" {...rise(4)}>
          <div role="switch" tabIndex={0} aria-checked={quick} className="k-quick" onClick={() => setQuick(q => !q)}
            onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setQuick(q => !q) } }}>
            <span className="k-switch" /> Quick tour <span className="o-muted">· three stops</span>
          </div>
          <button type="button" className="o-btn primary big" disabled={!city || busy} onClick={go}>
            Send the crew <span aria-hidden>→</span>
          </button>
        </motion.div>
      </motion.div>
    </div>
  )
}
