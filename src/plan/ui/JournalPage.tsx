import { useEffect, useMemo, useState } from 'react'
import { Food, Sketch, TransportGlyph, foodFor, sketchFor } from './Sketches'
import { paletteFor } from './decor'
import { weatherLine, type DayWeather } from '../weather'
import { HHMM, MINS, TRANSPORT_LABEL, type Day, type LatLon, type Trip } from '../../types'

/* One day, as a page of a hand-drawn travel journal.
 *
 * The page is a map first: the day's real route, projected onto the paper and
 * laid as a cobbled path, with every stop pinned and sketched where it
 * actually stands and the time you are there written under it. If the day
 * has a river in it, a river runs through the page. The way between two
 * places is a small drawn glyph on the path — footprints, a bus, a bicycle.
 *
 * Around the map: the title in script, the day's schedule written down the
 * left, the table (drawn from the cuisine tag), pencil notes in the corners,
 * and a torn memo at the foot with the four things worth being told.
 *
 * It unfolds. The sheet opens on two creases, then the paper's streets fade
 * in, the path lays itself from the hotel outward, pins drop in order, each
 * sketch is pencilled then inked, and the cards settle last. Every timing is
 * a CSS variable set from the stop's index; there is no clock past the fold.
 *
 * Everything drawn is derived: the sketch from the name, the palette from the
 * kinds of place in the day, the streets from a seed made of the city's name,
 * the food from what OpenStreetMap says the kitchen serves. Nothing here is a
 * photograph, and nothing is a fact the plan does not hold.
 */

/* The sheet is landscape, and that is a layout decision rather than a taste
   one: a portrait page taller than the screen has to be scrolled, and a day
   you have to scroll is not a day you can see. Sixteen by ten is the shape of
   the screen it is read on, so the whole day fits at once — the schedule down
   the left, the map in the middle where the walking is, what you eat down the
   right, and the memo torn across the foot. */
const W = 1440, H = 900
/* Where the map may put things: right of the schedule, below the title, above the memo. */
const MAP = { x0: 0.265 * W, x1: 0.735 * W, y0: 0.10 * H, y1: 0.805 * H }

type Pt = { x: number; y: number }

function seeded(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  return () => { h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h >>> 0) % 10000) / 10000 }
}

function projector(points: LatLon[]) {
  const lats = points.map(p => p.lat), lons = points.map(p => p.lon)
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2
  const kx = Math.cos(lat0 * Math.PI / 180)
  const xs = lons.map(l => l * kx), ys = lats
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 0.004), spanY = Math.max(maxY - minY, 0.004)
  const s = Math.min((MAP.x1 - MAP.x0) / spanX, (MAP.y1 - MAP.y0) / spanY) * 0.78
  const cx = (MAP.x0 + MAP.x1) / 2, cy = (MAP.y0 + MAP.y1) / 2
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2
  return (p: LatLon): Pt => ({ x: cx + (p.lon * kx - mx) * s, y: cy - (p.lat - my) * s })
}

function wobble(d: Pt[], rnd: () => number, amt = 2.2): string {
  return d.map((p, i) => `${i ? 'L' : 'M'}${(p.x + (rnd() - .5) * amt).toFixed(1)} ${(p.y + (rnd() - .5) * amt).toFixed(1)}`).join(' ')
}
const mid = (pts: LatLon[]) => pts[Math.floor(pts.length / 2)] ?? pts[0]

const WATER = /river|seine|thames|tiber|canal|bridge|pont|ponte|harbour|harbor|bay|lake|quay|beach|island|île|isola|kamo|lagoon/i

