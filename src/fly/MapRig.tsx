import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { LatLon, Transport } from '../types'
import type { TilesHandle } from './GoogleTiles'
import { GroundPlacer, type Anchor } from './ground'
import { resample } from './geo'
import { smoothHeights } from './legStyle'
import RouteLine from './RouteLine'

/* The map. Not a picture of a map: the same photorealistic city the flight
 * uses, seen from above and slightly to the side, with the crew's work laid on
 * it. Pins drop onto real rooftops, routes are drawn along real streets, and the
 * camera drifts round the subject on a long, slow, eased orbit, moving to
 * whatever the screen is about (the whole city while the crew is scouting, the
 * spread of the day's places once there are some, one stop when it is focused).
 *
 * Every screen before the flight shares this, so the world never changes under
 * the person's hands: kickoff, the crew at work, and the itinerary are three
 * views of one place. */

export type MapPin = { id: string; lat: number; lon: number; label: string; name?: string; colour: string; fresh?: boolean; home?: boolean }
export type MapRoute = { id: string; points: LatLon[]; colour: string; dim?: boolean; transport?: Transport; estimated?: boolean; label?: string }
export type MapView = {
  pins: MapPin[]
  routes: MapRoute[]
  /** Fly the camera in to this point; null frames everything. */
  focus?: LatLon | null
  /** How far to stand back from the subject, 0.5 (close) .. 2 (wide). */
  distance?: number
}

const STEP_M = 40

export default function MapRig({ view, origin, tiles, loadTick }: {
  view: MapView
  origin: LatLon
  tiles: MutableRefObject<TilesHandle | null>
  loadTick: number
}) {
  const { camera } = useThree()
  const ground = useMemo(() => new GroundPlacer(), [])
  const [version, setVersion] = useState(0)
  const settled = useRef(0)

  // Everything that needs a place on the ground, as real lon/lat.
  const anchors = useMemo<Anchor[]>(() => {
    const out: Anchor[] = [{ key: 'origin', ...origin }]
    view.pins.forEach(p => out.push({ key: `p:${p.id}`, lat: p.lat, lon: p.lon }))
    if (view.focus) out.push({ key: 'focus', ...view.focus })
    view.routes.forEach(r => resample(r.points, STEP_M).forEach((pt, j) => out.push({ key: `r:${r.id}:${j}`, ...pt })))
    return out
  }, [view.pins, view.routes, view.focus, origin])
  const sig = useMemo(() => anchors.map(a => `${a.key}:${a.lat.toFixed(5)},${a.lon.toFixed(5)}`).join('|'), [anchors])
  useEffect(() => { ground.setAnchors(anchors) }, [ground, anchors, sig])
  useEffect(() => { ground.requeue() }, [ground, loadTick])
  // A map seen from above does not need rooftop detail, and parsing it is what keeps the
  // main thread busy while the crew works: coarser tiles, twice as fast to arrive.
  useEffect(() => { if (tiles.current) tiles.current.errorTarget = 30 }, [tiles, loadTick])

  const state = useRef({
    centre: new THREE.Vector3(), radius: 1300, angle: 0.6, inited: false,
  })

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05), st = state.current
    const changed = ground.step(tiles.current)
    if (changed) { settled.current += changed; if (!ground.pending || settled.current >= 20) { settled.current = 0; setVersion(v => v + 1) } }

    // Where the camera is looking, and how far back it stands.
    const at = (key: string) => { const c = ground.get(key); return c ? new THREE.Vector3(c.x, c.y, c.z) : null }
    const goal = new THREE.Vector3()
    let spread = 0
    const home = at('origin') ?? new THREE.Vector3()
    const focus = view.focus ? at('focus') : null
    if (focus) { goal.copy(focus) }
    else {
      const cells = view.pins.map(p => ground.get(`p:${p.id}`)).filter(Boolean) as { x: number; y: number; z: number }[]
      if (cells.length) {
        const c = new THREE.Vector3()
        cells.forEach(p => c.add(new THREE.Vector3(p.x, p.y, p.z)))
        c.divideScalar(cells.length)
        goal.copy(c)
        cells.forEach(p => { spread = Math.max(spread, Math.hypot(p.x - c.x, p.z - c.z)) })
      } else goal.copy(home)
    }
    const wanted = (focus ? 520 : THREE.MathUtils.clamp(spread * 1.55 + 480, 900, 3000)) * (view.distance ?? 1)

    if (!st.inited) { st.centre.copy(goal); st.radius = wanted; st.inited = true }
    const k = 1 - Math.exp(-dt * 1.4)          // eased: the camera never snaps to a new subject
    st.centre.lerp(goal, k)
    st.radius += (wanted - st.radius) * k
    st.angle += dt * 0.028

    const eye = new THREE.Vector3(
      st.centre.x + Math.cos(st.angle) * st.radius,
      st.centre.y + st.radius * 0.6,
      st.centre.z + Math.sin(st.angle) * st.radius,
    )
    camera.position.lerp(eye, 1 - Math.exp(-dt * 2.2))
    camera.lookAt(st.centre.x, st.centre.y, st.centre.z)
    ;(window as unknown as { __map: unknown }).__map = { cam: camera.position.toArray().map(Math.round), centre: st.centre.toArray().map(Math.round), r: Math.round(st.radius), hasTiles: !!tiles.current, stats: tiles.current?.stats, origin: ground.get('origin') }
  })

  // World-space lines, rebuilt as the ground refines under them.
  const lines = useMemo(() => view.routes.map(r => {
    const n = resample(r.points, STEP_M).length
    const pts: THREE.Vector3[] = []
    for (let j = 0; j < n; j++) { const c = ground.get(`r:${r.id}:${j}`); if (c) pts.push(new THREE.Vector3(c.x, c.y, c.z)) }
    return { ...r, pts: smoothHeights(pts) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [view.routes, ground, version])

  return (
    <>
      {lines.map(l => <RouteLine key={l.id} pts={l.pts} colour={l.colour} transport={l.transport ?? 'walk'} estimated={l.estimated} dim={l.dim} label={l.label} />)}
      {view.pins.map(p => {
        const c = ground.get(`p:${p.id}`)
        if (!c) return null
        return (
          <Html key={p.id} position={[c.x, c.y + 26, c.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
            <div className={`map-pin ${p.fresh ? 'is-fresh' : ''} ${p.home ? 'is-home' : ''}`} style={{ ['--pin' as string]: p.colour }}>
              <b>{p.label}</b>{p.name && <span>{p.name}</span>}
            </div>
          </Html>
        )
      })}
    </>
  )
}
