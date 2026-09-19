import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { FlyProps, Plan } from '../types'
import GoogleTiles, { probeTiles, type TilesHandle } from './GoogleTiles'
import { GroundPlacer, type Anchor } from './ground'
import { Path } from './routePath'
import { frameFor } from './director'
import { Governor, type Shot } from './quality'
import { activeBeat, buildTimeline, type Segment } from './timeline'
import { resample, smootherstep } from './geo'
import { startFlight, tag, log, lastFault } from '../telemetry'
import Fault from '../ui/Fault'
import FlightHud, { type Control, type Hud } from './FlightHud'
import MapRig, { type MapView } from './MapRig'
import './fly.css'

/* The flight. Tiles sit under everything from the first frame (so they load
 * while the book is read); `begin` flips the camera from a slow planning hold
 * into the dive and the tour.
 *
 * Camera language, all eased (the camera chases a target pose through
 * exponential smoothing, so nothing snaps):
 *   chase  ~55 m up, ~110 m behind, looking ~60 m ahead
 *   pan    higher and farther back than the chase (low facade shots look
 *          bad in photogrammetry), checked for line of sight to the target
 *          before it is committed
 */

const CHASE_UP = 55, CHASE_BACK = 110, CHASE_LOOK = 60
const SAMPLE_STEP_M = 30
const PRELOAD_AHEAD_SEC = 30       // tiles for shots this far ahead are fetched at full detail in advance
const PRELOAD_ON = new URLSearchParams(location.search).get('preload') !== '0'
const noHit = () => null

const keyStop = (i: number) => `s${i}`
const keyTarget = (i: number, id: string) => `t${i}:${id}`
const keyLeg = (i: number, j: number) => `l${i}:${j}`

function anchorsFor(plan: Plan): Anchor[] {
  const out: Anchor[] = [{ key: 'origin', ...plan.origin }]
  plan.stops.forEach((s, i) => {
    out.push({ key: keyStop(i), lat: s.lat, lon: s.lon })
    s.targets.forEach(t => out.push({ key: keyTarget(i, t.id), lat: t.lat, lon: t.lon }))
  })
  plan.legs.forEach((leg, i) => resample(leg.polyline, SAMPLE_STEP_M).forEach((p, j) => out.push({ key: keyLeg(i, j), ...p })))
  return out
}

type RigProps = FlyProps & { plan: Plan; onHud: (h: Hud) => void; control: React.MutableRefObject<Control>; tiles: React.MutableRefObject<TilesHandle | null>; loadTick: number }