export default function JournalPage({ day, trip, open, onFly, weather }: {
  day: Day; trip: Trip; open: boolean; onFly: () => void
  /** The forecast for this day of the trip, when one reaches that far. */
  weather?: DayWeather
}) {
  const [phase, setPhase] = useState<'folded' | 'opening' | 'live'>('folded')
  useEffect(() => {
    if (!open) { setPhase('folded'); return }
    const a = setTimeout(() => setPhase('opening'), 60)
    const b = setTimeout(() => setPhase('live'), 1500)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [open, day.number])

  const pal = paletteFor(trip.days.flatMap(d => d.stops.flatMap(s => [s.name, ...s.beats.slice(0, 1).map(b => b.text)])), trip.city)
  const bed = trip.stays[0] ?? null
  const tones = [pal.wash, pal.wash2, pal.wash3]

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
    const route = legs.map(l => wobble(l.polyline.map(P), r, 1.2))
    /* A way-glyph per leg that has room for one: beside the path's middle,
       a step off it so it does not sit on the stones or the pins. */
    const glyphs = legs.flatMap(l => {
      const a = P(l.polyline[0]), b = P(l.polyline[l.polyline.length - 1]), m = P(mid(l.polyline))
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy)
      if (len < 70) return []
      const nx = -dy / len, ny = dx / len
      return [{ x: m.x + nx * 18, y: m.y + ny * 18, mode: l.transport, min: Math.round(l.durationSec / 60) }]
    })
    const stops = day.stops.map((s, i) => ({ ...P(s), s, i, sketch: sketchFor(s.name, i) }))
    const home = bed ? { ...P(bed), name: bed.name } : null
    const tables = day.tables.map(t => ({ ...P(t), t }))

    // Streets: a loose, seeded grid the path can be seen to run along.
    const streets: string[] = []
    for (let i = 0; i < 22; i++) {
      const vertical = r() > .5
      const a = vertical ? { x: MAP.x0 - 60 + r() * (MAP.x1 - MAP.x0 + 120), y: MAP.y0 - 80 } : { x: MAP.x0 - 80, y: MAP.y0 - 60 + r() * (MAP.y1 - MAP.y0 + 120) }
      const b = vertical ? { x: a.x + (r() - .5) * 140, y: MAP.y1 + 80 } : { x: MAP.x1 + 80, y: a.y + (r() - .5) * 140 }
      const m = { x: (a.x + b.x) / 2 + (r() - .5) * 60, y: (a.y + b.y) / 2 + (r() - .5) * 60 }
      streets.push(`M${a.x.toFixed(0)} ${a.y.toFixed(0)} Q${m.x.toFixed(0)} ${m.y.toFixed(0)} ${b.x.toFixed(0)} ${b.y.toFixed(0)}`)
    }
    const blocks: { x: number; y: number; w: number; h: number; rot: number; tone: number }[] = []
    for (let i = 0; i < 16; i++) {
      blocks.push({ x: MAP.x0 + r() * (MAP.x1 - MAP.x0), y: MAP.y0 + r() * (MAP.y1 - MAP.y0), w: 28 + r() * 64, h: 22 + r() * 46, rot: (r() - .5) * 30, tone: Math.floor(r() * 3) })
    }
    // Trees: a few small round crowns scattered where the streets are not.
    const trees: Pt[] = []
    for (let i = 0; i < 14; i++) trees.push({ x: MAP.x0 + r() * (MAP.x1 - MAP.x0), y: MAP.y0 + r() * (MAP.y1 - MAP.y0) })

    /* A river, if the day has water in it: a wobbly band through the map that
       passes near the watery stop, from one edge of the sheet to another. */
    const wet = stops.find(st => WATER.test(st.s.name))
    let river: string | null = null
    if (wet) {
      const pts: Pt[] = []
      const x0 = MAP.x0 - 50, x1 = MAP.x1 + 50
      for (let k = 0; k <= 10; k++) {
        const t = k / 10
        const x = x0 + (x1 - x0) * t
        const y = wet.y + 34 + Math.sin(t * Math.PI * 1.6 + r()) * 70 + (r() - .5) * 20
        pts.push({ x, y })
      }
      river = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(0)} ${p.y.toFixed(0)}`).join(' ')
    }

    /* Where each sketch stands: beside its pin if it can, else the nearest
       clear spot, and never over the schedule or the title. */
    type Box = { x: number; y: number; w: number; h: number }
    const placed: Box[] = [
      { x: 0, y: 0, w: MAP.x0 - 6, h: H },                    // the schedule's column
      { x: MAP.x1 + 6, y: 0, w: W - MAP.x1, h: H },           // the table's column
      { x: 0, y: 0, w: W, h: MAP.y0 - 10 },                   // the title's band
      { x: 0, y: MAP.y1 + 16, w: W, h: H },                   // the memo's band
    ]
    const SW = 142, SH = 138
    const offsets: [number, number][] = [[100, -84], [-100, -84], [0, -128], [112, 44], [-112, 44], [0, 96], [156, -20], [-156, -20], [64, -150], [-64, -150]]
    const clear = (b: Box) => b.x >= MAP.x0 - 20 && b.x + b.w <= MAP.x1 + 20 && b.y >= MAP.y0 - 20 && b.y + b.h <= MAP.y1 + 16 &&
      !placed.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)
    const put = (x: number, y: number, w = SW, h = SH) => {
      for (const [dx, dy] of offsets) {
        const b = { x: x + dx - w / 2, y: y + dy - h / 2, w, h }
        if (clear(b)) { placed.push(b); return { bx: b.x + w / 2, by: b.y + h / 2 } }
      }
      for (let ring = 150; ring <= 420; ring += 38) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2 - Math.PI / 2
          const b = { x: x + Math.cos(a) * ring - w / 2, y: y + Math.sin(a) * ring - h / 2, w, h }
          if (clear(b)) { placed.push(b); return { bx: b.x + w / 2, by: b.y + h / 2 } }
        }
      }
      /* Nothing was clear, so it goes as near its pin as the band allows and
         overlaps something. It must still be clamped into the band: the
         columns either side hold the schedule and the table, and a sketch
         that lands on top of the day's lunch is worse than two sketches
         sharing a corner of the map. */
      const b = {
        x: Math.max(MAP.x0, Math.min(MAP.x1 - w, x - w / 2)),
        y: Math.max(MAP.y0, Math.min(MAP.y1 - h, y - 120)),
        w, h,
      }
      placed.push(b); return { bx: b.x + w / 2, by: b.y + h / 2 }
    }
    const homeAt = home ? put(home.x, home.y, 120, 110) : null
    const sketchAt = stops.map(st => put(st.x, st.y))

    return { route, glyphs, stops, home, homeAt, sketchAt, tables, streets, blocks, trees, river }
  }, [day, trip.city, bed])

  /* ----------------------------------------------------------- the cards */
  const leaving = (i: number) => HHMM(MINS(day.stops[i].arrival) + day.stops[i].visitMin)
  const lunch = day.tables.find(t => t.meal === 'lunch')
  const dinner = day.tables.find(t => t.meal === 'dinner')
  const km = (day.legs.reduce((n, l) => n + l.distanceM, 0) + (day.approach?.distanceM ?? 0) + (day.back?.distanceM ?? 0)) / 1000
  const modes = [...new Set([...(day.approach ? [day.approach] : []), ...day.legs, ...(day.back ? [day.back] : [])].map(l => l.transport))]
  const endsAt = day.stops.length ? HHMM(MINS(day.stops[day.stops.length - 1].arrival) + day.stops[day.stops.length - 1].visitMin) : trip.wish.endAt
  const homeAt = day.back ? HHMM(MINS(endsAt) + day.back.durationSec / 60) : endsAt
  const longest = [...day.legs].sort((a, b) => b.durationSec - a.durationSec)[0]
  const longestAfter = longest ? day.stops.find(s => s.id === longest.fromStopId)?.name : null

  /* Pencil in the corners: a few things the map itself cannot say. */
  const pencil = [
    longest && longest.durationSec > 15 * 60 ? `${Math.round(longest.durationSec / 60)} min after ${longestAfter} — the long bit` : '',
    day.legs.some(l => l.estimated) ? 'dotted legs were not routed; allow more' : '',
    lunch ? `lunch near stop ${day.stops.findIndex(s => s.id === lunch.nearStopId) + 1}` : '',
    day.stops[0] ? `check ${day.stops[0].name.split(',')[0]}'s hours first` : '',
  ].filter(Boolean).slice(0, 3)

  /* The four things on the memo. Counted where they can be, plain where they
     cannot: the forecast only reaches so far, and past that the book says so
     rather than inventing a number for day nine. */
  const memo = [
    ['ID', 'carry it — museums and some churches check, and the hotel will'],
    ['Weather', weatherLine(weather)],
    ['Shoes', `${km.toFixed(1)} km ${modes.map(m => TRANSPORT_LABEL[m].toLowerCase()).join(' & ')} — comfortable ones`],
    ['Getting about', modes.includes('transit') ? 'a day pass usually beats singles' : modes.includes('walk') ? 'all of it on foot; a card for the way home' : 'a card, and the hotel address written down'],
  ]

  const style = {
    '--ink-day': pal.accent, '--wash-day': pal.wash, '--wash2-day': pal.wash2, '--rule-day': pal.rule, '--paper': pal.paper, '--line': pal.ink,
  } as React.CSSProperties
  const heroes = day.stops.slice(0, 3)

  return (
    <div className={`jp is-${phase}`} style={style}>
      <div className="jp-sheet">
        {/* ------------------------------------------------- the paper */}
        <svg className="jp-map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
          <g filter="url(#deckle)">
            <rect x="8" y="8" width={W - 16} height={H - 16} fill={pal.paper} />
          </g>
          <rect width={W} height={H} filter="url(#paper)" opacity=".9" />
          <defs>
            <clipPath id="jp-town"><rect x={MAP.x0 - 30} y={MAP.y0 - 24} width={W - MAP.x0 + 30} height={MAP.y1 - MAP.y0 + 54} rx="30" /></clipPath>
          </defs>
          {scene && (
            <>
              {scene.river && (
                <g className="jp-river">
                  <path d={scene.river} filter="url(#wash)" className="jp-river-wash" />
                  <path d={scene.river} className="jp-river-line" filter="url(#ink)" />
                </g>
              )}
              <g clipPath="url(#jp-town)">
              <g className="jp-blocks" filter="url(#wash)">
                {scene.blocks.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={tones[b.tone]} transform={`rotate(${b.rot} ${b.x} ${b.y})`} />)}
              </g>
              <g className="jp-streets" filter="url(#pencil)">
                {scene.streets.map((d, i) => <path key={i} d={d} style={{ ['--i' as string]: i }} />)}
              </g>
              <g className="jp-trees" filter="url(#wash)">
                {scene.trees.map((t, i) => <circle key={i} cx={t.x} cy={t.y} r={9 + (i % 3) * 3} fill={pal.wash2} />)}
              </g>
              </g>
              {/* the cobbled path: a soft band, then the stones */}
              <g className="jp-path" filter="url(#ink)">
                {scene.route.map((d, i) => <path key={`b${i}`} d={d} className="jp-path-band" style={{ ['--i' as string]: i }} />)}
                {scene.route.map((d, i) => <path key={`s${i}`} d={d} className="jp-path-stones" style={{ ['--i' as string]: i }} />)}
              </g>
              <g className="jp-leaders">
                {scene.stops.map((st, i) => {
                  const a = scene.sketchAt[i]
                  return <line key={st.s.id} x1={st.x} y1={st.y} x2={a.bx} y2={a.by + 56} style={{ ['--i' as string]: i }} />
                })}
                {scene.home && scene.homeAt && <line x1={scene.home.x} y1={scene.home.y} x2={scene.homeAt.bx} y2={scene.homeAt.by + 40} style={{ ['--i' as string]: -1 }} />}
              </g>
              {scene.home && (
                <g transform={`translate(${scene.home.x} ${scene.home.y})`}><g className="jp-pin jp-pin-home">
                  <circle r="12" /><text y="5" textAnchor="middle">⌂</text>
                </g></g>
              )}
              {scene.tables.map(({ x, y, t }, i) => (
                <g key={t.id} transform={`translate(${x} ${y})`}><g className="jp-pin jp-pin-meal" style={{ ['--i' as string]: day.stops.length + i }}>
                  <circle r="9" /><text y="4" textAnchor="middle">{t.meal === 'lunch' ? 'L' : 'D'}</text>
                </g></g>
              ))}
              {scene.stops.map(({ x, y, s, i }) => (
                <g key={s.id} transform={`translate(${x} ${y})`}><g className="jp-pin" style={{ ['--i' as string]: i }}>
                  <circle r="14" /><text y="5" textAnchor="middle">{i + 1}</text>
                </g></g>
              ))}
            </>
          )}
        </svg>

        {/* ------------------------------------------ the way between */}
        {scene && scene.glyphs.map((g, i) => (
          <span key={i} className="jp-way" style={{ left: `${(g.x / W) * 100}%`, top: `${(g.y / H) * 100}%`, ['--i' as string]: i }}>
            <TransportGlyph mode={g.mode} size={20} ink={pal.ink} /><i>{g.min}′</i>
          </span>
        ))}

        {/* -------------------------------------------- the sketches */}
        {scene && scene.stops.map(({ s, i, sketch }) => {
          const at = scene.sketchAt[i]
          return (
            <figure key={s.id} className="jp-sk"
              style={{ left: `${(at.bx / W) * 100}%`, top: `${(at.by / H) * 100}%`, ['--i' as string]: i }}>
              <Sketch name={sketch} size={104} wash={tones[i % 3]} wash2={tones[(i + 1) % 3]} ink={pal.ink} />
              <figcaption><b>{i + 1}</b> {s.name.split(',')[0]}<em>{s.arrival}–{leaving(i)}</em></figcaption>
            </figure>
          )
        })}
        {scene?.home && scene.homeAt && (
          <figure className="jp-sk is-home" style={{ left: `${(scene.homeAt.bx / W) * 100}%`, top: `${(scene.homeAt.by / H) * 100}%`, ['--i' as string]: -1 }}>
            <Sketch name="hotel" size={70} wash={pal.wash2} ink={pal.ink} />
            <figcaption>{scene.home.name}<em>{trip.wish.startAt} · back {homeAt}</em></figcaption>
          </figure>
        )}

        {/* --------------------------------------------------- the title */}
        <header className="jp-title" style={{ ['--i' as string]: 0 }}>
          <div className="jp-title-marks" aria-hidden>
            {heroes.map((s, i) => <Sketch key={s.id} name={sketchFor(s.name, i)} size={44} wash={tones[i % 3]} ink={pal.ink} />)}
          </div>
          <h1 className="jp-city">{trip.city}</h1>
          <p className="jp-brush">{trip.city} {trip.days.length === 1 ? 'one-day trip' : `${trip.days.length}-day trip`}{trip.days.length > 1 ? ` · day ${day.number}` : ''}{day.title && day.title !== 'The day' ? ` · ${day.title.toLowerCase()}` : ''}</p>
          <span className="jp-title-wash" aria-hidden />
        </header>
        <div className="jp-stamp" aria-hidden><span>{trip.city.slice(0, 14)}</span><b>{km.toFixed(1)} km</b></div>

        {/* ------------------------------------------------ the schedule */}
        <section className="jp-plan" style={{ ['--i' as string]: 1 }}>
          <h3>The day</h3>
          <ol>
            {bed && day.approach && (
              <li className="jp-edge"><em>{trip.wish.startAt}</em><span>leave <b>{bed.name}</b><small>{Math.round(day.approach.durationSec / 60)} min {TRANSPORT_LABEL[day.approach.transport].toLowerCase()}</small></span></li>
            )}
            {day.stops.map((s, i) => (
              <li key={s.id}>
                <em>{s.arrival}<i>{leaving(i)}</i></em>
                <span>
                  <b>{i + 1}. {s.name.split(',')[0]}</b>
                  <small>{Math.round(s.visitMin)} min{day.legs[i] ? ` · then ${Math.round(day.legs[i].durationSec / 60)} min ${TRANSPORT_LABEL[day.legs[i].transport].toLowerCase()}` : ''}</small>
                  {lunch && lunch.nearStopId === s.id && <small className="jp-meal">lunch · {lunch.name}</small>}
                </span>
              </li>
            ))}
            {bed && day.back && <li className="jp-edge"><em>{endsAt}</em><span>back to <b>{bed.name}</b><small>{Math.round(day.back.durationSec / 60)} min · home {homeAt}</small></span></li>}
            {dinner && <li className="jp-edge"><em>{HHMM(Math.max(MINS(homeAt), 18 * 60 + 30))}</em><span>dinner · <b>{dinner.name}</b></span></li>}
          </ol>
        </section>

        {/* --------------------------------------------------- the table */}
        {(lunch || dinner) && (
          <section className="jp-table" style={{ ['--i' as string]: 2 }}>
            {[lunch, dinner].filter(Boolean).map(t => t && (
              <div key={t.id} className="jp-dish">
                <Food name={foodFor(t.cuisine, t.kind)} size={96} wash={tones[t.meal === 'lunch' ? 2 : 0]} wash2={tones[1]} ink={pal.ink} />
                <div>
                  <b>{t.meal}</b>
                  <strong>{t.name}</strong>
                  <span>{t.cuisine ? t.cuisine.replace(/;/g, ', ') : t.kind.replace('_', ' ')}{t.walkMin != null ? ` · ${t.walkMin} min from ${t.meal === 'dinner' && bed ? 'the hotel' : 'the stop'}` : ''}</span>
                  {t.why && <q>{t.why}</q>}
                </div>
              </div>
            ))}
          </section>
        )}


        {/* --------------------------------------------- pencil, corners */}
        <ul className="jp-pencil" aria-label="Notes">
          {pencil.map((n, i) => <li key={i} style={{ ['--i' as string]: 4 + i }}>{n}</li>)}
        </ul>

        {/* ------------------------------------------------- the memo */}
        <footer className="jp-memo" style={{ ['--i' as string]: 6 }}>
          <span className="jp-tape" aria-hidden />
          <ul>
            {memo.map(([k, v]) => <li key={k}><b>{k}</b><span>{v}</span></li>)}
          </ul>
          {/* the closing and the way out, kept together at the torn edge's right */}
          <div>
            <p className="jp-closing">— have a good day in {trip.city}.</p>
            <button type="button" className="jp-fly" onClick={onFly}>fly day {day.number} →</button>
          </div>
        </footer>

        <div className="jp-creases" aria-hidden />
      </div>

      <div className="jp-panel is-l" aria-hidden><div className="jp-face" /></div>
      <div className="jp-panel is-c" aria-hidden><div className="jp-face"><b>{trip.city}</b><span>Day {day.number}</span></div></div>
      <div className="jp-panel is-r" aria-hidden><div className="jp-face" /></div>
    </div>
  )
}
