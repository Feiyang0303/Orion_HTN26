import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LatLon } from '../../types'

/* The desk's map.
 *
 * A plain slippy map, drawn on a canvas: raster tiles, drag to pan, wheel to
 * zoom towards the cursor, click the ground to put a pin down. It is 2D on
 * purpose — this is the planning page, and a person moving five pins around
 * wants the flat, familiar thing, not a camera. The city in three dimensions
 * is what the flight is for.
 *
 * Two layers, and the difference between them is the whole point:
 *   the dashed line   an order. It claims nothing about the ground, so it is
 *                     drawn straight between pins and left faint.
 *   the inked line    a road the router actually returned, in the colour of
 *                     the stop it arrives at, revealed as it lands.
 */

export type MapPin = {
  id: string
  lat: number
  lon: number
  label: string
  name: string
  colour: string
  start?: boolean
  fresh?: boolean
}

export type MapLeg = {
  points: LatLon[]
  colour: string
  /** 0..1, how much of the line has been inked in. */
  reveal?: number
  /** A straight line between two pins: an order, not a road. */
  draft?: boolean
  estimated?: boolean
  minutes?: number
}

type Props = {
  centre: LatLon
  pins: MapPin[]
  legs?: MapLeg[]
  /** Off while the page is not asking for pins. */
  onPick?: (at: LatLon) => void
  onRemove?: (id: string) => void
  /** Bumping this recentres the view on `focus`. */
  focus?: { at: LatLon; serial: number } | null
  busy?: string | null
}

/* OpenStreetMap's own tiles, which the book's paper filter (see journal.css)
   turns into a sheet of the same stock. Carto's free basemap now stamps "API
   KEY REQUIRED" over every tile, so it is not an option. The OSM tile server
   asks for light use and a visible credit; the credit is printed in the corner
   and must stay there, and a demo is well within "light". There is no @2x
   tile, so retina screens get the standard one. */
const TILES = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
const TILE = 256
const MIN_Z = 3, MAX_Z = 18

