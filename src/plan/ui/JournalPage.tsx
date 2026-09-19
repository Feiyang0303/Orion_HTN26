import { useEffect, useMemo, useState } from 'react'
import { Sketch, sketchFor, type SketchName } from './Sketches'
import { firstSentences, paletteFor } from './decor'
import { HHMM, MINS, TRANSPORT_LABEL, type Day, type LatLon, type Trip } from '../../types'

/* One day, as a page of a hand-drawn travel journal.
 *
 * The page is a map first: the day's real route, projected onto the paper and
 * inked as a dotted line, with every stop pinned and sketched where it
 * actually stands. The cards on the left are the schedule, the things to
 * look for, the notes, and tonight's bed — torn paper, tape, a paper clip.
 *
 * It unfolds. The sheet opens on two creases, then the streets fade in, the
 * route draws itself from the hotel outward, the pins drop in order, each
 * sketch is inked in stroke by stroke, and the cards slide on last. Every
 * timing is a CSS variable set from the stop's index, so the whole sequence
 * is one stylesheet and no JavaScript clock.
 *
 * Everything drawn is derived: the sketch from the name, the colour from the
 * kinds of place in the day, the streets from a seed made of the city's
 * name, the water from whether anything in the day is a river or a bridge.
 */

const W = 900, H = 1200
/* Where the map may put things: the right two-thirds, clear of the cards. */
const MAP = { x0: 0.36 * W, x1: 0.97 * W, y0: 0.12 * H, y1: 0.93 * H }

type Pt = { x: number; y: number }

function seeded(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  return () => { h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h >>> 0) % 10000) / 10000 }
}

/** A local, equal-area-enough projection of the day into the map area. */
function projector(points: LatLon[]) {
  const lats = points.map(p => p.lat), lons = points.map(p => p.lon)
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2
  const kx = Math.cos(lat0 * Math.PI / 180)
  const xs = lons.map(l => l * kx), ys = lats
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 0.004), spanY = Math.max(maxY - minY, 0.004)
  const areaW = MAP.x1 - MAP.x0, areaH = MAP.y1 - MAP.y0
  const s = Math.min(areaW / spanX, areaH / spanY) * 0.82
  const cx = (MAP.x0 + MAP.x1) / 2, cy = (MAP.y0 + MAP.y1) / 2
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2
  return (p: LatLon): Pt => ({ x: cx + (p.lon * kx - mx) * s, y: cy - (p.lat - my) * s })
}

/* A hand's slight tremor on a path: every point nudged a little, seeded. */
function wobble(d: Pt[], rnd: () => number, amt = 2.2): string {
  return d.map((p, i) => `${i ? 'L' : 'M'}${(p.x + (rnd() - .5) * amt).toFixed(1)} ${(p.y + (rnd() - .5) * amt).toFixed(1)}`).join(' ')
}

const WATER = /river|seine|thames|tiber|canal|bridge|pont|ponte|harbour|harbor|bay|lake|quay|beach|island|île|kamo/i

