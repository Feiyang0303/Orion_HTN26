import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Billboard, RoundedBox, Stars, Text } from '@react-three/drei'
import { XROrigin, useXR } from '@react-three/xr'
import * as THREE from 'three'
import type { Day } from '../types'
import GoogleTiles, { type TilesHandle } from '../fly/GoogleTiles'
import { GroundPlacer } from '../fly/ground'
import { Path } from '../fly/routePath'
import { anchorsFor, keyLeg, keyStop, keyTarget, SAMPLE_STEP_M } from '../fly/anchors'
import { activeBeat, buildTimeline } from '../fly/timeline'
import { resample, smootherstep } from '../fly/geo'
import { legStyle, smoothHeights } from '../fly/legStyle'
import type { Transport } from '../types'
import { dayColour } from '../ui/palette'
import { store } from './store'

/* The trip as a table you stand at.
 *
 * Flying a person through a real city in a headset makes many of them ill: the
 * eyes say they are moving and the ears say they are not. So the default here is
 * the opposite of the flat flight. The whole city is a model on a table in front
 * of you, standing still, and the guide is a small light that flies the route
 * over it while you look down at the places it is talking about. The trick is a
 * rig scale: the person's own world (their head, their hands, the controls) is
 * scaled up by a few thousand, so the very same photorealistic tiles that the
 * flat flight uses, in the very same metres, fit in the space between two hands.
 *
 * "Inside" scales the rig back to one, and puts you on the ground 70 m from the
 * place being described. You never move smoothly. When the guide moves on, the
 * view fades out and you are set down at the next place.
 *
 * Everything on the table is drawn in real-world metres times `unit`, so a pin
 * is a couple of centimetres tall to the person standing at the table, however
 * many kilometres it stands for.
 */

const TABLE = { y: .84, z: -.82, half: .38 }         // the table's centre in the person's own space (metres)
const INSIDE_UNIT = 1500                             // markers are drawn this much larger when you are standing in the city
const VANTAGE_M = 70, VANTAGE_LIFT = 22              // how far back, and how far up, you are set down
const FONT = 'https://cdn.jsdelivr.net/fontsource/fonts/dm-sans@latest/latin-500-normal.woff'
const DISPLAY = 'https://cdn.jsdelivr.net/fontsource/fonts/im-fell-english@latest/latin-400-normal.woff'
const AMBER = '#f0b45e'
const noHit = () => null

export type Mode = 'table' | 'inside'
type Rig = { mode: Mode; zoom: number; yaw: number; day: number }
const ZOOMS = [.5, .7, 1, 1.45, 2.1]