function Rig({ plan, begin, onStopReached, onFinish, onHud, control, tiles, loadTick }: RigProps) {
  const { camera } = useThree()
  const ground = useMemo(() => new GroundPlacer(), [])
  const [version, setVersion] = useState(0)
  const settled = useRef(0)
  const tl = useMemo(() => buildTimeline(plan), [plan])

  // A flight holds much more than the default tile budget: the cache is what lets the
  // sharp tiles at a stop stay resident while the camera moves on and comes back.
  useEffect(() => {
    const c = tiles.current?.lruCache
    if (c) { c.minSize = 12000; c.maxSize = 20000; c.minBytesSize = .7e9; c.maxBytesSize = 1.0e9 }
  }, [tiles, loadTick])
  const governor = useRef(new Governor())
  useEffect(() => { ground.setAnchors(anchorsFor(plan)) }, [ground, plan])
  useEffect(() => { ground.requeue() }, [ground, loadTick])

  // World-space route, rebuilt as the ground refines under it.
  const { legPaths, route, legStart } = useMemo(() => {
    const at = (key: string) => { const c = ground.get(key); return c ? new THREE.Vector3(c.x, c.y, c.z) : null }
    const legPaths = plan.legs.map((leg, i) => {
      const n = resample(leg.polyline, SAMPLE_STEP_M).length
      const pts: THREE.Vector3[] = []
      for (let j = 0; j < n; j++) { const p = at(keyLeg(i, j)); if (p) pts.push(p) }
      return new Path(pts)
    })
    const legStart: number[] = []
    let acc = 0
    legPaths.forEach((p, i) => { legStart[i] = acc; acc += p.length })
    return { legPaths, route: new Path(legPaths.flatMap(p => p.pts)), legStart }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, ground, version])
  const routeRef = useRef({ route, legPaths, legStart })
  routeRef.current = { route, legPaths, legStart }

  // Playback state lives in refs: it changes every frame, React does not need to know.
  const s = useRef({
    t: 0, started: false, reached: -1, finished: false,
    sweep: 0, beatKey: '', audio: null as HTMLAudioElement | null, wasPaused: false,
    inited: false, planAngle: 0, planEye: new THREE.Vector3(), planLook: new THREE.Vector3(),
    look: new THREE.Vector3(), sizes: new Map<string, { h: number | null; at: number }>(), vantage: new Map<string, { scale: number; lift: number; at: number }>(),
    hud: '', lastHeading: new THREE.Vector3(0, 0, -1), highlightKey: '',
  })
  const hl = useRef<THREE.Group>(null)
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), eye: new THREE.Vector3(), lk: new THREE.Vector3(), dir: new THREE.Vector3() }), [])

  const cell = (key: string, fallback = 'origin') => { const c = ground.get(key) ?? ground.get(fallback); return c ? tmp.a.set(c.x, c.y, c.z) : tmp.a.set(0, 0, 0) }

  function planPose(dt: number, eye: THREE.Vector3, look: THREE.Vector3) {
    const c = new THREE.Vector3(); let n = 0
    plan.stops.forEach((_, i) => { const p = ground.get(keyStop(i)); if (p) { c.add(tmp.b.set(p.x, p.y, p.z)); n++ } })
    if (n) c.divideScalar(n)
    let extent = 300
    plan.stops.forEach((_, i) => { const p = ground.get(keyStop(i)); if (p) extent = Math.max(extent, Math.hypot(p.x - c.x, p.z - c.z)) })
    const H = THREE.MathUtils.clamp(extent * 1.5 + 250, 500, 2500)
    s.current.planAngle += dt * 0.03
    const a = s.current.planAngle
    eye.set(c.x + Math.sin(a) * H * 0.75, c.y + H, c.z + Math.cos(a) * H * 0.75)
    look.copy(c)
  }

  function headingIn(stop: number) {
    const { route: r, legPaths: lp, legStart: ls } = routeRef.current
    if (!lp.length || !r.length) return s.current.lastHeading.clone()
    const leg = Math.max(0, stop - 1)
    const at = stop > 0 ? ls[leg] + lp[leg].length : 0
    return r.heading(at, 25, 25, s.current.lastHeading)
  }

  /** A vantage on `targetKey` that can see it: start at the pan distance and
      climb / back off until the line of sight is clear. Re-checked every 1.5 s
      because the surface refines under us as tiles stream in. */
  function dwellPose(stop: number, beatIndex: number | null, beatTarget: string | undefined, tIn: number, now: number, eye: THREE.Vector3, look: THREE.Vector3, check = true) {
    const key = beatTarget ? keyTarget(stop, beatTarget) : keyStop(stop)
    const tg = cell(key, keyStop(stop)).clone()
    const wide = beatIndex === null
    // The Director: frame what is there. Re-measured now and then, because the
    // surface sharpens as finer tiles arrive under the camera.
    let size = s.current.sizes.get(key)
    if (!size || size.h === null || now - size.at > 4) { size = { h: ground.measure(tiles.current, tg.x, tg.y, tg.z), at: now }; s.current.sizes.set(key, size) }
    const fr = frameFor(size.h, wide)
    const baseUp = fr.up, baseDist = fr.dist
    look.set(tg.x, tg.y + fr.lookUp, tg.z)
    const offset = [0, 0.7, -0.7, 1.4][(beatIndex ?? 0) % 4]
    const hd = headingIn(stop)
    const ang = Math.atan2(-hd.z, -hd.x) + offset + tIn * 0.04    // behind the way we came, slowly drifting
    const place = (scale: number, lift: number) =>
      eye.set(tg.x + Math.cos(ang) * baseDist * scale, tg.y + baseUp + lift, tg.z + Math.sin(ang) * baseDist * scale)

    const vk = `${stop}:${beatIndex ?? 'wide'}`
    let v = s.current.vantage.get(vk)
    if (check && (!v || now - v.at > 1.5)) {
      v = { scale: 1, lift: 0, at: now }
      for (const [sc, lf] of [[1, 0], [1, 40], [1.25, 90], [1.5, 170]] as const) {
        place(sc, lf); v.scale = sc; v.lift = lf
        if (ground.lineOfSight(tiles.current, eye, look)) break
      }
      s.current.vantage.set(vk, v)
    }
    place(v?.scale ?? 1, v?.lift ?? 0)
  }

  function chasePose(seg: Extract<Segment, { kind: 'travel' }>, u: number, eye: THREE.Vector3, look: THREE.Vector3, commit = true) {
    const { route: r, legPaths: lp, legStart: ls } = routeRef.current
    const path = lp[seg.leg]
    if (!path || !r.length) return false
    const sDist = ls[seg.leg] + smootherstep(u) * path.length     // eased: slows into the stop
    const p = r.at(sDist, tmp.b)
    const hd = r.heading(sDist, 20, CHASE_LOOK, s.current.lastHeading)
    if (commit) s.current.lastHeading.copy(hd)
    eye.set(p.x - hd.x * CHASE_BACK, p.y + CHASE_UP, p.z - hd.z * CHASE_BACK)
    r.at(sDist + CHASE_LOOK, look); look.y += 4
    return true
  }

  /* ---- preloading ------------------------------------------------------
     Tiles are chosen for the cameras the renderer knows about. Registering
     invisible cameras at the shots coming up in the next PRELOAD_AHEAD_SEC (or
     the opening ones, while the book is still being read) makes it fetch those
     views at full detail before the flight gets there, and drop them as the
     flight moves past, so memory stays bounded. */
  const size = useThree(st => st.size)
  const mainCam = camera as THREE.PerspectiveCamera
  const pre = useRef({ cams: new Map<number, THREE.PerspectiveCamera>(), shots: [] as { t: number; eye: THREE.Vector3; look: THREE.Vector3 }[], built: -1, swept: -1 })
  const metrics = useRef({ frames: 0, pendingFrames: 0, longFrames: 0, activeSec: 0, worstMs: 0, events: [] as { t: number; label: string; pending: number; settleMs?: number }[], awaiting: null as null | { rec: { settleMs?: number }; at: number }, last: '' })

  function buildShots() {
    const shots: typeof pre.current.shots = []
    const push = (t: number, eye: THREE.Vector3, look: THREE.Vector3) => shots.push({ t, eye: eye.clone(), look: look.clone() })
    const e = new THREE.Vector3(), l = new THREE.Vector3()
    for (const seg of tl.segments) {
      if (seg.kind === 'dwell') {
        dwellPose(seg.stop, null, undefined, 0, 0, e, l, false); push(seg.t0, e, l)
        for (const b of seg.beats) { dwellPose(seg.stop, b.index, b.beat.targetId, b.t0 - seg.t0, 0, e, l, false); push(b.t0, e, l) }
      } else if (seg.kind === 'travel') {
        for (const f of [0.15, 0.35, 0.55, 0.75, 0.95]) if (chasePose(seg, f, e, l, false)) push(seg.t0 + f * (seg.t1 - seg.t0), e, l)
      }
    }
    return shots
  }

  function sweepPreload(now: number) {
    const t = tiles.current, p = pre.current
    if (!t || !PRELOAD_ON) return
    if (p.built !== version) { p.shots = buildShots(); p.built = version }
    const want = new Set<number>()
    p.shots.forEach((sh, i) => { if (sh.t >= now - 1 && sh.t <= now + PRELOAD_AHEAD_SEC) want.add(i) })
    for (const [i, cam] of p.cams) if (!want.has(i)) { t.deleteCamera(cam); p.cams.delete(i) }
    for (const i of want) {
      let cam = p.cams.get(i)
      if (!cam) { cam = new THREE.PerspectiveCamera(mainCam.fov, mainCam.aspect, mainCam.near, mainCam.far); p.cams.set(i, cam); t.setCamera(cam) }
      cam.position.copy(p.shots[i].eye); cam.lookAt(p.shots[i].look); cam.updateMatrixWorld(true)
      t.setResolution(cam, size.width, size.height)
    }
  }

  /* The flight is one transaction. What it carries is what the viewer felt:
     how much of the time tiles were still arriving, how long each shot took to
     resolve, and whether frames dropped. */
  const flight = useRef<ReturnType<typeof startFlight> | null>(null)
  function beginFlight() {
    const m = metrics.current
    m.frames = 0; m.pendingFrames = 0; m.longFrames = 0; m.activeSec = 0; m.worstMs = 0; m.events = []; m.awaiting = null; m.last = ''
    tag('preload', PRELOAD_ON ? 'on' : 'off')
    flight.current = startFlight({ plan: plan.id, stops: plan.stops.length, legs: plan.legs.length, preload: PRELOAD_ON, seconds_planned: Math.round(tl.total) })
    log.info('flight started', { plan: plan.id, preload: PRELOAD_ON })
  }
  function endFlight(outcome: string) {
    if (!flight.current) return
    const m = metrics.current, settled = m.events.filter(e => e.settleMs !== undefined).map(e => e.settleMs as number)
    const t = tiles.current
    const result = {
      outcome,
      'flight.frames': m.frames,
      'flight.fps_avg': m.activeSec > 0 ? Math.round(m.frames / m.activeSec) : 0,
      'flight.long_frames': m.longFrames,                                   // frames over 50 ms
      'flight.worst_frame_ms': Math.round(m.worstMs),
      'flight.tiles_pending_pct': m.frames ? Math.round(100 * m.pendingFrames / m.frames) : 0,
      'flight.tile_settle_ms_avg': settled.length ? Math.round(settled.reduce((a, b) => a + b, 0) / settled.length) : 0,
      'flight.tile_settle_ms_max': settled.length ? Math.max(...settled) : 0,
      'flight.tile_cache_mb': t ? Math.round(t.lruCache.cachedBytes / 1e6) : 0,
      'flight.detail': +governor.current.detail.toFixed(2),
    }
    flight.current.end(result)
    log.info(`flight ${outcome}`, result)
    flight.current = null
  }

  function record(t: TilesHandle | null, label: string, time: number) {
    if (!t) return
    const m = metrics.current, st = t.stats
    const pending = st.queued + st.downloading + st.parsing
    const rec = { t: +time.toFixed(1), label, pending } as { t: number; label: string; pending: number; settleMs?: number }
    m.events.push(rec); m.awaiting = { rec, at: performance.now() }
    if (import.meta.env.DEV) (window as unknown as { __fly: unknown }).__fly = { preload: PRELOAD_ON, ...m, cacheMB: Math.round(t.lruCache.cachedBytes / 1e6), errorTarget: t.errorTarget, detail: governor.current.detail, dpr: window.devicePixelRatio }
  }

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05), st = s.current, ctl = control.current
    const changed = ground.step(tiles.current)
    if (changed) { settled.current += changed; if (!ground.pending || settled.current >= 24) { settled.current = 0; setVersion(v => v + 1) } }

    // ---- clock -----------------------------------------------------------
    if (begin && !st.started) { st.started = true; st.t = 0; st.reached = -1; st.finished = false; beginFlight() }
    if (!begin && st.started) { st.started = false; st.t = 0; endFlight('exited') }          // book reopened: back to the planning hold
    if (ctl.restart) { ctl.restart = false; endFlight('restarted'); st.t = 0; st.reached = -1; st.finished = false; st.beatKey = ''; beginFlight() }
    if (ctl.skip && st.started) {
      ctl.skip = false
      st.t = tl.dwellStart.find(x => x > st.t + 0.05) ?? tl.total
    }
    if (st.started && !ctl.paused && !st.finished) st.t = Math.min(tl.total, st.t + dt)

    // ---- what is happening -----------------------------------------------
    const { seg, u } = tl.at(st.t)
    const beat = st.started ? activeBeat(seg, st.t) : null
    if (st.started && seg.kind === 'dwell' && seg.stop > st.reached) { st.reached = seg.stop; onStopReached(plan.stops[seg.stop].id, seg.stop) }
    if (st.started && !st.finished && st.t >= tl.total) { st.finished = true; endFlight('finished'); onFinish() }

    // ---- tile preloading + metrics (dev) ---------------------------------
    st.sweep = (st.sweep ?? 0) + dt
    if (st.sweep > 0.4) { st.sweep = 0; sweepPreload(st.started ? st.t : 0) }
    if (tiles.current) {
      const m = metrics.current, ts = tiles.current.stats
      const pending = ts.queued + ts.downloading + ts.parsing
      if (st.started && !st.finished && !ctl.paused) {
        m.frames++; m.activeSec += rawDt; if (pending > 0) m.pendingFrames++
        if (rawDt > 0.05) m.longFrames++
        m.worstMs = Math.max(m.worstMs, rawDt * 1000)
      }
      const tag = st.started ? `${seg.kind}${seg.kind === 'dwell' ? seg.stop : seg.kind === 'travel' ? seg.leg : ''}${beat ? ':b' + beat.index : ''}` : 'idle'
      if (st.started && tag !== m.last) { m.last = tag; record(tiles.current, tag, st.t) }
      if (m.awaiting && pending === 0) { m.awaiting.rec.settleMs = Math.round(performance.now() - m.awaiting.at); m.awaiting = null }
    }

    // ---- guide audio: one clip per beat, driven by the same clock --------
    const beatKey = beat ? `${(seg as Extract<Segment, { kind: 'dwell' }>).stop}:${beat.index}` : ''
    if (beatKey !== st.beatKey) {
      st.audio?.pause(); st.audio = null; st.beatKey = beatKey
      if (beat?.beat.audioUrl) { st.audio = new Audio(beat.beat.audioUrl); st.audio.play().catch(() => {}) }
    }
    if (st.audio && ctl.paused !== st.wasPaused) { if (ctl.paused) st.audio.pause(); else st.audio.play().catch(() => {}) }
    st.wasPaused = ctl.paused

    // ---- camera ----------------------------------------------------------
    if (tiles.current) {
      const shot: Shot = !st.started ? 'map' : seg.kind
      tiles.current.errorTarget = governor.current.step(rawDt, shot)
    }
    const eye = tmp.eye, look = tmp.lk
    let smooth = 2
    if (!st.started) {
      planPose(dt, eye, look); st.planEye.copy(eye); st.planLook.copy(look)
    } else if (seg.kind === 'dive') {
      dwellPose(0, null, undefined, 0, st.t, eye, look)
      const e = smootherstep(u)
      eye.lerpVectors(st.planEye, eye, e); look.lerpVectors(st.planLook, look, e); smooth = 6
    } else if (seg.kind === 'dwell') {
      dwellPose(seg.stop, beat?.index ?? null, beat?.beat.targetId, st.t - seg.t0, st.t, eye, look)
    } else if (!chasePose(seg, u, eye, look)) {
      dwellPose(seg.leg, null, undefined, 0, st.t, eye, look)
    }
    if (!st.inited) {
      // The flight starts from wherever the map left the camera, and glides from there.
      st.look.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 600)
      st.inited = true
    }
    const k = 1 - Math.exp(-dt * smooth)
    camera.position.lerp(eye, k); st.look.lerp(look, k)
    camera.lookAt(st.look)

    // ---- highlight follows the active beat's target ----------------------
    const dwellStop = seg.kind === 'dwell' ? seg.stop : -1
    const hlKey = beat?.beat.targetId ? keyTarget(dwellStop, beat.beat.targetId) : ''
    st.highlightKey = hlKey
    if (hl.current) {
      const c = hlKey ? ground.get(hlKey) : undefined
      hl.current.visible = !!c
      if (c) {
        hl.current.position.set(c.x, c.y, c.z)
        const pulse = 1 + 0.12 * Math.sin(performance.now() / 260)
        hl.current.scale.setScalar(pulse)
      }
    }

    // ---- HUD (only when something the user can see changed) --------------
    const stopIdx = seg.kind === 'dwell' ? seg.stop : seg.kind === 'travel' ? seg.leg + 1 : 0
    const target = beat?.beat.targetId ? plan.stops[dwellStop].targets.find(x => x.id === beat.beat.targetId) : undefined
    const hud: Hud = {
      phase: !st.started ? 'idle' : st.finished ? 'done' : seg.kind,
      stopIndex: stopIdx, stopCount: plan.stops.length, stopName: plan.stops[Math.min(stopIdx, plan.stops.length - 1)]?.name ?? '',
      caption: beat?.beat.text ?? '', targetName: target?.name ?? '', targetSource: target?.source.url ?? '',
      paused: ctl.paused, progress: st.started ? st.t / tl.total : 0,
    }
    const sig = JSON.stringify([hud.phase, hud.stopIndex, hud.caption, hud.paused, Math.round(hud.progress * 200)])
    if (sig !== st.hud) { st.hud = sig; onHud(hud) }
  })

  useEffect(() => () => {
    s.current.audio?.pause()
    endFlight('left')
    const t = tiles.current
    pre.current.cams.forEach(c => t?.deleteCamera(c)); pre.current.cams.clear()
  }, [])

  const curLeg = Math.max(0, Math.min(plan.legs.length - 1, hudLeg(s.current.hud)))
  return (
    <>
      {legPaths.map((p, i) => p.pts.length > 1 && (
        <Line key={i} points={p.pts.map(v => [v.x, v.y + 2, v.z] as [number, number, number])}
          color="#f0b45e" lineWidth={i < curLeg ? 2 : 4} transparent opacity={i < curLeg ? 0.35 : 0.95} raycast={noHit} />
      ))}
      {plan.stops.map((stop, i) => {
        const c = ground.get(keyStop(i)); if (!c) return null
        return (
          <Html key={stop.id} position={[c.x, c.y + 30, c.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
            <div className="fly-pin"><b>{i + 1}</b><span>{stop.name}</span></div>
          </Html>
        )
      })}
      <group ref={hl} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.5, 0]} raycast={noHit}>
          <ringGeometry args={[14, 18, 48]} /><meshBasicMaterial color="#f0b45e" transparent opacity={0.9} depthTest={false} />
        </mesh>
        <Line points={[[0, 0, 0], [0, 70, 0]]} color="#f0b45e" lineWidth={2} transparent opacity={0.8} raycast={noHit} />
      </group>
    </>
  )
}