export default function JournalPage({ day, trip, open, onFly }: {
  day: Day; trip: Trip; open: boolean; onFly: () => void
}) {
  const [phase, setPhase] = useState<'folded' | 'opening' | 'live'>('folded')
  useEffect(() => {
    if (!open) { setPhase('folded'); return }
    const a = setTimeout(() => setPhase('opening'), 60)
    const b = setTimeout(() => setPhase('live'), 1500)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [open, day.number])

  const ink = paletteFor(day.stops.map(s => s.name))
  const bed = trip.stays[0] ?? null

  /* ------------------------------------------------------------ the map */
  const scene = useMemo(() => {
    const r = seeded(`${trip.city}:${day.number}:map`)
    const all: LatLon[] = [
      ...day.stops, ...(bed ? [bed] : []),
      ...day.legs.flatMap(l => l.polyline), ...(day.approach?.polyline ?? []), ...(day.back?.polyline ?? []),
    ]
    if (!all.length) return null
    const P = projector(all)
    const legs = [...(day.approach ? [day.approach] : []), ...day.legs, ...(day.back ? [day.back] : [])]
    const route = legs.map(l => wobble(l.polyline.map(P), r, 1.4))
    const routeLen = legs.reduce((n, l) => n + l.polyline.length, 0)
    const stops = day.stops.map((s, i) => ({ ...P(s), s, i, sketch: sketchFor(s.name, i) }))
    const home = bed ? { ...P(bed), name: bed.name } : null

    /* Where each sketch stands. A sketch is a box beside its pin; when the
       pins are close (an old city centre is four sights in three streets) the
       boxes are tried in eight directions until one lands clear of the others
       and clear of the cards, and a thin leader ties it back to its pin. */
    type Box = { x: number; y: number; w: number; h: number }
    const placed: Box[] = [{ x: 0, y: 0, w: MAP.x0 - 10, h: H }]   // the cards column
    const SW = 150, SH = 128
    const offsets: [number, number][] = [[95, -80], [-95, -80], [0, -120], [110, 40], [-110, 40], [0, 90], [150, -20], [-150, -20], [60, -140], [-60, -140]]
    const clear = (b: Box) => b.x >= MAP.x0 - 30 && b.x + b.w <= W - 8 && b.y >= 8 && b.y + b.h <= H - 8 &&
      !placed.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)
    const put = (x: number, y: number) => {
      for (const [dx, dy] of offsets) {
        const b = { x: x + dx - SW / 2, y: y + dy - SH / 2, w: SW, h: SH }
        if (clear(b)) { placed.push(b); return { bx: b.x + SW / 2, by: b.y + SH / 2 } }
      }
      // Nowhere near: walk outward in rings until a clear spot turns up. The
      // leader line carries the sketch back to its pin however far it went.
      for (let ring = 180; ring <= 520; ring += 45) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2 - Math.PI / 2
          const b = { x: x + Math.cos(a) * ring - SW / 2, y: y + Math.sin(a) * ring - SH / 2, w: SW, h: SH }
          if (clear(b)) { placed.push(b); return { bx: b.x + SW / 2, by: b.y + SH / 2 } }
        }
      }
      const b = { x: Math.max(MAP.x0, Math.min(W - SW - 8, x - SW / 2)), y: Math.max(8, y - 140), w: SW, h: SH }
      placed.push(b); return { bx: b.x + SW / 2, by: b.y + SH / 2 }
    }
    const homeAt = home ? put(home.x, home.y) : null
    const sketchAt = stops.map(st => put(st.x, st.y))
    const tables = day.tables.map(t => ({ ...P(t), t }))

    // Streets: a loose, seeded grid the route can be seen to run along.
    const streets: string[] = []
    for (let i = 0; i < 26; i++) {
      const vertical = r() > .5
      const a = vertical ? { x: MAP.x0 - 60 + r() * (MAP.x1 - MAP.x0 + 120), y: MAP.y0 - 80 } : { x: MAP.x0 - 80, y: MAP.y0 - 60 + r() * (MAP.y1 - MAP.y0 + 120) }
      const b = vertical ? { x: a.x + (r() - .5) * 140, y: MAP.y1 + 80 } : { x: MAP.x1 + 80, y: a.y + (r() - .5) * 140 }
      const mid = { x: (a.x + b.x) / 2 + (r() - .5) * 60, y: (a.y + b.y) / 2 + (r() - .5) * 60 }
      streets.push(`M${a.x.toFixed(0)} ${a.y.toFixed(0)} Q${mid.x.toFixed(0)} ${mid.y.toFixed(0)} ${b.x.toFixed(0)} ${b.y.toFixed(0)}`)
    }
    // Blocks: a few soft rectangles, like buildings washed in.
    const blocks: { x: number; y: number; w: number; h: number; rot: number }[] = []
    for (let i = 0; i < 18; i++) {
      blocks.push({ x: MAP.x0 + r() * (MAP.x1 - MAP.x0), y: MAP.y0 + r() * (MAP.y1 - MAP.y0), w: 30 + r() * 70, h: 24 + r() * 50, rot: (r() - .5) * 30 })
    }
    const water = day.stops.some(s => WATER.test(s.name))
    return { route, routeLen, stops, home, homeAt, sketchAt, tables, streets, blocks, water }
  }, [day, trip.city, bed])

  /* ----------------------------------------------------------- the cards */
  const leaving = (i: number) => HHMM(MINS(day.stops[i].arrival) + day.stops[i].visitMin)
  const lookFor = day.stops.flatMap(s => s.beats[0] ? [{ s, text: firstSentence(s.beats[0].text) }] : []).slice(0, 6)
  const lunch = day.tables.find(t => t.meal === 'lunch')
  const dinner = day.tables.find(t => t.meal === 'dinner')
  const km = (day.legs.reduce((n, l) => n + l.distanceM, 0) + (day.approach?.distanceM ?? 0) + (day.back?.distanceM ?? 0)) / 1000
  const modes = [...new Set([...(day.approach ? [day.approach] : []), ...day.legs, ...(day.back ? [day.back] : [])].map(l => l.transport))]
  const endsAt = day.stops.length ? HHMM(MINS(day.stops[day.stops.length - 1].arrival) + day.stops[day.stops.length - 1].visitMin + (day.back?.durationSec ?? 0) / 60) : trip.wish.endAt
  const notes = [
    `${km.toFixed(1)} km ${modes.map(m => TRANSPORT_LABEL[m].toLowerCase()).join(' & ')}${modes.length === 1 && modes[0] === 'walk' ? ' — comfortable shoes' : ''}`,
    day.legs.some(l => l.estimated) ? 'some legs are straight-line estimates — allow a little more' : '',
    lunch?.openingHours ? `${lunch.name}: hours tagged “${lunch.openingHours}”, unverified` : '',
    day.stops[0] ? `check ${day.stops[0].name}'s own hours before setting out` : '',
  ].filter(Boolean).slice(0, 4)
  const first = day.stops[0]
  const know = first ? firstSentence(first.blurb) : ''

  const style = {
    '--ink-day': ink.accent, '--wash-day': ink.wash, '--rule-day': ink.rule,
  } as React.CSSProperties

  return (
    <div className={`jp is-${phase}`} style={style}>
      <div className="jp-sheet">
        {/* ---------------------------------------------------- the map */}
        <svg className="jp-map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
          <rect width={W} height={H} fill="#f3ead6" />
          <rect width={W} height={H} filter="url(#paper)" opacity=".9" />
          {scene && (
            <>
              {scene.water && (
                <path className="jp-water" filter="url(#wash)"
                  d={`M${W * .55} ${H} C${W * .7} ${H * .8} ${W * .78} ${H * .74} ${W} ${H * .62} V${H} Z`} />
              )}
              <g className="jp-blocks" filter="url(#wash)">
                {scene.blocks.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} transform={`rotate(${b.rot} ${b.x} ${b.y})`} />)}
              </g>
              <g className="jp-streets" filter="url(#ink)">
                {scene.streets.map((d, i) => <path key={i} d={d} style={{ ['--i' as string]: i }} />)}
              </g>
              <g className="jp-route" filter="url(#ink)">
                {scene.route.map((d, i) => (
                  <path key={i} d={d} className="jp-route-leg" pathLength={100} style={{ ['--i' as string]: i, ['--n' as string]: scene.route.length }} />
                ))}
              </g>
              <g className="jp-leaders">
                {scene.stops.map((st, i) => {
                  const a = scene.sketchAt[i]
                  return <line key={st.s.id} x1={st.x} y1={st.y} x2={a.bx} y2={a.by + 48} style={{ ['--i' as string]: i }} />
                })}
                {scene.home && scene.homeAt && <line x1={scene.home.x} y1={scene.home.y} x2={scene.homeAt.bx} y2={scene.homeAt.by + 40} style={{ ['--i' as string]: -1 }} />}
              </g>
              {scene.home && (
                <g className="jp-pin jp-pin-home" transform={`translate(${scene.home.x} ${scene.home.y})`}>
                  <circle r="13" /><text y="5" textAnchor="middle">⌂</text>
                </g>
              )}
              {scene.tables.map(({ x, y, t }, i) => (
                <g key={t.id} className="jp-pin jp-pin-meal" transform={`translate(${x} ${y})`} style={{ ['--i' as string]: day.stops.length + i }}>
                  <circle r="9" /><text y="4" textAnchor="middle">{t.meal === 'lunch' ? 'L' : 'D'}</text>
                </g>
              ))}
              {scene.stops.map(({ x, y, s, i }) => (
                <g key={s.id} className="jp-pin" transform={`translate(${x} ${y})`} style={{ ['--i' as string]: i }}>
                  <circle r="14" /><text y="5" textAnchor="middle">{i + 1}</text>
                </g>
              ))}
            </>
          )}
        </svg>

        {/* The sketches stand beside their pins, in HTML so the fonts and the
            draw-in animation are simple; positions are the same projection. */}
        {scene && scene.stops.map(({ s, i, sketch }) => {
          const at = scene.sketchAt[i]
          return (
            <figure key={s.id} className="jp-sk"
              style={{ left: `${(at.bx / W) * 100}%`, top: `${(at.by / H) * 100}%`, ['--i' as string]: i }}>
              <Sketch name={sketch as SketchName} size={92} wash={ink.accent} ink="#3b2f22" />
              <figcaption><b>{i + 1}</b> {s.name}</figcaption>
            </figure>
          )
        })}
        {scene?.home && scene.homeAt && (
          <figure className="jp-sk is-home" style={{ left: `${(scene.homeAt.bx / W) * 100}%`, top: `${(scene.homeAt.by / H) * 100}%`, ['--i' as string]: -1 }}>
            <Sketch name="hotel" size={64} wash="#8a7a60" ink="#3b2f22" />
            <figcaption>{scene.home.name}</figcaption>
          </figure>
        )}

        {/* ---------------------------------------------------- the cards */}
        <div className="jp-cards">
          <header className="jp-banner" style={{ ['--i' as string]: 0 }}>
            <p className="jp-city">{trip.city}</p>
            <p className="jp-sub">{day.title === 'The day' ? `a day on foot` : day.title}</p>
            <p className="jp-date">Day {day.number} of {trip.days.length} · {trip.wish.startAt}–{endsAt}</p>
            <span className="jp-clip" aria-hidden />
          </header>

          {know && (
            <section className="jp-card jp-know" style={{ ['--i' as string]: 1 }}>
              <span className="jp-tape" aria-hidden />
              <h3>Worth knowing</h3>
              <p>{know}</p>
            </section>
          )}

          <section className="jp-card jp-plan" style={{ ['--i' as string]: 2 }}>
            <h3>The day</h3>
            <ol>
              {bed && day.approach && (
                <li className="jp-edge"><em>{trip.wish.startAt}</em><span>leave <b>{bed.name}</b> · {Math.round(day.approach.durationSec / 60)} min {TRANSPORT_LABEL[day.approach.transport].toLowerCase()}</span></li>
              )}
              {day.stops.map((s, i) => (
                <li key={s.id}>
                  <em>{s.arrival}<i>{leaving(i)}</i></em>
                  <span>
                    <b>{i + 1}. {s.name}</b>
                    <small>{Math.round(s.visitMin)} min{day.legs[i] ? ` · then ${Math.round(day.legs[i].durationSec / 60)} min ${TRANSPORT_LABEL[day.legs[i].transport].toLowerCase()}` : ''}</small>
                    {lunch && lunch.nearStopId === s.id && <small className="jp-meal">lunch · {lunch.name}{lunch.cuisine ? ` · ${lunch.cuisine.replace(/;/g, ', ')}` : ''}</small>}
                  </span>
                </li>
              ))}
              {bed && day.back && (
                <li className="jp-edge"><em>{HHMM(MINS(endsAt) - (day.back.durationSec) / 60)}</em><span>back to <b>{bed.name}</b> · {Math.round(day.back.durationSec / 60)} min</span></li>
              )}
              {dinner && <li className="jp-edge"><em>{HHMM(Math.max(MINS(endsAt), 18 * 60 + 30))}</em><span>dinner · <b>{dinner.name}</b>{dinner.cuisine ? ` · ${dinner.cuisine.replace(/;/g, ', ')}` : ''}</span></li>}
            </ol>
          </section>

          {lookFor.length > 0 && (
            <section className="jp-card jp-look" style={{ ['--i' as string]: 3 }}>
              <span className="jp-tape is-r" aria-hidden />
              <h3>Look for</h3>
              <ul>{lookFor.map(({ s, text }) => <li key={s.id}><i /><span>{text}</span></li>)}</ul>
            </section>
          )}

          <section className="jp-card jp-notes" style={{ ['--i' as string]: 4 }}>
            <h3>Notes</h3>
            <ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </section>

          {bed && (
            <section className="jp-card jp-bed" style={{ ['--i' as string]: 5 }}>
              <h3>Tonight</h3>
              <p><b>{bed.name}</b>{bed.stars != null ? ` · ${'★'.repeat(Math.min(5, bed.stars))}` : ''}</p>
              {bed.address && <p>{bed.address}</p>}
            </section>
          )}

          <div className="jp-actions" style={{ ['--i' as string]: 6 }}>
            <button type="button" className="jp-fly" onClick={onFly}>Fly day {day.number} →</button>
          </div>
        </div>

        {/* the creases and the stamp */}
        <div className="jp-creases" aria-hidden />
        <div className="jp-stamp" aria-hidden><span>{trip.city.slice(0, 14)}</span><b>{km.toFixed(1)} km</b></div>
      </div>

      {/* the outside of the folded sheet */}
      <div className="jp-panel is-l" aria-hidden><div className="jp-face" /></div>
      <div className="jp-panel is-c" aria-hidden><div className="jp-face"><b>{trip.city}</b><span>Day {day.number}</span></div></div>
      <div className="jp-panel is-r" aria-hidden><div className="jp-face" /></div>
    </div>
  )
}

const firstSentence = (s: string) => firstSentences((s ?? '').replace(/\s*\([^)]*\)/g, ''), 1)