export default function Scene({ days, store: xr, onReady }: { days: Day[]; store: typeof store; onReady: (ready: boolean) => void }) {
  const gl = useThree(s => s.gl)
  const controls = useThree(s => s.controls) as { target: THREE.Vector3; update: () => void } | null
  const inXR = useXR(s => s.session != null)
  const [rig, setRig] = useState<Rig>({ mode: 'table', zoom: 1, yaw: 0, day: 0 })
  const day = days[Math.min(rig.day, days.length - 1)]
  const tl = useMemo(() => buildTimeline(day), [day])
  const tiles = useRef<TilesHandle | null>(null)
  const ground = useMemo(() => new GroundPlacer(), [])
  const [version, setVersion] = useState(0)
  const [loadTick, setLoadTick] = useState(0)
  const onLoadEnd = useCallback(() => setLoadTick(t => t + 1), [])
  const tilesRef = useCallback((t: TilesHandle | null) => { tiles.current = t }, [])

  // The day's anchors, plus a place to stand for each stop.
  const vantages = useMemo(() => day.stops.map((s, i) => {
    const from = day.stops[i - 1] ?? day.stops[i + 1] ?? { lat: s.lat - .001, lon: s.lon }
    const dLat = from.lat - s.lat, dLon = (from.lon - s.lon) * Math.cos(s.lat * Math.PI / 180)
    const n = Math.hypot(dLat, dLon) || 1
    return { key: `v${i}`, lat: s.lat + dLat / n * VANTAGE_M / 111320, lon: s.lon + dLon / n * VANTAGE_M / (111320 * Math.cos(s.lat * Math.PI / 180)) }
  }), [day])
  useEffect(() => { ground.setAnchors([...anchorsFor(day), ...vantages]) }, [ground, day, vantages])
  useEffect(() => { ground.requeue() }, [ground, loadTick])

  // A headset has a fraction of a laptop's memory and no room for the flight's tile budget.
  useEffect(() => {
    const t = tiles.current
    if (!t) return
    t.lruCache.minSize = 3000; t.lruCache.maxSize = 6000; t.lruCache.minBytesSize = .3e9; t.lruCache.maxBytesSize = .5e9
    t.errorTarget = rig.mode === 'table' ? 18 : 10
  }, [loadTick, rig.mode])

  // What the tile loader is told to make sharp. It chooses tiles for the cameras it knows, and a
  // headset's eyes are not reliably one of them, so it is given one of its own: a camera standing
  // where the person's head is, looking where they will look (down at the table, or out at the
  // street). It is never drawn from; it only decides which tiles exist.
  const eye = useMemo(() => new THREE.PerspectiveCamera(60, 1, .1, 1000), [])
  useEffect(() => {
    const t = tiles.current
    if (!t) return
    t.setCamera(eye); t.setResolution(eye, 1600, 1600)
    return () => { t.deleteCamera(eye) }
  }, [eye, loadTick])

  // The city is cut to the table by clipping planes on its own materials.
  const clipPlanes = useMemo(() => [0, 1, 2, 3, 4].map(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e9)), [])
  useEffect(() => { gl.localClippingEnabled = true }, [gl])
  useEffect(() => {
    const t = tiles.current as (TilesHandle & { addEventListener: (t: string, f: (e: { scene: THREE.Object3D }) => void) => void; removeEventListener: (t: string, f: (e: { scene: THREE.Object3D }) => void) => void }) | null
    if (!t) return
    const clip = (root: THREE.Object3D) => root.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined
      if (m) { m.clippingPlanes = clipPlanes; m.clipIntersection = false }
    })
    clip(t.group)
    const onModel = (e: { scene: THREE.Object3D }) => clip(e.scene)
    t.addEventListener('load-model', onModel)
    return () => t.removeEventListener('load-model', onModel)
  }, [loadTick, clipPlanes])

  /* ---- where things are on the real ground ---- */
  const geo = useMemo(() => {
    const at = (key: string) => { const c = ground.get(key); return c ? new THREE.Vector3(c.x, c.y, c.z) : null }
    const stops = day.stops.map((_, i) => at(keyStop(i)))
    const legs = day.legs.map((leg, i) => {
      const pts: THREE.Vector3[] = []
      const n = resample(leg.polyline, SAMPLE_STEP_M).length
      for (let j = 0; j < n; j++) { const p = at(keyLeg(i, j)); if (p) pts.push(p) }
      return new Path(smoothHeights(pts))
    })
    const placed = stops.filter(Boolean) as THREE.Vector3[]
    const c = new THREE.Vector3()
    placed.forEach(p => c.add(p)); if (placed.length) c.divideScalar(placed.length)
    const yMin = Math.min(...placed.map(p => p.y), c.y)
    const extent = placed.reduce((m, p) => Math.max(m, Math.hypot(p.x - c.x, p.z - c.z)), 250)
    const targets = new Map<string, THREE.Vector3>()
    day.stops.forEach((s, i) => s.targets.forEach(t => { const p = at(keyTarget(i, t.id)); if (p) targets.set(`${i}:${t.id}`, p) }))
    const vant = day.stops.map((_, i) => at(`v${i}`))
    return { stops, legs, c: new THREE.Vector3(c.x, yMin, c.z), yMin, extent, ready: placed.length === day.stops.length, targets, vant }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, ground, version])
  const geoRef = useRef(geo); geoRef.current = geo
  useEffect(() => { onReady(geo.ready) }, [geo.ready, onReady])

  const fitScale = THREE.MathUtils.clamp((geo.extent * 1.3 + 140) / TABLE.half, 700, 9000)
  const tableScale = fitScale / rig.zoom
  const unit = rig.mode === 'table' ? tableScale : INSIDE_UNIT

  /* ---- the clock ---- */
  const play = useRef({ t: 0, playing: true, audio: null as HTMLAudioElement | null, beatKey: '', cur: '' })
  const [hud, setHud] = useState({ stop: 0, line: '', title: '', playing: true, target: '', seg: 'dive' as string })
  const [standAt, setStandAt] = useState(0)         // which stop the person is set down at, in "inside"

  /* ---- fading between places: nothing moves smoothly, it blinks ---- */
  const veil = useRef<THREE.Mesh>(null)
  const fade = useRef({ v: 0, goal: 0, then: null as (() => void) | null })
  const change = useCallback((apply: () => void) => {
    if (!inXR) { apply(); return }
    fade.current.goal = 1; fade.current.then = apply
  }, [inXR])
  const setR = (p: Partial<Rig>) => change(() => setRig(r => ({ ...r, ...p })))

  const origin = useRef<THREE.Group>(null)
  // On a screen there is no head to be at the table, so the orbit camera starts where one would be.
  const framed = useRef('')
  useFrame(({ camera }) => {
    const g = geoRef.current, o = origin.current
    const key = `${day.number}:${rig.yaw}:${rig.mode}:${standAt}`
    if (inXR || !g.ready || !o || !controls || framed.current === key) return
    if (rig.mode === 'table' ? o.scale.x < 2 : o.scale.x !== 1 || o.position.lengthSq() < 1) return   // wait for the rig to be placed
    framed.current = key
    o.updateMatrixWorld(true)
    if (rig.mode === 'table') {
      camera.position.copy(o.localToWorld(new THREE.Vector3(0, 1.45, .3)))
      controls.target.copy(o.localToWorld(new THREE.Vector3(0, TABLE.y - .05, TABLE.z)))
    } else {
      camera.position.copy(o.localToWorld(new THREE.Vector3(0, 1.6, 0)))
      controls.target.copy(g.stops[standAt] ?? o.localToWorld(new THREE.Vector3(0, 1.6, -30)))
    }
    controls.update()
  })
  const rigTmp = useMemo(() => ({ o: new THREE.Vector3(), t: new THREE.Vector3(), q: new THREE.Euler() }), [])

  const jump = useCallback((stop: number) => {
    const p = play.current
    p.t = tl.dwellStart[Math.max(0, Math.min(day.stops.length - 1, stop))] ?? 0
    p.beatKey = ''; p.audio?.pause(); p.playing = true
  }, [tl, day])

  // Whichever stop is being talked about is where a person standing in the city is put.
  const stopNow = useCallback(() => {
    const { seg } = tl.at(play.current.t)
    return seg.kind === 'dwell' ? seg.stop : seg.kind === 'travel' ? seg.leg + 1 : 0
  }, [tl])

  const leaving = useRef(0)
  const orb = useRef<THREE.Group>(null)
  const beam = useRef<THREE.Group>(null)
  const beamLine = useRef<THREE.Mesh>(null)
  const pinPulse = useRef<(THREE.Group | null)[]>([])
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), q: new THREE.Quaternion() }), [])

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, .05), p = play.current, g = geoRef.current
    const step = ground.step(tiles.current)
    if (step) setVersion(v => v + 1)

    /* the fade */
    const f = fade.current
    f.v += (f.goal - f.v) * (1 - Math.exp(-dt * 16))
    if (veil.current) { veil.current.visible = f.v > .01; (veil.current.material as THREE.MeshBasicMaterial).opacity = f.v }
    if (f.goal === 1 && f.v > .97 && f.then) { const fn = f.then; f.then = null; fn(); f.goal = 0 }

    /* the rig: this is the whole of "the city is a table" */
    if (origin.current && g.ready) {
      const o = origin.current
      if (rig.mode === 'table') {
        o.scale.setScalar(tableScale); o.rotation.y = rig.yaw
        rigTmp.t.set(0, TABLE.y, TABLE.z).multiplyScalar(tableScale).applyEuler(rigTmp.q.set(0, rig.yaw, 0))
        o.position.copy(g.c).sub(rigTmp.t)
      } else {
        const here = g.vant[standAt] ?? g.stops[standAt]
        const look = g.stops[standAt]
        if (here && look) {
          o.scale.setScalar(1)
          o.rotation.y = Math.atan2(-(look.x - here.x), -(look.z - here.z))
          o.position.set(here.x, here.y + VANTAGE_LIFT, here.z)
        }
      }
    }
    // Near and far follow the scale, so depth keeps its precision at both. In a headset they are
    // handed to the runtime, which measures them in the person's own metres (before the rig is
    // scaled up), so there they are the real numbers; on a screen the camera lives in the city's
    // metres and they are multiplied out.
    const cam = camera as THREE.PerspectiveCamera
    const k = inXR ? 1 : rig.mode === 'table' ? tableScale : 1
    const near = (rig.mode === 'table' ? .05 : .3) * k, far = (rig.mode === 'table' ? 40 : 20000) * k
    if (cam.near !== near || cam.far !== far) { cam.near = near; cam.far = far; cam.updateProjectionMatrix() }

    /* the eye the tile loader looks through, at the person's head */
    if (origin.current && g.ready) {
      const o = origin.current
      o.updateMatrixWorld(true)
      if (rig.mode === 'table') {
        eye.position.copy(o.localToWorld(tmp.a.set(0, 1.45, .35)))
        eye.lookAt(o.localToWorld(tmp.b.set(0, TABLE.y - .05, TABLE.z)))
        eye.fov = 60; eye.near = .05 * tableScale; eye.far = 40 * tableScale
      } else {
        eye.position.copy(o.localToWorld(tmp.a.set(0, 1.6, 0)))
        eye.lookAt(g.stops[standAt] ?? o.localToWorld(tmp.b.set(0, 1.6, -30)))
        eye.fov = 120; eye.near = .3; eye.far = 20000      // wide: they can turn their head
      }
      eye.updateProjectionMatrix(); eye.updateMatrixWorld(true)
    }

    /* the table's edges: the city beyond them is clipped away (in tile materials only, so the person's own things are never cut) */
    const P = clipPlanes
    if (rig.mode === 'table' && g.ready) {
      const R = TABLE.half * tableScale, cs = Math.cos(rig.yaw), sn = Math.sin(rig.yaw)
      // Each plane faces inward and sits R from the centre: keep n·p + d >= 0.
      const side = (i: number, nx: number, nz: number) => { P[i].normal.set(nx * cs + nz * sn, 0, -nx * sn + nz * cs); P[i].constant = R - P[i].normal.dot(g.c) }
      side(0, 1, 0); side(1, -1, 0); side(2, 0, 1); side(3, 0, -1)
      P[4].normal.set(0, 1, 0); P[4].constant = -(g.yMin - .01 * tableScale)
    } else P.forEach(pl => { pl.normal.set(0, 1, 0); pl.constant = 1e9 })

    /* a way out that needs no aiming: hold B or Y (the upper face button on either controller) */
    if (inXR) {
      const held = [...(gl.xr.getSession()?.inputSources ?? [])].some(src => src.gamepad?.buttons[5]?.pressed)
      leaving.current = held ? leaving.current + dt : 0
      if (leaving.current > .8) { leaving.current = 0; void gl.xr.getSession()?.end() }
    } else leaving.current = 0

    /* the guide */
    if (p.playing && g.ready && tiles.current && tiles.current.stats.visible > 8) p.t = Math.min(tl.total, p.t + dt)   // the guide waits for the city
    if (p.t >= tl.total && p.playing) { p.playing = false; p.audio?.pause() }
    const { seg, u } = tl.at(p.t)
    const beat = activeBeat(seg, p.t)
    const hoverH = .03 * unit
    if (orb.current) {
      let ok = false
      if (seg.kind === 'travel') {
        const path = g.legs[seg.leg]
        if (path && path.length > 0) { path.at(path.length * smootherstep(u), tmp.a); ok = true }
        else if (g.stops[seg.leg] && g.stops[seg.leg + 1]) { tmp.a.lerpVectors(g.stops[seg.leg]!, g.stops[seg.leg + 1]!, smootherstep(u)); ok = true }
      } else {
        const i = seg.kind === 'dwell' ? seg.stop : 0
        if (g.stops[i]) { tmp.a.copy(g.stops[i]!); ok = true }
      }
      orb.current.visible = ok && rig.mode === 'table'
      if (ok) {
        const rise = seg.kind === 'dive' ? (1 - smootherstep(u)) * .12 * unit : 0
        orb.current.position.set(tmp.a.x, tmp.a.y + hoverH + rise + Math.sin(p.t * 2.2) * .003 * unit, tmp.a.z)
      }
    }
    // A beam from the guide to whatever it is talking about.
    const tgt = beat?.beat.targetId && seg.kind === 'dwell' ? g.targets.get(`${seg.stop}:${beat.beat.targetId}`) : seg.kind === 'dwell' && beat ? g.stops[seg.stop] : null
    if (beam.current) {
      beam.current.visible = !!tgt
      if (tgt) {
        beam.current.position.copy(tgt)
        if (beamLine.current) {
          const from = rig.mode === 'table' && orb.current ? orb.current.position : tmp.b.set(tgt.x, tgt.y + .1 * unit, tgt.z)
          const len = Math.max(.001, from.y - tgt.y)
          beamLine.current.scale.set(1, len, 1); beamLine.current.position.set(0, len / 2, 0)
        }
      }
    }
    pinPulse.current.forEach((pg, i) => { if (pg) pg.scale.setScalar(1 + (seg.kind === 'dwell' && seg.stop === i ? .18 + Math.sin(p.t * 4) * .08 : 0)) })

    /* narration: one clip per beat, started where the clock says it should be */
    const key = beat ? `${p.t >= 0 ? seg.t0 : 0}:${beat.index}` : ''
    if (key !== p.beatKey) {
      p.beatKey = key; p.audio?.pause(); p.audio = null
      if (beat?.beat.audioUrl && p.playing) {
        const a = new Audio(beat.beat.audioUrl); a.currentTime = Math.max(0, p.t - beat.t0)
        a.play().catch(() => {}); p.audio = a
      }
    }
    if (!p.playing) p.audio?.pause()
    else if (p.audio?.paused && beat && p.audio.currentTime < (p.audio.duration || 0) - .05) p.audio.play().catch(() => {})

    /* what the screens show */
    const cur = seg.kind === 'dwell' ? seg.stop : seg.kind === 'travel' ? seg.leg + 1 : 0
    const sig = `${cur}|${beat?.beat.text ?? ''}|${p.playing}|${seg.kind}`
    if (sig !== p.cur) {
      p.cur = sig
      const tName = beat?.beat.targetId ? day.stops[cur]?.targets.find(t => t.id === beat.beat.targetId)?.name ?? '' : ''
      setHud({ stop: cur, line: beat?.beat.text ?? '', title: day.stops[Math.min(cur, day.stops.length - 1)]?.name ?? '', playing: p.playing, target: tName, seg: seg.kind })
      if (rig.mode === 'inside' && cur !== standAt && seg.kind !== 'dive') change(() => setStandAt(cur))
    }
  })
  useEffect(() => () => { play.current.audio?.pause() }, [])
  // A new day starts from its beginning.
  useEffect(() => { play.current.t = 0; play.current.beatKey = ''; play.current.audio?.pause(); play.current.playing = true; setStandAt(0) }, [day])


  const c = dayColour(day.number - 1)
  const many = days.length > 1
  const zi = ZOOMS.reduce((best, z, i) => Math.abs(z - rig.zoom) < Math.abs(ZOOMS[best] - rig.zoom) ? i : best, 0)

  return (
    <>
      <color attach="background" args={['#07060a']} />
      <ambientLight intensity={1.7} />
      <directionalLight position={[300, 800, 400]} intensity={1.3} color="#ffe6b8" />
      <GoogleTiles lat={day.origin.lat} lon={day.origin.lon} onLoadEnd={onLoadEnd} tilesRef={tilesRef} />

      {/* the table, and everything on it */}
      {geo.ready && rig.mode === 'table' && <Plinth centre={geo.c} yMin={geo.yMin} half={TABLE.half * tableScale} yaw={rig.yaw} unit={tableScale} />}
      {geo.legs.map((p, i) => p.pts.length > 1 && <Route key={`${day.number}:${i}`} path={p} colour={c} unit={unit} played={hud.stop > i} transport={day.legs[i].transport} estimated={day.legs[i].estimated} />)}
      {day.stops.map((stop, i) => {
        const pos = geo.stops[i]; if (!pos) return null
        return <Pin key={stop.id} refFn={g => { pinPulse.current[i] = g }} pos={pos} n={i + 1} name={stop.name} colour={c} unit={unit} active={hud.stop === i} showName={rig.mode === 'table' || hud.stop === i}
          onPick={() => { jump(i) }} />
      })}
      <Guide orb={orb} beam={beam} beamLine={beamLine} unit={unit} colour={c} />

      {/* the person's own world: scaled up so the city fits between their hands */}
      <XROrigin ref={origin}>
        <Room />
        <Console
          xr={xr} hud={hud} many={many} dayNo={day.number} dayName={many ? day.title : ''} mode={rig.mode} zoomAt={zi} colour={c}
          onPrev={() => jump(hud.stop - 1)} onNext={() => jump(hud.stop + 1)}
          onPlay={() => { const p = play.current; if (p.t >= tl.total) jump(0); else { p.playing = !p.playing; setHud(h => ({ ...h, playing: p.playing })); p.cur = '' } }}
          onMode={() => { setStandAt(stopNow()); setR({ mode: rig.mode === 'table' ? 'inside' : 'table' }) }}
          onZoom={d => setR({ zoom: ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, zi + d))] })}
          onTurn={d => setR({ yaw: rig.yaw + d * Math.PI / 6 })}
          onDay={() => setR({ day: (rig.day + 1) % days.length })} />
        <Captions hud={hud} colour={c} count={day.stops.length} />
        <mesh ref={veil} visible={false} renderOrder={999} raycast={noHit}>
          <sphereGeometry args={[.35, 24, 16]} />
          <meshBasicMaterial color="#000" side={THREE.BackSide} transparent opacity={0} depthTest={false} depthWrite={false} />
        </mesh>
      </XROrigin>
    </>
  )
}

