import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { deleteTrip, listTrips, type Summary } from '../../trips/store'
import Icon from '../../ui/Icon'

/* The trips this browser has made, one tap from the front door. Quiet until there is
 * something in it: a first visit shows nothing at all. */

const when = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export default function SavedTrips({ onOpen }: { onOpen: (id: string) => void }) {
  const [trips, setTrips] = useState<Summary[]>([])
  const [persistent, setPersistent] = useState(true)
  const [open, setOpen] = useState(false)

  const refresh = useCallback(() => {
    listTrips().then(r => { setTrips(r.trips); setPersistent(r.persistent) }).catch(() => setTrips([]))
  }, [])
  useEffect(refresh, [refresh])

  if (!trips.length) return null
  return (
    <div className="st">
      <button type="button" className="o-btn small" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="spark" size={14} /> Your trips <b>{trips.length}</b>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul className="st-list o-glass" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .25 }}>
            {trips.map(t => (
              <li key={t.id}>
                <button type="button" className="st-open" onClick={() => onOpen(t.id)}>
                  <b>{t.city}</b>
                  <span>{t.days === 1 ? 'A day' : `${t.days} days`} · {t.places} places · {when(t.updatedAt)}</span>
                </button>
                <button type="button" className="st-del" aria-label={`Delete ${t.city}`} onClick={() => { void deleteTrip(t.id).then(refresh) }}>×</button>
              </li>
            ))}
            {!persistent && <li className="st-note">Kept in the server’s memory only: they go when it restarts.</li>}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
