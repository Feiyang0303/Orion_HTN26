import { useEffect, useState } from 'react'
import { listTrips } from '../../trips/store'
import Icon from '../../ui/Icon'

/* The bookmark on the front door. The old dropdown has become a proper volume,
 * so this remains visible even before the first trip: it teaches where saved
 * plans will live instead of making the feature appear only after the fact. */
export default function SavedTrips({ onOpenJournal }: { onOpenJournal: () => void }) {
  const [count, setCount] = useState(0)
  useEffect(() => { void listTrips().then(r => setCount(r.trips.length)).catch(() => setCount(0)) }, [])
  return (
    <div className="st">
      <button type="button" className="o-btn small st-journal" onClick={onOpenJournal}>
        <Icon name="spark" size={14} /> Travel journal {count > 0 && <b>{count}</b>}
      </button>
    </div>
  )
}