/* ------------------------------------------------------------ the world -- */

/** A slab the city sits on, so the edge of the model is an edge and not a cut through nothing. */
function Plinth({ centre, yMin, half, yaw, unit }: { centre: THREE.Vector3; yMin: number; half: number; yaw: number; unit: number }) {
  const depth = .05 * unit, top = yMin - .01 * unit
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * half, depth, 2 * half)), [half, depth])
  return (
    <group position={[centre.x, top - depth / 2, centre.z]} rotation={[0, yaw, 0]}>
      <mesh raycast={noHit}><boxGeometry args={[2 * half, depth, 2 * half]} /><meshStandardMaterial color="#120f0c" roughness={.9} metalness={.2} /></mesh>
      <lineSegments geometry={edges} raycast={noHit}><lineBasicMaterial color={AMBER} transparent opacity={.55} /></lineSegments>
      {/* the rim, a hairline of light around the top edge of the city */}
      <mesh position={[0, depth / 2 + .0005 * unit, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noHit}>
        <ringGeometry args={[half * 1.0, half * 1.006, 4, 1, Math.PI / 4]} />
        <meshBasicMaterial color={AMBER} transparent opacity={.9} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/** Each way of travelling is a different object on the table: footsteps are beads, a bicycle's
    line is longer beads, and a bus or a car is a ribbon with a glow around it. */
function Route({ path, colour, unit, played, transport, estimated }: { path: Path; colour: string; unit: number; played: boolean; transport: Transport; estimated?: boolean }) {
  const st = legStyle(transport, estimated)
  const opacity = played ? .4 : st.opacity
  const tube = useMemo(() => {
    if (st.beads) return null
    const curve = new THREE.CatmullRomCurve3(path.pts.map(p => new THREE.Vector3(p.x, p.y + .0015 * unit + 2, p.z)), false, 'centripetal')
    const n = Math.min(600, path.pts.length * 3)
    return { main: new THREE.TubeGeometry(curve, n, st.tube * unit, 6, false), glow: st.glow ? new THREE.TubeGeometry(curve, n, st.tube * 2.6 * unit, 6, false) : null }
  }, [path, unit, st.beads, st.tube, st.glow])
  useEffect(() => () => { tube?.main.dispose(); tube?.glow?.dispose() }, [tube])
  const beads = useMemo(() => {
    if (!st.beads) return []
    const gap = st.beads * unit, out: THREE.Vector3[] = []
    for (let s = 0; s <= path.length; s += gap) out.push(path.at(s).clone().add(new THREE.Vector3(0, .0015 * unit + 2, 0)))
    return out
  }, [path, unit, st.beads])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const inst = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const m = inst.current; if (!m) return
    beads.forEach((p, i) => { dummy.position.copy(p); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix) })
    m.count = beads.length; m.instanceMatrix.needsUpdate = true
  }, [beads, dummy])
  return (
    <>
      {tube && <mesh geometry={tube.main} raycast={noHit}><meshBasicMaterial color={colour} transparent opacity={opacity} toneMapped={false} /></mesh>}
      {tube?.glow && <mesh geometry={tube.glow} raycast={noHit}><meshBasicMaterial color={colour} transparent opacity={.14} depthWrite={false} toneMapped={false} /></mesh>}
      {st.beads && beads.length > 0 && (
        <instancedMesh key={beads.length} ref={inst} args={[undefined, undefined, beads.length]} raycast={noHit} frustumCulled={false}>
          <sphereGeometry args={[st.tube * 1.35 * unit, 10, 8]} /><meshBasicMaterial color={colour} transparent opacity={opacity} toneMapped={false} />
        </instancedMesh>
      )}
    </>
  )
}

