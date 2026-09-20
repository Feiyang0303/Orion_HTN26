import { useEffect, useState } from 'react'
import JournalPage from './JournalPage'
import TripView from './TripView'
import { SketchDefs } from './Sketches'
import Icon from '../../ui/Icon'
import type { Day, LatLon, Trip } from '../../types'
import { forecast, type DayWeather } from '../weather'
import { writeMemo, type Note } from '../memo'
import './journal-page.css'

/* The journal: one hand-drawn page per day, and the trip's cover.
 *
 * Turning to a day folds the page closed and unfolds it again, because the
 * unfolding is the point — you watch the route ink itself in from the hotel,
 * the pins land in order, the sketches get drawn. Arrow keys turn pages.
 *
 * The same trip can also be read plainly, and the bar switches between the
 * two. They are not competing designs: the drawn page is for taking a day in
 * at a glance and the plain one is for reading the detail — the guide's own
 * words, the photographs, every leg with its mode — which no amount of
 * watercolour will ever show as well. Whichever is open, it is one trip
 * underneath, so the day you were looking at is the day you get back. */

export default function Journal({ trip, onFly, onClose, onHome, onCity }: {
  trip: Trip
  onFly: (day: Day) => void
  onClose: () => void
  onHome: () => void
  /** The city this trip is in, while the plain view is open — so whatever is
      behind the journal can put the real city there, which is what the panel
      was designed to sit on. Null closes it again: the drawn page covers the
      screen with paper, so loading a city under it would be tiles bought for
      nobody. */
  onCity?: (at: LatLon | null) => void
}) {
  const [at, setAt] = useState(0)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'paper' | 'plain'>('paper')

  /* Ask for the city only while the plain view is showing, and give it back on
     the way out, so closing the journal does not leave a city loaded under a
     screen that has moved on. */
  useEffect(() => {
    onCity?.(view === 'plain' ? trip.origin : null)
    return () => onCity?.(null)
  }, [view, trip.origin, onCity])
  /* The plain reader has day tabs of its own and can show the whole trip at
     once, which the paper page cannot, so it keeps its own selection. */
  const [plainDay, setPlainDay] = useState<number | 'all'>('all')
  const day = trip.days[Math.min(at, trip.days.length - 1)]

  /* One forecast for the whole book, read once when it opens. The trip carries
     no dates, so this is the days from tomorrow and each page says which day
     it printed — see weather.ts. */
  const [weather, setWeather] = useState<DayWeather[]>([])
  useEffect(() => {
    const ctl = new AbortController()
    void forecast(trip.origin, trip.days.length, ctl.signal).then(w => { if (!ctl.signal.aborted) setWeather(w) })
    return () => ctl.abort()
  }, [trip.origin, trip.days.length])

  /* The foot of each page is written for that day once the forecast is in, and
     kept: turning back to a day should not spend another call, and should not
     quietly say something different the second time. */
  const [notes, setNotes] = useState<Record<number, Note[]>>({})
  useEffect(() => {
    if (!day || notes[day.number]) return
    const ctl = new AbortController()
    const onFoot = [...(day.approach ? [day.approach] : []), ...day.legs, ...(day.back ? [day.back] : [])]
      .filter(l => l.transport === 'walk').reduce((n, l) => n + l.distanceM, 0) / 1000
    void writeMemo(trip, day, weather[day.number - 1], onFoot, ctl.signal)
      .then(w => { if (!ctl.signal.aborted && w.length) setNotes(n => ({ ...n, [day.number]: w })) })
    return () => ctl.abort()
    // weather.length, not weather: the array is replaced once, when it arrives.
  }, [day, trip, weather, notes])

  // Fold, then unfold: the same sheet cannot be seen to reprint itself.
  useEffect(() => {
    setOpen(false)
    const t = setTimeout(() => setOpen(true), 120)
    return () => clearTimeout(t)
  }, [at])

  const toPlain = () => { setPlainDay(day ? day.number : 'all'); setView('plain') }
  const toPaper = () => {
    if (typeof plainDay === 'number') {
      const i = trip.days.findIndex(d => d.number === plainDay)
      if (i >= 0) setAt(i)
    }
    setView('paper')
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (view !== 'paper') return          // the plain reader scrolls; the arrows are its own
      if (e.key === 'ArrowRight') setAt(a => Math.min(trip.days.length - 1, a + 1))
      else if (e.key === 'ArrowLeft') setAt(a => Math.max(0, a - 1))
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [trip.days.length, onClose, view])

  return (
    <div className={`jn is-${view}`}>
      <SketchDefs />
      <nav className="jn-bar">
        <button type="button" className="o-btn quiet small" onClick={onHome}>← New trip</button>
        <div className="jn-days">
          <button type="button" className="o-btn quiet small" onClick={() => setAt(a => Math.max(0, a - 1))} disabled={at === 0} aria-label="Previous day"><Icon name="arrow" size={14} className="jn-flip" /></button>
          {trip.days.map((d, i) => (
            <button key={d.number} type="button" className="o-chip" aria-pressed={i === at} onClick={() => setAt(i)}>Day {d.number}</button>
          ))}
          <button type="button" className="o-btn quiet small" onClick={() => setAt(a => Math.min(trip.days.length - 1, a + 1))} disabled={at >= trip.days.length - 1} aria-label="Next day"><Icon name="arrow" size={14} /></button>
        </div>
        <div className="jn-right">
          {/* Export is the browser's own print, which is the honest way to get
              this page out: the map is SVG and the writing is text, so a PDF
              printed from it stays sharp at any size, where a screenshot of
              the screen would not. The print stylesheet takes the fold, the
              bar and the city behind it away and leaves the sheet. */}
          {view === 'paper' && (
            <button type="button" className="o-btn quiet small" onClick={() => print()}
              title="Print this page, or save it as a PDF">
              <Icon name="download" size={14} /> Export
            </button>
          )}
          {/* one trip, two ways of reading it */}
          <div className="jn-view" role="group" aria-label="How to read this trip">
            <button type="button" className="o-chip" aria-pressed={view === 'paper'} onClick={toPaper}>Paper</button>
            <button type="button" className="o-chip" aria-pressed={view === 'plain'} onClick={toPlain}>Plan</button>
          </div>
          <button type="button" className="o-btn quiet small" onClick={onClose}>Close the journal</button>
        </div>
      </nav>
      {view === 'paper'
        ? day && <JournalPage weather={weather[day.number - 1]} notes={notes[day.number]} key={day.number} day={day} trip={trip} open={open} onFly={() => onFly(day)} />
        : (
          <div className="jn-plain">
            <TripView
              trip={trip} day={plainDay} onDay={setPlainDay}
              onFly={d => onFly(d)} onFocus={() => {}}
            />
          </div>
        )}
    </div>
  )
}
