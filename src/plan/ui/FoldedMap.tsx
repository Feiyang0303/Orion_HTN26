import { useEffect, useMemo, useState } from 'react'
import MapSheet, { type MapLeg, type MapPin } from './MapSheet'
import { MARK } from './Marks'
import type { Day } from '../../types'

/* The map that unfolds.
 *
 * A tri-fold paper map, closed, lying on the page. When the spread opens, the
 * two outer panels swing out on their creases, the sheet settles flat, and the
 * printed paper gives way to the ground itself, with the day inked across it.
 * The creases stay printed over the live map so it never stops being paper.
 *
 * The delay before it goes live is not decoration: the tiles behind it start
 * loading the moment the panels begin to move, so by the time the paper is out
 * of the way there is a city under it.
 */

export default function FoldedMap({ day, colours, open }: {
  day: Day
  colours: string[]
  open: boolean
}) {
  const [unfolded, setUnfolded] = useState(false)
  useEffect(() => {
    if (!open) { setUnfolded(false); return }
    const t = setTimeout(() => setUnfolded(true), 1500)
    return () => clearTimeout(t)
  }, [open])

  const pins = useMemo<MapPin[]>(() => [
    ...(day.from ? [{ id: 'from', lat: day.from.lat, lon: day.from.lon, label: '·', name: day.from.name, colour: '#6d5a3c', start: true }] : []),
    ...day.stops.map((s, i) => ({
      id: s.id, lat: s.lat, lon: s.lon, label: String(i + 1), name: s.name,
      colour: colours[i % colours.length],
    })),
    ...day.tables.map(t => ({
      id: t.id, lat: t.lat, lon: t.lon, label: '·', name: `${t.meal}: ${t.name}`, colour: '#a2503c',
    })),
  ], [day, colours])

  const legs = useMemo<MapLeg[]>(() => {
    const chain = [...(day.from ? [day.from] : []), ...day.stops]
    const all = [...(day.approach ? [day.approach] : []), ...day.legs]
    return all.flatMap((leg, k) => {
      const a = chain[k], b = chain[k + 1]
      if (!a || !b) return []
      return [{
        points: leg.polyline.length >= 2 ? leg.polyline : [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }],
        colour: colours[(day.from ? k : k + 1) % colours.length],
        estimated: leg.estimated, minutes: leg.durationSec / 60,
      }]
    })
  }, [day, colours])

  const centre = day.stops[0] ?? day.origin

  return (
    <div className={`jr-fold ${open ? 'is-open' : ''} ${unfolded ? 'is-live' : ''}`}>
      <div className="jr-fold-sheet">
        <div className="jr-fold-scene">
          {open && <MapSheet centre={centre} pins={pins} legs={legs} />}
        </div>
        <div className="jr-fold-creases" aria-hidden />
        <div className="jr-fold-panel is-l" aria-hidden><div className="jr-fold-face" /></div>
        <div className="jr-fold-panel is-c" aria-hidden>
          <div className="jr-fold-face">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor"
              strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">{MARK.compass}</svg>
            <b>{day.title}</b>
            <span>Day {day.number} · {day.stops.length} stops</span>
          </div>
        </div>
        <div className="jr-fold-panel is-r" aria-hidden><div className="jr-fold-face" /></div>
      </div>
      <p className="jr-fold-note">
        {unfolded
          ? 'Drag to move it, scroll to come closer. The road is the router’s own geometry.'
          : 'A folded map.'}
      </p>
    </div>
  )
}