function Pin({ pos, n, name, colour, unit, active, showName, onPick, refFn }: {
  pos: THREE.Vector3; n: number; name: string; colour: string; unit: number; active: boolean; showName: boolean; onPick: () => void; refFn: (g: THREE.Group | null) => void
}) {
  const [hover, setHover] = useState(false)
  const H = .034 * unit
  return (
    <group position={pos} ref={refFn}>
      <mesh position={[0, H / 2, 0]} raycast={noHit}><cylinderGeometry args={[.0007 * unit, .0007 * unit, H, 8]} /><meshBasicMaterial color={colour} toneMapped={false} /></mesh>
      <mesh position={[0, H + .008 * unit, 0]} onClick={e => { e.stopPropagation(); onPick() }} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
        <sphereGeometry args={[.0085 * unit * (hover ? 1.2 : 1), 24, 16]} />
        <meshBasicMaterial color={active ? '#fff3d6' : colour} toneMapped={false} />
      </mesh>
      <Billboard position={[0, H + .008 * unit, 0]}>
        <Text font={FONT} fontSize={.0105 * unit} color="#1a1208" anchorX="center" anchorY="middle" position={[0, 0, .0088 * unit]} outlineWidth={0}>{n}</Text>
        {showName && <Text font={DISPLAY} fontSize={.0125 * unit} color="#f4e7c6" anchorX="center" anchorY="bottom" position={[0, .0135 * unit, 0]} maxWidth={.14 * unit} textAlign="center"
          outlineWidth={.0012 * unit} outlineColor="#07060a">{name}</Text>}
      </Billboard>
    </group>
  )
}