const lon2x = (lon: number, world: number) => (lon + 180) / 360 * world
const lat2y = (lat: number, world: number) => {
  const s = Math.sin(lat * Math.PI / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world
}
const x2lon = (x: number, world: number) => x / world * 360 - 180
const y2lat = (y: number, world: number) => {
  const n = Math.PI * (1 - 2 * y / world)
  return 180 / Math.PI * Math.atan(Math.sinh(n))
}

export default function MapSheet({ centre, pins, legs = [], onPick, onRemove, focus, busy }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState({ lat: centre.lat, lon: centre.lon, z: 14 })
  const [size, setSize] = useState({ w: 640, h: 480 })
  const images = useRef(new Map<string, HTMLImageElement>())
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null)
  const [, redraw] = useState(0)

  // The map follows the city, but only when the city itself changes: nudging
  // the view back under the person's hand would be maddening.
  const city = `${centre.lat.toFixed(4)},${centre.lon.toFixed(4)}`
  useEffect(() => { setView(v => ({ ...v, lat: centre.lat, lon: centre.lon })) }, [city])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focus) setView(v => ({ ...v, lat: focus.at.lat, lon: focus.at.lon })) }, [focus?.serial])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const world = TILE * 2 ** view.z
  const originPx = useMemo(() => ({
    x: lon2x(view.lon, world) - size.w / 2,
    y: lat2y(view.lat, world) - size.h / 2,
  }), [view, world, size])

  const toScreen = useCallback((p: LatLon) => ({
    x: lon2x(p.lon, world) - originPx.x,
    y: lat2y(p.lat, world) - originPx.y,
  }), [world, originPx])

  const toWorldLatLon = useCallback((sx: number, sy: number) => ({
    lon: x2lon(originPx.x + sx, world), lat: y2lat(originPx.y + sy, world),
  }), [world, originPx])

  /* ------------------------------------------------------------- drawing -- */

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const dpr = Math.min(devicePixelRatio || 1, 2)
    cv.width = size.w * dpr; cv.height = size.h * dpr
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, size.w, size.h)

    // Tiles at the nearest whole zoom, scaled to the fractional one.
    const z = Math.max(MIN_Z, Math.min(MAX_Z, Math.round(view.z)))
    const scale = 2 ** (view.z - z)
    const span = TILE * scale
    const x0 = Math.floor(originPx.x / span), x1 = Math.floor((originPx.x + size.w) / span)
    const y0 = Math.floor(originPx.y / span), y1 = Math.floor((originPx.y + size.h) / span)
    const n = 2 ** z
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (ty < 0 || ty >= n) continue
        const key = `${z}/${((tx % n) + n) % n}/${ty}`
        let img = images.current.get(key)
        if (!img) {
          img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => redraw(k => k + 1)
          img.onerror = () => {}
          img.src = TILES(z, ((tx % n) + n) % n, ty)
          images.current.set(key, img)
        }
        if (img.complete && img.naturalWidth) {
          g.drawImage(img, tx * span - originPx.x, ty * span - originPx.y, span + 1, span + 1)
        }
      }
    }

    // Roads and orders.
    for (const leg of legs) {
      if (leg.points.length < 2) continue
      const pts = leg.points.map(toScreen)
      const upTo = leg.reveal == null ? pts.length : Math.max(2, Math.ceil(pts.length * leg.reveal))
      g.beginPath()
      g.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < upTo; i++) g.lineTo(pts[i].x, pts[i].y)
      g.lineCap = 'round'; g.lineJoin = 'round'
      if (leg.draft) {
        g.setLineDash([5, 7]); g.strokeStyle = 'rgba(90,74,50,.5)'; g.lineWidth = 1.6
      } else if (leg.estimated) {
        g.setLineDash([3, 6]); g.strokeStyle = leg.colour; g.lineWidth = 2
      } else {
        g.setLineDash([])
        g.strokeStyle = 'rgba(255,248,232,.85)'; g.lineWidth = 7; g.stroke()   // a casing, so the ink reads over any tile
        g.strokeStyle = leg.colour; g.lineWidth = 3.4
      }
      g.stroke()
      g.setLineDash([])
    }
  }, [view, size, legs, pins, toScreen, originPx])

  /* -------------------------------------------------------------- input -- */

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, moved: 0 }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!dx && !dy) return
    d.moved += Math.abs(dx) + Math.abs(dy)
    d.x = e.clientX; d.y = e.clientY
    setView(v => {
      const w = TILE * 2 ** v.z
      return { ...v, lon: x2lon(lon2x(v.lon, w) - dx, w), lat: y2lat(lat2y(v.lat, w) - dy, w) }
    })
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved > 4 || !onPick) return
    const box = host.current?.getBoundingClientRect()
    if (!box) return
    onPick(toWorldLatLon(e.clientX - box.left, e.clientY - box.top))
  }

  useEffect(() => {
    const el = host.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = el.getBoundingClientRect()
      const sx = e.clientX - box.left, sy = e.clientY - box.top
      setView(v => {
        const z = Math.max(MIN_Z, Math.min(MAX_Z, v.z - e.deltaY * 0.0016))
        if (z === v.z) return v
        // Keep the point under the cursor under the cursor.
        const w0 = TILE * 2 ** v.z, w1 = TILE * 2 ** z
        const ox = lon2x(v.lon, w0) - box.width / 2, oy = lat2y(v.lat, w0) - box.height / 2
        const at = { lon: x2lon(ox + sx, w0), lat: y2lat(oy + sy, w0) }
        const nx = lon2x(at.lon, w1) - sx + box.width / 2, ny = lat2y(at.lat, w1) - sy + box.height / 2
        return { z, lon: x2lon(nx, w1), lat: y2lat(ny, w1) }
      })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  return (
    <div ref={host} className={`om ${onPick ? 'is-picking' : ''}`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null }}>
      <canvas ref={canvas} style={{ width: size.w, height: size.h }} />

      {pins.map(p => {
        const s = toScreen(p)
        if (s.x < -60 || s.y < -60 || s.x > size.w + 60 || s.y > size.h + 60) return null
        return (
          <div key={p.id} className={`om-pin ${p.start ? 'is-start' : ''} ${p.fresh ? 'is-fresh' : ''}`}
            style={{ left: s.x, top: s.y, ['--c' as string]: p.colour }}
            title={p.name}>
            <span className="om-pin-disc">{p.label}</span>
            <span className="om-pin-name">{p.name}</span>
            {onRemove && !p.start && (
              <button className="om-pin-x" aria-label={`Remove ${p.name}`}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onRemove(p.id) }}>×</button>
            )}
          </div>
        )
      })}

      <div className="om-zoom">
        <button onPointerDown={e => e.stopPropagation()} onClick={() => setView(v => ({ ...v, z: Math.min(MAX_Z, v.z + 1) }))} aria-label="Closer">+</button>
        <button onPointerDown={e => e.stopPropagation()} onClick={() => setView(v => ({ ...v, z: Math.max(MIN_Z, v.z - 1) }))} aria-label="Further">−</button>
      </div>

      {onPick && <p className="om-hint">Click the ground to drop a pin</p>}
      {busy && <p className="om-busy"><span className="jr-busy" aria-hidden /> Finding {busy}…</p>}
      <p className="om-credit">© OpenStreetMap contributors</p>
    </div>
  )
}
