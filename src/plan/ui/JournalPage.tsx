import { useEffect, useMemo, useState } from 'react'
import { Food, Sketch, TransportGlyph, foodFor, sketchFor } from './Sketches'
import { paletteFor } from './decor'
import { weatherLine, type DayWeather } from '../weather'
import { fallbackMemo, type Note } from '../memo'
import { HHMM, MINS, TRANSPORT_LABEL, type Day, type LatLon, type Transport, type Trip } from '../../types'

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

export default function JournalPage({ day, trip, open, onFly, weather, notes }: {
  day: Day; trip: Trip; open: boolean; onFly: () => void
  /** The forecast for this day of the trip, when one reaches that far. */
  weather?: DayWeather
  /** The foot of the page, written for this day. Absent until it arrives. */
  notes?: Note[]
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
    const glyphs: { x: number; y: number; mode: Transport; min: number }[] = []
    for (const l of legs) {
      const a = P(l.polyline[0]), b = P(l.polyline[l.polyline.length - 1]), m = P(mid(l.polyline))
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy)
      if (len < 70) continue
      const nx = -dy / len, ny = dx / len
      const g = { x: m.x + nx * 18, y: m.y + ny * 18, mode: l.transport, min: Math.round(l.durationSec / 60) }
      /* Two legs that double back on each other have their middles in nearly
         the same place, and two badges printed on top of one another say less
         than one does. The minutes are in the schedule either way, so the
         second is simply not drawn. */
      if (glyphs.some(o => Math.abs(o.x - g.x) < 78 && Math.abs(o.y - g.y) < 44)) continue
      glyphs.push(g)
    }
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

    /* Where each drawing stands.

       Greedy placement alone could not do this. It puts each sketch in the
       first clear spot it finds near its own pin, which works while the map is
       half empty and then, on a seven-stop day, runs out of clear spots and
       drops the rest wherever they fell — which is how the page ended up with
       names written across each other's pictures. So there are two passes: the
       greedy one to get everything roughly where it belongs, and then a
       relaxation that pushes whatever still overlaps apart, a little at a
       time, until it does not. The second pass is what makes a crowded day
       readable, because it can move something that was already placed.

       Fixed things — the columns either side, the title and memo bands, the
       numbered pins, the meal marks, the little way-glyphs on the path — push
       the drawings but are never pushed themselves. They are where they are
       because that is where the day is. */
    type Box = { x: number; y: number; w: number; h: number }
    const at = (p: Pt, w: number, h: number): Box => ({ x: p.x - w / 2, y: p.y - h / 2, w, h })
    const fixed: Box[] = [
      { x: -W, y: 0, w: MAP.x0 - 6 + W, h: H },               // the schedule's column
      { x: MAP.x1 + 6, y: 0, w: W, h: H },                    // the table's column
      { x: 0, y: -H, w: W, h: MAP.y0 - 10 + H },              // the title's band
      { x: 0, y: MAP.y1 + 16, w: W, h: H },                   // the memo's band
      ...stops.map(st => at(st, 46, 46)),                     // the numbered pins
      ...tables.map(t => at(t, 36, 36)),                      // the meal marks
      ...(home ? [at(home, 40, 40)] : []),
      ...glyphs.map(g => at(g, 70, 40)),                      // footprints and minutes
    ]
    /* Measured, not guessed: reserving less than a thing occupies is the same
       as not reserving it. The figure and its two lines of caption come to
       128 by 158 of these units, and the box is that plus air.

       The drawings had to come down in size to get here. At their old width,
       eight of them wanted 55% of the map band, and rectangles that big in a
       space that small cannot be arranged without touching — no amount of
       shoving solves a packing problem that has no solution. Smaller, they
       want about a third of it, which leaves the relaxation somewhere to put
       them. */
    const SW = 138, SH = 168
    const overlap = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    const offsets: [number, number][] = [
      [92, -80], [-92, -80], [0, -118], [104, 46], [-104, 46], [0, 98],
      [142, -20], [-142, -20], [62, -138], [-62, -138], [132, 84], [-132, 84],
    ]
    const inBand = (b: Box) =>
      b.x >= MAP.x0 - 16 && b.x + b.w <= MAP.x1 + 16 && b.y >= MAP.y0 - 16 && b.y + b.h <= MAP.y1 + 12
    const clamp = (b: Box) => {
      b.x = Math.max(MAP.x0 - 16, Math.min(MAP.x1 + 16 - b.w, b.x))
      b.y = Math.max(MAP.y0 - 16, Math.min(MAP.y1 + 12 - b.h, b.y))
      return b
    }

    /* Pass one: the first clear spot near the pin, or failing that, beside it. */
    const loose: Box[] = []
    const put = (x: number, y: number, w = SW, h = SH) => {
      const free = (b: Box) => inBand(b) && !fixed.some(o => overlap(b, o)) && !loose.some(o => overlap(b, o))
      for (const [dx, dy] of offsets) {
        const b = { x: x + dx - w / 2, y: y + dy - h / 2, w, h }
        if (free(b)) { loose.push(b); return b }
      }
      for (let ring = 130; ring <= 440; ring += 24) {
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2 - Math.PI / 2
          const b = { x: x + Math.cos(a) * ring - w / 2, y: y + Math.sin(a) * ring - h / 2, w, h }
          if (free(b)) { loose.push(b); return b }
        }
      }
      const b = clamp({ x: x - w / 2, y: y - h / 2 - 104, w, h })
      loose.push(b); return b
    }
    const homeBox = home ? put(home.x, home.y, 140, 124) : null
    const stopBoxes = stops.map(st => put(st.x, st.y))

    /* Pass two: unpick whatever is still on top of something.

       Each overlapping pair is pushed apart along whichever axis needs least
       movement, so a drawing slides off a neighbour rather than leaping across
       the map, and the fixed things push without being pushed. Two details
       matter. The push is a little more than the overlap, because settling
       exactly edge-to-edge leaves the next pass with nothing to do and the
       pair still touching. And each drawing is drawn gently back towards its
       own pin every pass, which is what stops them all migrating into the
       corners: without it the relaxation is happy to put the Louvre anywhere
       at all so long as nothing else is there. */
    const anchors = loose.map(b => ({ x: b.x, y: b.y }))
    const nudge = (b: Box, o: Box, share: number) => {
      const bx = b.x + b.w / 2, by = b.y + b.h / 2
      const ox = o.x + o.w / 2, oy = o.y + o.h / 2
      const px = (b.w + o.w) / 2 - Math.abs(bx - ox)     // how far in, horizontally
      const py = (b.h + o.h) / 2 - Math.abs(by - oy)     // and vertically
      if (px <= 0 || py <= 0) return
      if (px < py) b.x += (bx < ox ? -px - 1 : px + 1) * share
      else b.y += (by < oy ? -py - 1 : py + 1) * share
      clamp(b)
    }
    const movable = [...loose]
    for (let pass = 0; pass < 400; pass++) {
      let calm = true
      movable.forEach((b, i) => {
        let pushed = false
        for (const o of fixed) if (overlap(b, o)) { nudge(b, o, 1); pushed = true }
        for (const o of movable) {
          if (o === b || !overlap(b, o)) continue
          nudge(b, o, 0.5); pushed = true
        }
        if (pushed) { calm = false; return }
        /* Only once it stands clear does a drawing drift back towards its own
           pin. Doing this unconditionally, as it first did, is what kept the
           page overlapped: a box far from its anchor was pulled home harder
           than the separation could push it out, so the two forces settled at
           an equilibrium that was an overlap. Separation is not negotiable;
           coming home is. */
        b.x += (anchors[i].x - b.x) * 0.05
        b.y += (anchors[i].y - b.y) * 0.05
        clamp(b)
      })
      if (calm) break
    }

    /* Pass three: whatever is still overlapping gets moved outright.
       Relaxation is a local method — it shoves a drawing off its neighbour by
       the depth of the overlap and no further — so a box wedged between two
       pins oscillates in place while there is open paper elsewhere on the map
       it cannot walk to. This looks at the whole band: it scores every
       position on a coarse grid by how much it would overlap, and takes the
       cleanest, breaking ties by which is nearest where the drawing wanted to
       be. It runs only for boxes the first two passes failed, so a page that
       already reads well is left exactly as it was. */
    const clash = (b: Box, skip: Box) => {
      let area = 0
      for (const o of [...fixed, ...movable]) {
        if (o === skip) continue
        const px = Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x)
        const py = Math.min(b.y + b.h, o.y + o.h) - Math.max(b.y, o.y)
        if (px > 0 && py > 0) area += px * py
      }
      return area
    }
    movable.forEach((b, i) => {
      if (clash(b, b) === 0) return
      const want = anchors[i]
      let best = { x: b.x, y: b.y, score: Infinity }
      for (let x = MAP.x0 - 16; x <= MAP.x1 + 16 - b.w; x += 14) {
        for (let y = MAP.y0 - 16; y <= MAP.y1 + 12 - b.h; y += 14) {
          const area = clash({ x, y, w: b.w, h: b.h }, b)
          /* Overlap is weighted far above distance on purpose. Score them
             evenly and the search keeps a small overlap near the pin rather
             than taking clean paper a little further off — which is the whole
             thing this pass exists to stop. Being near its pin is a
             preference; not being on top of something is the point. */
          const score = area * 4 + Math.hypot(x - want.x, y - want.y) * 10
          if (score < best.score) best = { x, y, score }
        }
      }
      b.x = best.x; b.y = best.y
    })

    /* A way-glyph that a drawing ended up standing on is not drawn. The
       drawings are placed around the glyphs, so this is rare and only happens
       where the band left no other option — and when it does, the badge is
       the thing to lose: its minutes are written in the schedule as well, and
       the drawing is not. */
    const kept = glyphs.filter(g => !movable.some(b =>
      g.x > b.x - 35 && g.x < b.x + b.w + 35 && g.y > b.y - 20 && g.y < b.y + b.h + 20))
    glyphs.length = 0; glyphs.push(...kept)

    const homeAt = homeBox ? { bx: homeBox.x + homeBox.w / 2, by: homeBox.y + homeBox.h / 2 } : null
    const sketchAt = stopBoxes.map(b => ({ bx: b.x + b.w / 2, by: b.y + b.h / 2 }))

    return { route, glyphs, stops, home, homeAt, sketchAt, tables, streets, blocks, trees, river }
  }, [day, trip.city, bed])

  /* ----------------------------------------------------------- the cards */
  const leaving = (i: number) => HHMM(MINS(day.stops[i].arrival) + day.stops[i].visitMin)
  const lunch = day.tables.find(t => t.meal === 'lunch')
  const dinner = day.tables.find(t => t.meal === 'dinner')
  const km = (day.legs.reduce((n, l) => n + l.distanceM, 0) + (day.approach?.distanceM ?? 0) + (day.back?.distanceM ?? 0)) / 1000
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

  /* The forecast is printed by code, because it is a fact and facts are not a
     model's job. Everything beside it is written for this day from this day's
     own numbers (see memo.ts), and until that comes back the page shows the
     rule-written line, which is plainer and just as true. */
  const onFoot = [...(day.approach ? [day.approach] : []), ...day.legs, ...(day.back ? [day.back] : [])]
    .filter(l => l.transport === 'walk').reduce((n, l) => n + l.distanceM, 0) / 1000
  const memo: [string, string][] = [
    ['Weather', weatherLine(weather)],
    ...(notes?.length ? notes : fallbackMemo(weather, onFoot)).map(n => [n.label, n.text] as [string, string]),
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
              <Sketch name={sketch} size={72} wash={tones[i % 3]} wash2={tones[(i + 1) % 3]} ink={pal.ink} />
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
          {/* The name and its three small drawings in one row, so the drawings
              start where the name ends — a long name pushes them along, a very
              long one sends them under, and nothing sits on the letters. */}
          <div className="jp-title-row">
            <h1 className="jp-city">{trip.city}</h1>
            <div className="jp-title-marks" aria-hidden>
              {heroes.map((s, i) => <Sketch key={s.id} name={sketchFor(s.name, i)} size={44} wash={tones[i % 3]} ink={pal.ink} />)}
            </div>
          </div>
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