/** The guide: a small light that carries the route, and a shaft of it onto whatever is being described. */
function Guide({ orb, beam, beamLine, unit, colour }: { orb: MutableRefObject<THREE.Group | null>; beam: MutableRefObject<THREE.Group | null>; beamLine: MutableRefObject<THREE.Mesh | null>; unit: number; colour: string }) {
  return (
    <>
      <group ref={orb} visible={false}>
        <mesh raycast={noHit}><sphereGeometry args={[.011 * unit, 24, 16]} /><meshBasicMaterial color="#fff3d6" toneMapped={false} /></mesh>
        <mesh raycast={noHit}><sphereGeometry args={[.026 * unit, 24, 16]} /><meshBasicMaterial color={AMBER} transparent opacity={.22} depthWrite={false} toneMapped={false} /></mesh>
        <pointLight color={AMBER} intensity={3} distance={.3 * unit} decay={2} />
      </group>
      <group ref={beam} visible={false}>
        <mesh ref={beamLine} raycast={noHit}><cylinderGeometry args={[.0012 * unit, .0035 * unit, 1, 10, 1, true]} /><meshBasicMaterial color={AMBER} transparent opacity={.35} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} /></mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .002 * unit, 0]} raycast={noHit}>
          <ringGeometry args={[.012 * unit, .0155 * unit, 48]} /><meshBasicMaterial color={colour} transparent opacity={.9} depthTest={false} toneMapped={false} />
        </mesh>
      </group>
    </>
  )
}