const hudLeg = (sig: string) => { try { return Math.max(0, (JSON.parse(sig)[1] ?? 1) - 1) } catch { return 0 } }

const NO_VIEW: MapView = { pins: [], routes: [] }

export default function Flythrough(props: FlyProps & { map?: MapView }) {
  const { plan, origin: preOrigin, begin, onExit, map = NO_VIEW } = props
  const origin = plan?.origin ?? preOrigin ?? null
  const [probe, setProbe] = useState<'checking' | 'ok' | { why: string }>('checking')
  const [loadTick, setLoadTick] = useState(0)
  const [hud, setHud] = useState<Hud | null>(null)
  const tiles = useRef<TilesHandle | null>(null)
  const control = useRef<Control>({ paused: false, skip: false, restart: false })
  // A new city is a new tileset, which takes seconds to arrive. Rather than a bare
  // black gap the world dissolves out and, once real tiles are on screen, back in.
  const [revealed, setRevealed] = useState(false)
  const cityKey = origin ? `${origin.lat.toFixed(2)},${origin.lon.toFixed(2)}` : ''
  useEffect(() => { setRevealed(false) }, [cityKey])
  useEffect(() => {
    if (revealed) return
    const id = setInterval(() => { if ((tiles.current?.stats.visible ?? 0) > 8) setRevealed(true) }, 350)
    return () => clearInterval(id)
  }, [revealed, cityKey])
  const onLoadEnd = useCallback(() => {                                   // stable: the wrapper re-registers on identity change
    setLoadTick(t => t + 1)
    if ((tiles.current?.stats.visible ?? 0) > 8) setRevealed(true)
  }, [])
  const tilesRef = useCallback((t: TilesHandle | null) => { tiles.current = t }, [])

  const check = useCallback(() => {
    setProbe('checking')
    probeTiles().then(r => setProbe(r.ok ? 'ok' : { why: r.why }))
  }, [])
  useEffect(check, [check])

  useEffect(() => { if (!begin) { control.current.paused = false; setHud(null) } }, [begin])

  if (typeof probe === 'object') {
    const f = lastFault()
    return (
      <div className="fly fly-error" role="alert">
        <Fault message={probe.why} eventId={f?.where === 'tiles.probe' ? f.eventId : undefined} where="tiles.probe" onRetry={check} retryLabel="Retry" />
      </div>
    )
  }
  return (
    <div className={`fly ${revealed ? 'is-revealed' : ''}`} data-ground="night">
      {origin && probe === 'ok' && (
        <Canvas dpr={plan ? [1, 2] : [1, 1.5]} camera={{ fov: 50, near: 1, far: 20000, position: [0, 900, 700] }} gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping, preserveDrawingBuffer: true }}>
          <color attach="background" args={['#0a0806']} />
          <ambientLight intensity={1.6} />
          <directionalLight position={[300, 800, 400]} intensity={1.2} color="#ffe6b8" />
          <GoogleTiles lat={origin.lat} lon={origin.lon} onLoadEnd={onLoadEnd} tilesRef={tilesRef} />
          {plan
            ? <Rig key={cityKey} {...props} plan={plan} onHud={setHud} control={control} tiles={tiles} loadTick={loadTick} />
            : <MapRig key={cityKey} view={map} origin={origin} tiles={tiles} loadTick={loadTick} />}
        </Canvas>
      )}
      {probe === 'checking' && <div className="fly-status">Connecting to the map…</div>}
      {begin && hud && <FlightHud hud={hud} control={control} onExit={onExit} />}
    </div>
  )
}
