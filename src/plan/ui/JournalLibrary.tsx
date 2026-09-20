import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { deleteTrip, listTrips, loadTrip, type Saved, type Summary } from '../../trips/store'
import type { Day } from '../../types'
import Icon from '../../ui/Icon'
import { vrLink } from '../../vr/share'
import Journal from './Journal'
import './journal-library.css'

const NAME_KEY = 'orion.journal-name'

const date = (time: number) => new Date(time).toLocaleDateString(undefined, {
  day: 'numeric', month: 'long', year: 'numeric',
})

function savedName() {
  try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' }
}

/** The volume that binds every saved trip together. Opening a chapter hands the
 * existing animated paper journal the full trip, so a saved day is exactly the
 * same page (and the same flight) as it was when the crew first made it. */
export default function JournalLibrary({ onClose, onPlan, onOpenTrip, onFly, onCity }: {
  onClose: () => void
  onPlan: () => void
  onOpenTrip: (id: string) => void
  /** Passed through to the journal: the city to show behind its plain view. */
  onCity?: (at: import('../../types').LatLon | null) => void
  onFly: (saved: Saved, day: Day) => void
}) {
  const [trips, setTrips] = useState<Summary[]>([])
  const [persistent, setPersistent] = useState(true)
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState<string | null>(null)
  const [selected, setSelected] = useState<Saved | null>(null)
  const [remove, setRemove] = useState<string | null>(null)
  const [vr, setVr] = useState<{ id: string; state: 'busy' | 'ready' | 'failed'; url?: string; copied?: boolean } | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState(savedName)

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = await listTrips()
      setTrips(result.trips); setPersistent(result.persistent)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      setError(/answered 404/.test(detail)
        ? 'The trip service is out of date. Restart Orion’s development server, then try again.'
        : /fetch|network/i.test(detail)
          ? 'The trip service is not running. Start Orion’s development server, then try again.'
          : 'The journal could not be opened. Try again in a moment.')
    }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const keepName = (next: string) => {
    setName(next)
    try {
      const clean = next.trim()
      if (clean) localStorage.setItem(NAME_KEY, clean)
      else localStorage.removeItem(NAME_KEY)
    } catch { /* the title still works for this visit */ }
  }

  const openChapter = async (id: string) => {
    setOpening(id); setError('')
    try { setSelected(await loadTrip(id)) }
    catch { setError('That chapter could not be opened.') }
    finally { setOpening(null) }
  }

  const removeChapter = async (id: string) => {
    try {
      await deleteTrip(id)
      setRemove(null)
      await refresh()
    } catch { setError('That trip could not be removed.') }
  }

  const sendToVr = async (id: string) => {
    setVr({ id, state: 'busy' })
    try {
      const url = await vrLink(id)
      let copied = false
      try { await navigator.clipboard.writeText(url); copied = true } catch { /* the visible link is the fallback */ }
      setVr({ id, state: 'ready', url, copied })
    } catch { setVr({ id, state: 'failed' }) }
  }

  if (selected) {
    return (
      <Journal
        trip={selected.trip}
        onFly={day => onFly(selected, day)}
        onHome={onPlan}
        onClose={() => setSelected(null)}
        onCity={onCity}
      />
    )
  }

  const possessive = name.trim() ? `${name.trim().replace(/[’']s$/i, '')}’s` : 'My'

  return (
    <section className="jl" aria-label="Travel journal">
      <div className="jl-scrim" />
      <motion.div className="jl-volume" initial={{ opacity: 0, y: 28, rotateX: 5 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} exit={{ opacity: 0, y: 18 }} transition={{ duration: .75, ease: [.22, .9, .24, 1] }}>
        <div className="jl-spine" aria-hidden><span>Orion</span></div>
        <header className="jl-cover">
          <button type="button" className="jl-close" onClick={onClose} aria-label="Close journal"><Icon name="close" size={18} /></button>
          <p className="jl-kicker">Collected journeys</p>
          <h1>{possessive} travel journal</h1>
          <label className="jl-name">
            <span>Personalize the cover</span>
            <input value={name} onChange={e => keepName(e.target.value)} maxLength={32} placeholder="Write your name" aria-label="Name on journal cover" />
          </label>
          <div className="jl-rule"><i /><span>✦</span><i /></div>
          <p className="jl-count">{trips.length ? `${trips.length} ${trips.length === 1 ? 'journey' : 'journeys'} kept here` : 'A home for the journeys ahead'}</p>
        </header>

        <div className="jl-pages">
          <div className="jl-page-head">
            <div>
              <p className="jl-hand">The places I’ll remember</p>
              <h2>Saved trips</h2>
            </div>
            <button type="button" className="o-btn primary small" onClick={onPlan}>Plan a new trip</button>
          </div>

          {error && trips.length > 0 && <p className="jl-error" role="alert">{error}</p>}
          {loading ? (
            <div className="jl-loading" role="status"><span className="o-spinner" /> Finding your chapters…</div>
          ) : error && trips.length === 0 ? (
            <motion.div className="jl-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="alert">
              <span className="jl-empty-mark">✦</span>
              <h3>The journal stayed closed.</h3>
              <p>{error}</p>
              <button type="button" className="o-btn primary" onClick={() => void refresh()}>Try opening it again</button>
            </motion.div>
          ) : trips.length === 0 ? (
            <motion.div className="jl-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <span className="jl-empty-mark">✦</span>
              <h3>Your first page is waiting.</h3>
              <p>Plan a trip and Orion will tuck every day into this journal, ready to open and fly again.</p>
              <button type="button" className="o-btn primary" onClick={onPlan}>Plan my first trip</button>
            </motion.div>
          ) : (
            <ol className="jl-chapters">
              <AnimatePresence initial={false}>
                {trips.map((trip, index) => (
                  <motion.li key={trip.id} layout initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 30 }} transition={{ delay: Math.min(index * .07, .35), duration: .5 }} style={{ ['--chapter' as string]: index }}>
                    <button type="button" className="jl-chapter" onClick={() => void openChapter(trip.id)} disabled={opening === trip.id}>
                      <span className="jl-tab">Journey {String(index + 1).padStart(2, '0')}</span>
                      <span className="jl-stamp">{new Date(trip.updatedAt).getFullYear()}</span>
                      <span className="jl-city">{trip.city}</span>
                      <span className="jl-meta">{trip.days === 1 ? 'One day' : `${trip.days} days`} · {trip.places} places</span>
                      <span className="jl-date">Last written {date(trip.updatedAt)}</span>
                      <span className="jl-open">{opening === trip.id ? 'Turning the pages…' : 'Open this chapter'} <b>→</b></span>
                    </button>
                    <div className="jl-chapter-actions">
                      {remove === trip.id ? (
                        <motion.div initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }}>
                          <span>Remove this trip?</span>
                          <button type="button" onClick={() => void removeChapter(trip.id)}>Remove</button>
                          <button type="button" onClick={() => setRemove(null)}>Keep it</button>
                        </motion.div>
                      ) : (
                        <>
                          <button type="button" onClick={() => onOpenTrip(trip.id)}>Edit trip</button>
                          <button type="button" onClick={() => void sendToVr(trip.id)} disabled={vr?.id === trip.id && vr.state === 'busy'}>{vr?.id === trip.id && vr.state === 'busy' ? 'Preparing VR…' : 'Send to VR'}</button>
                          <button type="button" onClick={() => setRemove(trip.id)}>Remove</button>
                        </>
                      )}
                    </div>
                    {vr?.id === trip.id && vr.state === 'ready' && vr.url && (
                      <div className="jl-vr" role="status">
                        <span>{vr.copied ? 'VR link copied' : 'Open on the headset'}</span>
                        <a href={vr.url} target="_blank" rel="noreferrer">{vr.url}</a>
                      </div>
                    )}
                    {vr?.id === trip.id && vr.state === 'failed' && <p className="jl-vr is-error" role="alert">Couldn’t prepare this trip for VR.</p>}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          )}

          {!persistent && !loading && trips.length > 0 && (
            <p className="jl-local">This development journal is kept only until the local server restarts. Connect MongoDB to keep it permanently.</p>
          )}
          <footer className="jl-foot"><span>Journeys planned with Orion</span><b>{new Date().getFullYear()}</b></footer>
        </div>
      </motion.div>
    </section>
  )
}