/* ------------------------------------------------ the person's own space -- */

/** A floor, and the sky, so there is somewhere to stand. */
function Room() {
  return (
    <group>
      <Stars radius={30} depth={20} count={1400} factor={.9} fade speed={.3} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.005, TABLE.z * .5]} raycast={noHit}>
        <circleGeometry args={[2.6, 64]} /><meshBasicMaterial color="#0d0a08" transparent opacity={.92} />
      </mesh>
      {[.9, 1.5, 2.2].map((r, i) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, TABLE.z * .5]} raycast={noHit}>
          <ringGeometry args={[r, r + .006, 96]} /><meshBasicMaterial color={AMBER} transparent opacity={.22 - i * .06} />
        </mesh>
      ))}
    </group>
  )
}

type Hud = { stop: number; line: string; title: string; playing: boolean; target: string; seg: string }

/** What the guide is saying, on a screen behind the table. */
function Captions({ hud, colour, count }: { hud: Hud; colour: string; count: number }) {
  const W = .95
  return (
    <group position={[0, 1.42, TABLE.z - .5]} rotation={[-.12, 0, 0]}>
      <RoundedBox args={[W, .3, .01]} radius={.02} smoothness={4} raycast={noHit}>
        <meshBasicMaterial color="#0c0a08" transparent opacity={.78} />
      </RoundedBox>
      <mesh position={[0, .15, .006]} raycast={noHit}><planeGeometry args={[W, .004]} /><meshBasicMaterial color={colour} toneMapped={false} /></mesh>
      <Text font={FONT} fontSize={.017} color={AMBER} anchorX="left" anchorY="top" position={[-W / 2 + .04, .125, .008]} letterSpacing={.08}>
        {hud.seg === 'dive' ? 'BEGINNING' : `STOP ${Math.min(hud.stop + 1, count)} OF ${count}${hud.seg === 'travel' ? '  ·  ON THE WAY' : ''}`}
      </Text>
      <Text font={DISPLAY} fontSize={.036} color="#f4e7c6" anchorX="left" anchorY="top" position={[-W / 2 + .04, .1, .008]} maxWidth={W - .08}>{hud.title}</Text>
      <Text font={FONT} fontSize={.0225} lineHeight={1.35} color="#d9ccb0" anchorX="left" anchorY="top" position={[-W / 2 + .04, .048, .008]} maxWidth={W - .08} clipRect={[-W / 2 + .04, -.15, W / 2 - .04, .06]}>
        {hud.line || (hud.seg === 'travel' ? '' : '…')}
      </Text>
      {hud.target && <Text font={FONT} fontSize={.014} color={AMBER} anchorX="right" anchorY="bottom" position={[W / 2 - .04, -.135, .008]}>◎ {hud.target}</Text>}
    </group>
  )
}

