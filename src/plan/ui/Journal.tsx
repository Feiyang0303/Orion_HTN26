import { useEffect, useState } from 'react'
import JournalPage from './JournalPage'
import { SketchDefs } from './Sketches'
import Icon from '../../ui/Icon'
import type { Day, Trip } from '../../types'
import './journal-page.css'

/* The journal: one hand-drawn page per day, and the trip's cover.
 *
 * Turning to a day folds the page closed and unfolds it again, because the
 * unfolding is the point — you watch the route ink itself in from the hotel,
 * the pins land in order, the sketches get drawn. Arrow keys turn pages. */

export default function Journal({ trip, onFly, onClose, onHome }: {
  trip: Trip
  onFly: (day: Day) => void
  onClose: () => void
  onHome: () => void
}) {
  const [at, setAt] = useState(0)
  const [open, setOpen] = useState(false)
  const day = trip.days[Math.min(at, trip.days.length - 1)]

  // Fold, then unfold: the same sheet cannot be seen to reprint itself.
  useEffect(() => {
    setOpen(false)
    const t = setTimeout(() => setOpen(true), 120)
    return () => clearTimeout(t)
  }, [at])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setAt(a => Math.min(trip.days.length - 1, a + 1))
      else if (e.key === 'ArrowLeft') setAt(a => Math.max(0, a - 1))
      else if (e.key === 'Escape') onClose()
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [trip.days.length, onClose])

  return (
    <div className="jn">
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
        <button type="button" className="o-btn quiet small" onClick={onClose}>Close the journal</button>
      </nav>
      {day && <JournalPage key={day.number} day={day} trip={trip} open={open} onFly={() => onFly(day)} />}
    </div>
  )
}
