import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { FlyProps, Plan } from '../types'
import GoogleTiles, { probeTiles, type TilesHandle } from './GoogleTiles'
import { GroundPlacer, type Anchor } from './ground'
import { Path } from './routePath'
import { activeBeat, buildTimeline, type Segment } from './timeline'
import { resample, smootherstep } from './geo'
import FlightHud, { type Control, type Hud } from './FlightHud'
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
const PAN_UP = 90, PAN_DIST = 170, WIDE_UP = 140, WIDE_DIST = 250
const SAMPLE_STEP_M = 30
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
    beatKey: '', audio: null as HTMLAudioElement | null, wasPaused: false,
    inited: false, planAngle: 0, planEye: new THREE.Vector3(), planLook: new THREE.Vector3(),
    look: new THREE.Vector3(), vantage: new Map<string, { scale: number; lift: number; at: number }>(),
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
  function dwellPose(stop: number, beatIndex: number | null, beatTarget: string | undefined, tIn: number, now: number, eye: THREE.Vector3, look: THREE.Vector3) {
    const key = beatTarget ? keyTarget(stop, beatTarget) : keyStop(stop)
    const tg = cell(key, keyStop(stop)).clone()
    look.set(tg.x, tg.y + 12, tg.z)
    const wide = beatIndex === null
    const baseUp = wide ? WIDE_UP : PAN_UP, baseDist = wide ? WIDE_DIST : PAN_DIST
    const offset = [0, 0.7, -0.7, 1.4][(beatIndex ?? 0) % 4]
    const hd = headingIn(stop)
    const ang = Math.atan2(-hd.z, -hd.x) + offset + tIn * 0.04    // behind the way we came, slowly drifting
    const place = (scale: number, lift: number) =>
      eye.set(tg.x + Math.cos(ang) * baseDist * scale, tg.y + baseUp + lift, tg.z + Math.sin(ang) * baseDist * scale)

    const vk = `${stop}:${beatIndex ?? 'wide'}`
    let v = s.current.vantage.get(vk)
    if (!v || now - v.at > 1.5) {
      v = { scale: 1, lift: 0, at: now }
      for (const [sc, lf] of [[1, 0], [1, 40], [1.25, 90], [1.5, 170]] as const) {
        place(sc, lf); v.scale = sc; v.lift = lf
        if (ground.lineOfSight(tiles.current, eye, look)) break
      }
      s.current.vantage.set(vk, v)
    }
    place(v.scale, v.lift)
  }

  function chasePose(seg: Extract<Segment, { kind: 'travel' }>, u: number, eye: THREE.Vector3, look: THREE.Vector3) {
    const { route: r, legPaths: lp, legStart: ls } = routeRef.current
    const path = lp[seg.leg]
    if (!path || !r.length) return false
    const sDist = ls[seg.leg] + smootherstep(u) * path.length     // eased: slows into the stop
    const p = r.at(sDist, tmp.b)
    const hd = r.heading(sDist, 20, CHASE_LOOK, s.current.lastHeading)
    s.current.lastHeading.copy(hd)
    eye.set(p.x - hd.x * CHASE_BACK, p.y + CHASE_UP, p.z - hd.z * CHASE_BACK)
    r.at(sDist + CHASE_LOOK, look); look.y += 4
    return true
  }

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05), st = s.current, ctl = control.current
    const changed = ground.step(tiles.current)
    if (changed) { settled.current += changed; if (!ground.pending || settled.current >= 24) { settled.current = 0; setVersion(v => v + 1) } }

    // ---- clock -----------------------------------------------------------
    if (begin && !st.started) { st.started = true; st.t = 0; st.reached = -1; st.finished = false }
    if (!begin && st.started) { st.started = false; st.t = 0 }          // book reopened: back to the planning hold
    if (ctl.restart) { ctl.restart = false; st.t = 0; st.reached = -1; st.finished = false; st.beatKey = '' }
    if (ctl.skip && st.started) {
      ctl.skip = false
      st.t = tl.dwellStart.find(x => x > st.t + 0.05) ?? tl.total
    }
    if (st.started && !ctl.paused && !st.finished) st.t = Math.min(tl.total, st.t + dt)

    // ---- what is happening -----------------------------------------------
    const { seg, u } = tl.at(st.t)
    const beat = st.started ? activeBeat(seg, st.t) : null
    if (st.started && seg.kind === 'dwell' && seg.stop > st.reached) { st.reached = seg.stop; onStopReached(plan.stops[seg.stop].id, seg.stop) }
    if (st.started && !st.finished && st.t >= tl.total) { st.finished = true; onFinish() }

    // ---- guide audio: one clip per beat, driven by the same clock --------
    const beatKey = beat ? `${(seg as Extract<Segment, { kind: 'dwell' }>).stop}:${beat.index}` : ''
    if (beatKey !== st.beatKey) {
      st.audio?.pause(); st.audio = null; st.beatKey = beatKey
      if (beat?.beat.audioUrl) { st.audio = new Audio(beat.beat.audioUrl); st.audio.play().catch(() => {}) }
    }
    if (st.audio && ctl.paused !== st.wasPaused) { if (ctl.paused) st.audio.pause(); else st.audio.play().catch(() => {}) }
    st.wasPaused = ctl.paused

    // ---- camera ----------------------------------------------------------
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
    if (!st.inited) { camera.position.copy(eye); st.look.copy(look); st.inited = true }
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

  useEffect(() => () => { s.current.audio?.pause() }, [])

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

export default function Flythrough(props: FlyProps) {
  const { plan, origin: preOrigin, begin, onExit } = props
  const origin = plan?.origin ?? preOrigin ?? null
  const [probe, setProbe] = useState<'checking' | 'ok' | { why: string }>('checking')
  const [loadTick, setLoadTick] = useState(0)
  const [hud, setHud] = useState<Hud | null>(null)
  const tiles = useRef<TilesHandle | null>(null)
  const control = useRef<Control>({ paused: false, skip: false, restart: false })
  const onLoadEnd = useCallback(() => setLoadTick(t => t + 1), [])   // stable: the wrapper re-registers on identity change
  const tilesRef = useCallback((t: TilesHandle | null) => { tiles.current = t }, [])

  const check = useCallback(() => {
    setProbe('checking')
    probeTiles().then(r => setProbe(r.ok ? 'ok' : { why: r.why }))
  }, [])
  useEffect(check, [check])

  useEffect(() => { if (!begin) { control.current.paused = false; setHud(null) } }, [begin])

  if (typeof probe === 'object') {
    return (
      <div className="fly fly-error" role="alert">
        <p>{probe.why}</p><button onClick={check}>Retry</button>
      </div>
    )
  }
  return (
    <div className="fly" data-ground="night">
      {origin && probe === 'ok' && (
        <Canvas camera={{ fov: 50, near: 1, far: 20000, position: [0, 900, 700] }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
          <color attach="background" args={['#0a0806']} />
          <ambientLight intensity={1.6} />
          <directionalLight position={[300, 800, 400]} intensity={1.2} color="#ffe6b8" />
          <GoogleTiles lat={origin.lat} lon={origin.lon} onLoadEnd={onLoadEnd} tilesRef={tilesRef} />
          {plan && <Rig {...props} plan={plan} onHud={setHud} control={control} tiles={tiles} loadTick={loadTick} />}
        </Canvas>
      )}
      {probe === 'checking' && <div className="fly-status">Connecting to the map…</div>}
      {begin && hud && <FlightHud hud={hud} control={control} onExit={onExit} />}
    </div>
  )
}