/** Buttons you point at and squeeze. They sit at the near edge of the table, tilted up to meet you. */
function Console({ xr, hud, many, dayNo, dayName, mode, zoomAt, colour, onPrev, onNext, onPlay, onMode, onZoom, onTurn, onDay }: {
  xr: typeof store; hud: Hud; many: boolean; dayNo: number; dayName: string; mode: Mode; zoomAt: number; colour: string
  onPrev: () => void; onNext: () => void; onPlay: () => void; onMode: () => void; onZoom: (d: number) => void; onTurn: (d: number) => void; onDay: () => void
}) {
  const table = mode === 'table'
  const row1: [string, () => void, number, boolean?][] = [['◂ Prev', onPrev, .13], [hud.playing ? 'Pause' : 'Play', onPlay, .13, true], ['Next ▸', onNext, .13]]
  const row2: [string, () => void, number, boolean?][] = [
    [table ? 'Step inside' : 'Back to table', onMode, .22],
    ...(table ? [['Zoom +', () => onZoom(1), .12, zoomAt >= ZOOMS.length - 1] as [string, () => void, number, boolean], ['Zoom −', () => onZoom(-1), .12, zoomAt <= 0] as [string, () => void, number, boolean], ['◂ Turn', () => onTurn(-1), .12] as [string, () => void, number], ['Turn ▸', () => onTurn(1), .12] as [string, () => void, number]] : []),
    ...(many ? [[`Day ${dayNo}${dayName ? ' · ' + dayName : ''} ▸`, onDay, .34] as [string, () => void, number]] : []),
    ['Leave VR', () => { void xr.getState().session?.end() }, .16],
  ]
  const layout = (row: typeof row1, y: number) => {
    const gap = .012, total = row.reduce((w, r) => w + r[2], 0) + gap * (row.length - 1)
    let x = -total / 2
    return row.map(([label, fn, w, flag], i) => { const el = <Btn key={label + i} x={x + w / 2} y={y} w={w} label={label} onClick={fn} primary={label === 'Play' || label === 'Pause'} dim={label.startsWith('Zoom') && !!flag} colour={colour} />; x += w + gap; return el })
  }
  return (
    <group position={[0, .76, -.3]} rotation={[-.75, 0, 0]}>
      {layout(row1, .05)}
      {layout(row2, -.02)}
      <Text font={FONT} fontSize={.014} color="#9a8763" anchorX="center" anchorY="middle" position={[0, -.075, 0]}>To leave at any time, hold B or Y</Text>
    </group>
  )
}

function Btn({ x, y, w, label, onClick, primary, dim, colour }: { x: number; y: number; w: number; label: string; onClick: () => void; primary: boolean; dim: boolean; colour: string }) {
  const [hot, setHot] = useState(false)
  const [down, setDown] = useState(false)
  return (
    <group position={[x, y, 0]}>
      <RoundedBox args={[w, .05, .012]} radius={.012} smoothness={4} position={[0, 0, down ? -.004 : 0]}
        onClick={e => { e.stopPropagation(); if (!dim) onClick() }} onPointerOver={() => setHot(true)} onPointerOut={() => { setHot(false); setDown(false) }}
        onPointerDown={() => setDown(true)} onPointerUp={() => setDown(false)}>
        <meshBasicMaterial color={primary ? colour : hot ? '#3a2f22' : '#1a1510'} transparent opacity={dim ? .35 : .94} toneMapped={false} />
      </RoundedBox>
      <Text font={FONT} fontSize={.0175} color={primary ? '#1a1208' : '#f4e7c6'} anchorX="center" anchorY="middle" position={[0, 0, .0075 - (down ? .004 : 0)]} raycast={noHit} fillOpacity={dim ? .5 : 1}>{label}</Text>
    </group>
  )
}
