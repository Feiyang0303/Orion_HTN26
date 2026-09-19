import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Billboard, RoundedBox, Text } from '@react-three/drei'
import { XROrigin, useXR } from '@react-three/xr'
import * as THREE from 'three'
import type { Day } from '../types'
import GoogleTiles, { type TilesHandle } from '../fly/GoogleTiles'
import { GroundPlacer } from '../fly/ground'
import type { Path } from '../fly/routePath'
import { anchorsFor, keyStop, keyTarget } from '../fly/anchors'
import { activeBeat, buildTimeline, type Segment, type Timeline } from '../fly/timeline'
import { legStyle } from '../fly/legStyle'
import { Preloader, Shots, routeOn, type Shot } from '../fly/shots'
import type { Transport } from '../types'
import { dayColour } from '../ui/palette'
import { store } from './store'
import { CRUISE, Follower, angleTo, ride, rideSec, type Ride } from './comfort'
import Veil, { type VeilState } from './Veil'

/* The trip, in a headset: the flat flythrough with the person inside it. The real city at
 * its real size all around, the guide flying them down each leg and stopping them at each
 * place.
 *
 * The shots are the flat flight's own (src/fly/shots.ts). A headset's camera cannot be
 * written to, because it is the person's head, so what is moved is their whole space
 * (the XROrigin): it is carried to where the shot's camera would be and turned to face
 * what the shot looks at, and the looking itself is left to them. Only position and yaw
 * are ever applied. Moving a person this way makes many of them ill, so everything about
 * it is gentle (comfort.ts): a capped speed, eased starts and stops, a vignette that
 * closes in while moving, and a blink instead of any move that is not straight down a
 * street: between a leg and a stop, from one thing to look at to the next, across the
 * middle of a long leg. "Ride: blinks" blinks the legs as well, so that nothing moves at all.
 *
 * What is drawn on the city (pins, the route, the beam) is sized in `UNIT`s, large enough
 * to read from a shot's distance; the guide is just ahead of the person, so it has its own.
 */

const UNIT = 900
const GUIDE_UNIT = 250
const HEAD = 1.6                                     // where a head is taken to be above the floor of the person's space
const PRELOAD_AHEAD_SEC = 12, PRELOAD_MOST = 2
const FOVEA_FOV = 70, FOVEA_PX = 1300                // 930 px per unit of tan (a Quest's lenses), across 2·tan(35°)
const SETTLED_AT = 60, SETTLE_MAX_SEC = 8             // a stop is in focus when the loader is waiting on fewer tiles than this; and it is waited for no longer than this
const STATS = new URLSearchParams(location.search).has('stats')      // /vr?stats: what the tile loader is doing, on the panel
const FONT = 'https://cdn.jsdelivr.net/fontsource/fonts/dm-sans@latest/latin-500-normal.woff'
const DISPLAY = 'https://cdn.jsdelivr.net/fontsource/fonts/im-fell-english@latest/latin-400-normal.woff'
const AMBER = '#f0b45e'
const noHit = () => null

export default function Scene({ days, store: xr, onReady }: { days: Day[]; store: typeof store; onReady: (ready: boolean) => void }) {
  const gl = useThree(s => s.gl)
  const controls = useThree(s => s.controls) as { target: THREE.Vector3; update: () => void } | null
  const inXR = useXR(s => s.session != null)
  const [dayAt, setDayAt] = useState(0)
  const [smooth, setSmooth] = useState(true)
  const day = days[Math.min(dayAt, days.length - 1)]
  const tl = useMemo(() => buildTimeline(day, rideSec), [day])     // a leg takes longer when a person is on it
  const tiles = useRef<TilesHandle | null>(null)
  const ground = useMemo(() => new GroundPlacer(), [])
  const [version, setVersion] = useState(0)
  const [loadTick, setLoadTick] = useState(0)
  const onLoadEnd = useCallback(() => setLoadTick(t => t + 1), [])
  const tilesRef = useCallback((t: TilesHandle | null) => { tiles.current = t }, [])

  useEffect(() => { ground.setAnchors(anchorsFor(day)) }, [ground, day])
  useEffect(() => { ground.requeue() }, [ground, loadTick])

  // A headset has a fraction of a laptop's memory, so less than the flat flight's tile budget: but enough
  // that the loader is not refused the fine tiles around a stop.
  useEffect(() => {
    const t = tiles.current
    if (!t) return
    t.lruCache.minSize = 4000; t.lruCache.maxSize = 8000; t.lruCache.minBytesSize = .6e9; t.lruCache.maxBytesSize = .85e9
  }, [loadTick])

  // What the tile loader is told to make sharp. It chooses tiles for the cameras it knows, and draws
  // nothing that none of them can see. A headset's eyes are not reliably among them, so it is given
  // its own, at the person's head. It refines a tile until its error is under `errorTarget` pixels on
  // the camera it is looking through, and every tile it wants from any camera waits in one queue, which
  // a headset drains slowly: ask for the whole view at the lenses' sharpness and nothing ever arrives
  // sharp. So the sharpness is spent where they are looking: `fovea` has the headset's own pixels and
  // covers what the shot is of; `eye` is the rest of the view ahead, four times coarser; and two
  // coarser still cover the circle behind, so there is a city there if they turn round.
  const fovea = useMemo(() => new THREE.PerspectiveCamera(FOVEA_FOV, 1, .3, 20000), [])
  const eye = useMemo(() => new THREE.PerspectiveCamera(120, 1, .3, 20000), [])
  const behind = useMemo(() => [1, -1].map(() => new THREE.PerspectiveCamera(120, 1, .3, 20000)), [])
  useEffect(() => {
    const t = tiles.current
    if (!t) return
    t.setCamera(fovea); t.setResolution(fovea, FOVEA_PX, FOVEA_PX)
    t.setCamera(eye); t.setResolution(eye, 800, 800)
    behind.forEach(c => { t.setCamera(c); t.setResolution(c, 300, 300) })
    return () => { [fovea, eye, ...behind].forEach(c => t.deleteCamera(c)) }
  }, [fovea, eye, behind, loadTick])

  /* ---- where things are on the real ground ---- */
  const shots = useMemo(() => new Shots(ground, tiles), [ground])
  const geo = useMemo(() => {
    const at = (key: string) => { const c = ground.get(key); return c ? new THREE.Vector3(c.x, c.y, c.z) : null }
    const stops = day.stops.map((_, i) => at(keyStop(i)))
    const route = shots.route = routeOn(day, ground)
    const targets = new Map<string, THREE.Vector3>()
    day.stops.forEach((s, i) => s.targets.forEach(t => { const p = at(keyTarget(i, t.id)); if (p) targets.set(`${i}:${t.id}`, p) }))
    const trails = route.legPaths.map((_, i) => shots.trail(i))
    return { stops, legs: route.legPaths, trails, rides: trails.map(ride), ready: stops.every(Boolean), targets }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, ground, shots, version])
  const geoRef = useRef(geo); geoRef.current = geo
  useEffect(() => { onReady(geo.ready) }, [geo.ready, onReady])

  /* ---- the clock ---- */
  const play = useRef({ t: 0, playing: true, audio: null as HTMLAudioElement | null, beatKey: '', cur: '', settling: 0 as number | false })   // settling: seconds spent waiting at this stop, or false once it has stopped waiting
  const [stats, setStats] = useState('')
  const [hud, setHud] = useState({ stop: 0, line: '', title: '', playing: true, target: '', seg: 'dive' as string })

  const jump = useCallback((stop: number) => {
    const p = play.current
    p.t = tl.dwellStart[Math.max(0, Math.min(day.stops.length - 1, stop))] ?? 0
    p.beatKey = ''; p.audio?.pause(); p.playing = true
  }, [tl, day])
  // A new day starts from its beginning.
  useEffect(() => { jump(0) }, [jump])

  /* ---- the blink: anything that is not a gentle ride down a street happens behind it ---- */
  const veil = useRef<VeilState>({ fade: 1, vignette: 0 })
  const fade = useRef({ v: 1, goal: 0, then: null as (() => void) | null })

  /* ---- where the person's space is, and the tiles fetched ahead of it ---- */
  const origin = useRef<THREE.Group>(null)
  const fl = useRef({ follower: new Follower(), key: '', shot: '', yaw: 0, was: new THREE.Vector3(), drift: new THREE.Vector3(), placed: false, cutting: false, eye: new THREE.Vector3(), look: new THREE.Vector3(), head: new THREE.Vector3(), flatYaw: 0, flatCut: true })
  const pre = useRef({ loader: new Preloader(), shots: [] as Shot[], built: -1, sweep: 0 })
  useEffect(() => { fl.current.placed = false }, [day])
  useEffect(() => () => pre.current.loader.clear(tiles.current), [])
  useEffect(() => { pre.current.built = -1 }, [tl])

  const held = useRef({ leave: 0, pause: false })
  const orb = useRef<THREE.Group>(null)
  const beam = useRef<THREE.Group>(null)
  const pinPulse = useRef<(THREE.Group | null)[]>([])
  const tmp = useMemo(() => new THREE.Vector3(), [])

  const togglePlay = () => {
    const p = play.current
    if (p.t >= tl.total) jump(0); else { p.playing = !p.playing; setHud(h => ({ ...h, playing: p.playing })); p.cur = '' }
  }

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, .05), p = play.current, g = geoRef.current, o = origin.current
    const step = ground.step(tiles.current)
    if (step) setVersion(v => v + 1)

    /* the buttons that need no aiming: A or X pauses the guide, holding B or Y leaves */
    if (inXR) {
      const pads = [...(gl.xr.getSession()?.inputSources ?? [])].map(src => src.gamepad?.buttons)
      const pause = pads.some(b => b?.[4]?.pressed)
      if (pause && !held.current.pause) togglePlay()
      held.current.pause = pause
      held.current.leave = pads.some(b => b?.[5]?.pressed) ? held.current.leave + dt : 0
      if (held.current.leave > .8) { held.current.leave = 0; void gl.xr.getSession()?.end() }
    }

    /* the guide's clock */
    // The timeline gives a leg the time a straight street would take. A real one has bends to slow for, so while
    // it is being ridden the clock runs slow by just enough for the ride to fit.
    const on = tl.at(p.t).seg
    const R = on.kind === 'travel' && g.rides[on.leg]?.T ? g.rides[on.leg] : null
    // The guide waits for the city: for there to be one at all, and then, on arriving at a stop, for the place to come
    // into focus before it starts talking about it (a headset takes its time over that), though never for long.
    const ts = tiles.current?.stats
    const arriving = on.kind === 'dwell' && p.t - on.t0 < 1
    if (!arriving) p.settling = 0
    else if (p.settling !== false && ts) p.settling = (p.settling < .5 || ts.queued + ts.downloading + ts.parsing > SETTLED_AT) && p.settling < SETTLE_MAX_SEC ? p.settling + dt : false
    if (p.playing && g.ready && ts && ts.visible > 8 && !(arriving && p.settling !== false)) p.t = Math.min(tl.total, p.t + dt * (R ? (on.t1 - on.t0) / R.T : 1))
    if (p.t >= tl.total && p.playing) { p.playing = false; p.audio?.pause() }
    let { seg, u } = tl.at(p.t)
    if (!smooth && seg.kind === 'travel') { p.t = seg.t1; ({ seg, u } = tl.at(p.t)) }     // "Ride: blinks": a leg is not ridden at all
    const beat = activeBeat(seg, p.t)
    if (tiles.current) tiles.current.errorTarget = seg.kind === 'travel' ? 16 : 8      // in the fovea's (the headset's own) pixels

    /* the blink */
    const f = fade.current
    f.v += (f.goal - f.v) * (1 - Math.exp(-dt * 16))
    if (f.goal === 1 && f.v > .97 && f.then) { const fn = f.then; f.then = null; fn(); f.goal = 0 }
    veil.current.fade = f.v

    const F = fl.current
    let guideAt = -1
    if (o && g.ready) {
      /* the rig: the shot the flat flight would be taking now, and which shot that is. A new one is a blink away. */
      let key: string
      const trail = seg.kind === 'travel' ? g.trails[seg.leg] : undefined
      if (seg.kind === 'travel' && trail && R) {
        const r = R.at(u * R.T)
        guideAt = shots.carry(seg.leg, trail, r.s, F.eye, F.look)
        key = `leg${seg.leg}:${r.part}`
      } else {
        const v = viewAt(tl, seg, p.t)
        shots.dwell(v.stop, v.first, v.target, 0, p.t, F.eye, F.look)        // held still: no drift round the target with a person aboard
        key = `stop${v.stop}:${v.target ?? ''}`
      }
      if (Math.hypot(F.look.x - F.eye.x, F.look.z - F.eye.z) > 40) F.yaw = Math.atan2(-(F.look.x - F.eye.x), -(F.look.z - F.eye.z))   // too close to what lies ahead, its bearing is noise
      // How the shot itself is moving, so that a blink in the middle of a leg sets the person down already under way.
      if (seg.kind === 'travel' && key === F.shot && dt > 0) F.drift.copy(F.eye).sub(F.was).divideScalar(dt).clampLength(0, CRUISE); else F.drift.set(0, 0, 0)
      F.shot = key; F.was.copy(F.eye)
      const far = F.follower.pos.distanceTo(F.eye)
      if (!F.placed) { f.v = 1; f.goal = 1; F.cutting = true }               // a new day arrives in the dark
      else if (!F.cutting && (key !== F.key || far > (seg.kind === 'travel' ? 300 : 15) || Math.abs(angleTo(F.follower.yaw, F.yaw)) > 1.6)) { F.cutting = true; f.goal = 1 }
      if (F.cutting && f.v > .97) { F.follower.snap(F.eye, F.yaw, F.drift); F.key = key; F.placed = true; F.cutting = false; F.flatCut = true; if (!f.then) f.goal = 0 }
      else if (F.cutting) F.follower.coast(dt)
      else F.follower.follow(F.eye, F.yaw, dt)
      o.rotation.y = F.follower.yaw
      o.position.copy(F.follower.pos); o.position.y -= HEAD
      o.updateMatrixWorld(true)
      veil.current.vignette = F.follower.motion
      if (import.meta.env.DEV) (window as unknown as { __vr: unknown }).__vr = { t: p.t, key: F.key, seg: seg.kind, speed: F.follower.vel.length(), shotSpeed: F.drift.length(), err: far, turn: F.follower.turn, pos: F.follower.pos.toArray(), yaw: F.follower.yaw, motion: F.follower.motion, fade: f.v, tiles: tiles.current?.stats }

      /* the eyes the tile loader looks through, at the person's head */
      o.localToWorld(F.head.set(0, HEAD, 0))
      for (const c of [fovea, eye]) { c.position.copy(F.head); c.lookAt(F.look); c.updateMatrixWorld(true) }
      behind.forEach((c, i) => { c.position.copy(F.head); c.rotation.set(0, F.follower.yaw + (i ? -1 : 1) * Math.PI * 2 / 3, 0); c.updateMatrixWorld(true) })

      /* the shots coming up, fetched before the person gets to them */
      const P = pre.current
      P.sweep += dt
      if (tiles.current && P.sweep > .5) {
        P.sweep = 0
        if (STATS) { const st = tiles.current.stats; setStats(`waiting ${st.queued + st.downloading + st.parsing}  ·  shown ${st.visible}  ·  held ${Math.round(tiles.current.lruCache.cachedBytes / 1e6)} MB  ·  ${Math.round(1 / Math.max(rawDt, .001))} fps`) }
        if (P.built !== version) { P.shots = comingShots(tl, shots, g.trails, g.rides); P.built = version }
        P.loader.sweep(tiles.current, P.shots, p.t, PRELOAD_AHEAD_SEC, () => new THREE.PerspectiveCamera(FOVEA_FOV, 1, .3, 20000), 700, 700, PRELOAD_MOST)
      }

      /* on a screen, the flight is seen from where the head would be; dragging looks around */
      if (!inXR && controls && F.placed) {
        if (F.flatCut) {
          F.flatCut = false
          camera.position.copy(F.head).addScaledVector(tmp.copy(F.look).sub(F.head).normalize(), -.05)
        } else {
          camera.position.sub(controls.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, F.follower.yaw - F.flatYaw).add(F.head)
        }
        F.flatYaw = F.follower.yaw
        controls.target.copy(F.head); controls.update()
      }
    }

    /* the guide: the light you follow down a leg */
    if (orb.current) {
      orb.current.visible = guideAt >= 0
      if (seg.kind === 'travel' && guideAt >= 0) {
        g.legs[seg.leg].at(guideAt, tmp)
        orb.current.position.set(tmp.x, tmp.y + .03 * GUIDE_UNIT + Math.sin(p.t * 2.2) * .003 * GUIDE_UNIT, tmp.z)
      }
    }
    // A beam on whatever it is talking about.
    const tgt = beat?.beat.targetId && seg.kind === 'dwell' ? g.targets.get(`${seg.stop}:${beat.beat.targetId}`) : seg.kind === 'dwell' && beat ? g.stops[seg.stop] : null
    if (beam.current) { beam.current.visible = !!tgt; if (tgt) beam.current.position.copy(tgt) }
    pinPulse.current.forEach((pg, i) => { if (pg) pg.scale.setScalar(1 + (seg.kind === 'dwell' && seg.stop === i ? .18 + Math.sin(p.t * 4) * .08 : 0)) })

    /* narration: one clip per beat, started where the clock says it should be */
    const key = beat ? `${seg.t0}:${beat.index}` : ''
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
    }
  })
  useEffect(() => () => { play.current.audio?.pause() }, [])

  const c = dayColour(day.number - 1)
  const many = days.length > 1

  return (
    <>
      <color attach="background" args={['#07060a']} />
      <ambientLight intensity={1.7} />
      <directionalLight position={[300, 800, 400]} intensity={1.3} color="#ffe6b8" />
      <GoogleTiles lat={day.origin.lat} lon={day.origin.lon} onLoadEnd={onLoadEnd} tilesRef={tilesRef} />

      {/* what is drawn on the city */}
      {geo.legs.map((p, i) => p.pts.length > 1 && <Route key={`${day.number}:${i}`} path={p} colour={c} played={hud.stop > i} transport={day.legs[i].transport} estimated={day.legs[i].estimated} />)}
      {day.stops.map((stop, i) => {
        const pos = geo.stops[i]; if (!pos) return null
        return <Pin key={stop.id} refFn={g => { pinPulse.current[i] = g }} pos={pos} n={i + 1} name={stop.name} colour={c} active={hud.stop === i} onPick={() => { jump(i) }} />
      })}
      <Guide orb={orb} beam={beam} colour={c} />

      {/* the person's own space, carried through the city */}
      <XROrigin ref={origin}>
        <Deck />
        <Console
          xr={xr} hud={hud} stats={stats} many={many} dayNo={day.number} dayName={many ? day.title : ''} smooth={smooth} colour={c}
          onPrev={() => jump(hud.stop - 1)} onNext={() => jump(hud.stop + 1)} onPlay={togglePlay}
          onSmooth={() => setSmooth(s => !s)}
          onDay={() => { fade.current.goal = 1; fade.current.then = () => setDayAt(d => (d + 1) % days.length) }} />
        <Captions hud={hud} colour={c} count={day.stops.length} />
      </XROrigin>
      <Veil state={veil} />
    </>
  )
}

/** What a stop is being looked at from, at time `t`: the shot of whatever the guide is talking about,
    or is about to. A person is not swung round a place between sentences the way a camera is, so
    they are moved only when the guide turns to a different thing, and then to the first shot of it. */
function viewAt(tl: Timeline, seg: Segment, t: number) {
  const dwell = seg.kind === 'dwell' ? seg : tl.segments.find((s): s is Extract<Segment, { kind: 'dwell' }> => s.kind === 'dwell' && s.stop === (seg.kind === 'travel' ? seg.leg : 0))
  const slot = dwell?.beats.find(b => t < b.t1) ?? dwell?.beats[dwell.beats.length - 1]
  if (!dwell || !slot) return { stop: dwell?.stop ?? 0, first: null, target: undefined }
  return { stop: dwell.stop, first: dwell.beats.find(b => b.beat.targetId === slot.beat.targetId)!.index, target: slot.beat.targetId }
}

/** Every shot of the day and when it comes, for the tile loader to get ahead of. */
function comingShots(tl: Timeline, shots: Shots, trails: Path[], rides: Ride[]): Shot[] {
  const out: Shot[] = [], e = new THREE.Vector3(), l = new THREE.Vector3()
  const push = (t: number) => out.push({ t, eye: e.clone(), look: l.clone() })
  for (const seg of tl.segments) {
    if (seg.kind === 'dwell') {
      const seen = new Set<string>()
      for (const b of seg.beats) {
        const v = viewAt(tl, seg, b.t0), k = v.target ?? ''
        if (seen.has(k)) continue
        shots.dwell(v.stop, v.first, v.target, 0, 0, e, l, false); push(seen.size ? b.t0 : seg.t0); seen.add(k)
      }
      if (!seg.beats.length) { shots.dwell(seg.stop, null, undefined, 0, 0, e, l, false); push(seg.t0) }
    } else if (seg.kind === 'travel') {
      const trail = trails[seg.leg], R = rides[seg.leg]
      if (!R?.T) continue
      for (const f of [.1, .3, .5, .7, .9]) { shots.carry(seg.leg, trail, R.at(f * R.T).s, e, l); push(seg.t0 + f * (seg.t1 - seg.t0)) }
    }
  }
  return out
}

/* ------------------------------------------------------------ the world -- */

/** Each way of travelling is a different object on the city: footsteps are beads, a bicycle's
    line is longer beads, and a bus or a car is a ribbon with a glow around it. */
function Route({ path, colour, played, transport, estimated }: { path: Path; colour: string; played: boolean; transport: Transport; estimated?: boolean }) {
  const st = legStyle(transport, estimated)
  const opacity = played ? .4 : st.opacity
  const tube = useMemo(() => {
    if (st.beads) return null
    const curve = new THREE.CatmullRomCurve3(path.pts.map(p => new THREE.Vector3(p.x, p.y + .0015 * UNIT + 2, p.z)), false, 'centripetal')
    const n = Math.min(600, path.pts.length * 3)
    return { main: new THREE.TubeGeometry(curve, n, st.tube * UNIT, 6, false), glow: st.glow ? new THREE.TubeGeometry(curve, n, st.tube * 2.6 * UNIT, 6, false) : null }
  }, [path, st.beads, st.tube, st.glow])
  useEffect(() => () => { tube?.main.dispose(); tube?.glow?.dispose() }, [tube])
  const beads = useMemo(() => {
    if (!st.beads) return []
    const gap = st.beads * UNIT, out: THREE.Vector3[] = []
    for (let s = 0; s <= path.length; s += gap) out.push(path.at(s).clone().add(new THREE.Vector3(0, .0015 * UNIT + 2, 0)))
    return out
  }, [path, st.beads])
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
          <sphereGeometry args={[st.tube * 1.35 * UNIT, 10, 8]} /><meshBasicMaterial color={colour} transparent opacity={opacity} toneMapped={false} />
        </instancedMesh>
      )}
    </>
  )
}

function Pin({ pos, n, name, colour, active, onPick, refFn }: {
  pos: THREE.Vector3; n: number; name: string; colour: string; active: boolean; onPick: () => void; refFn: (g: THREE.Group | null) => void
}) {
  const [hover, setHover] = useState(false)
  const H = .034 * UNIT
  return (
    <group position={pos} ref={refFn}>
      <mesh position={[0, H / 2, 0]} raycast={noHit}><cylinderGeometry args={[.0007 * UNIT, .0007 * UNIT, H, 8]} /><meshBasicMaterial color={colour} toneMapped={false} /></mesh>
      <mesh position={[0, H + .008 * UNIT, 0]} onClick={e => { e.stopPropagation(); onPick() }} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
        <sphereGeometry args={[.0085 * UNIT * (hover ? 1.2 : 1), 24, 16]} />
        <meshBasicMaterial color={active ? '#fff3d6' : colour} toneMapped={false} />
      </mesh>
      <Billboard position={[0, H + .008 * UNIT, 0]}>
        <Text font={FONT} fontSize={.0105 * UNIT} color="#1a1208" anchorX="center" anchorY="middle" position={[0, 0, .0088 * UNIT]} outlineWidth={0}>{n}</Text>
        {active && <Text font={DISPLAY} fontSize={.0125 * UNIT} color="#f4e7c6" anchorX="center" anchorY="bottom" position={[0, .0135 * UNIT, 0]} maxWidth={.14 * UNIT} textAlign="center"
          outlineWidth={.0012 * UNIT} outlineColor="#07060a">{name}</Text>}
      </Billboard>
    </group>
  )
}

/** The guide: a small light to follow down a leg, and a shaft of it onto whatever is being described. */
function Guide({ orb, beam, colour }: { orb: MutableRefObject<THREE.Group | null>; beam: MutableRefObject<THREE.Group | null>; colour: string }) {
  const ou = GUIDE_UNIT, shaft = .1 * UNIT
  return (
    <>
      <group ref={orb} visible={false}>
        <mesh raycast={noHit}><sphereGeometry args={[.011 * ou, 24, 16]} /><meshBasicMaterial color="#fff3d6" toneMapped={false} /></mesh>
        <mesh raycast={noHit}><sphereGeometry args={[.026 * ou, 24, 16]} /><meshBasicMaterial color={AMBER} transparent opacity={.22} depthWrite={false} toneMapped={false} /></mesh>
        <pointLight color={AMBER} intensity={3} distance={.3 * ou} decay={2} />
      </group>
      <group ref={beam} visible={false}>
        <mesh position={[0, shaft / 2, 0]} raycast={noHit}><cylinderGeometry args={[.0012 * UNIT, .0035 * UNIT, shaft, 10, 1, true]} /><meshBasicMaterial color={AMBER} transparent opacity={.35} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} /></mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .002 * UNIT, 0]} raycast={noHit}>
          <ringGeometry args={[.012 * UNIT, .0155 * UNIT, 48]} /><meshBasicMaterial color={colour} transparent opacity={.9} depthTest={false} toneMapped={false} />
        </mesh>
      </group>
    </>
  )
}

/* ------------------------------------------------ the person's own space -- */

/** A ring of light to stand on, which stays put under the person while everything else
    moves (something in view that does not move is a comfort in itself), and a dusk sky, because
    the tiles end at the horizon and the dark beyond them should be a sky and not a void. */
function Deck() {
  const sky = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, toneMapped: false,
    vertexShader: /* glsl */`varying vec3 dir; void main() { dir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`
      varying vec3 dir;
      void main() {
        float h = normalize(dir).y;
        vec3 glow = mix(vec3(.30, .17, .08), vec3(.10, .07, .07), smoothstep(0., .22, h));
        vec3 c = mix(glow, vec3(.027, .024, .04), smoothstep(.12, .7, h));
        gl_FragColor = vec4(mix(vec3(.05, .04, .035), c, smoothstep(-.12, 0., h)), 1.);
      }`,
  }), [])
  return (
    <group>
      <mesh material={sky} renderOrder={-1000} frustumCulled={false} raycast={noHit}><sphereGeometry args={[15000, 32, 16]} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={noHit}>
        <circleGeometry args={[.9, 64]} /><meshBasicMaterial color="#0d0a08" transparent opacity={.5} depthWrite={false} />
      </mesh>
      {[.9, 1.25].map((r, i) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, .002, 0]} raycast={noHit}>
          <ringGeometry args={[r, r + .008, 96]} /><meshBasicMaterial color={AMBER} transparent opacity={.5 - i * .25} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

type Hud = { stop: number; line: string; title: string; playing: boolean; target: string; seg: string }

/** What the guide is saying, low enough to leave the view ahead clear. */
function Captions({ hud, colour, count }: { hud: Hud; colour: string; count: number }) {
  const W = .95
  return (
    <group position={[0, .98, -1.05]} rotation={[-.55, 0, 0]}>
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

/** Buttons you point at and squeeze. They sit at your lap, tilted up to meet you. */
function Console({ xr, hud, stats, many, dayNo, dayName, smooth, colour, onPrev, onNext, onPlay, onSmooth, onDay }: {
  xr: typeof store; hud: Hud; stats: string; many: boolean; dayNo: number; dayName: string; smooth: boolean; colour: string
  onPrev: () => void; onNext: () => void; onPlay: () => void; onSmooth: () => void; onDay: () => void
}) {
  type Row = [label: string, onClick: () => void, width: number][]
  const row1: Row = [['◂ Prev', onPrev, .13], [hud.playing ? 'Pause' : 'Play', onPlay, .13], ['Next ▸', onNext, .13]]
  const row2: Row = [
    [smooth ? 'Ride: smooth' : 'Ride: blinks', onSmooth, .2],
    ...(many ? [[`Day ${dayNo}${dayName ? ' · ' + dayName : ''} ▸`, onDay, .34]] as Row : []),
    ['Leave VR', () => { void xr.getState().session?.end() }, .16],
  ]
  const layout = (row: Row, y: number) => {
    const gap = .012, total = row.reduce((w, r) => w + r[2], 0) + gap * (row.length - 1)
    let x = -total / 2
    return row.map(([label, fn, w], i) => { const el = <Btn key={label + i} x={x + w / 2} y={y} w={w} label={label} onClick={fn} primary={label === 'Play' || label === 'Pause'} colour={colour} />; x += w + gap; return el })
  }
  return (
    <group position={[0, .76, -.3]} rotation={[-.75, 0, 0]}>
      {layout(row1, .05)}
      {layout(row2, -.02)}
      <Text font={FONT} fontSize={.014} color="#9a8763" anchorX="center" anchorY="middle" position={[0, -.075, 0]}>A or X pauses the guide  ·  hold B or Y to leave</Text>
      {stats && <Text font={FONT} fontSize={.014} color={AMBER} anchorX="center" anchorY="middle" position={[0, -.1, 0]}>{stats}</Text>}
    </group>
  )
}

function Btn({ x, y, w, label, onClick, primary, colour }: { x: number; y: number; w: number; label: string; onClick: () => void; primary: boolean; colour: string }) {
  const [hot, setHot] = useState(false)
  const [down, setDown] = useState(false)
  return (
    <group position={[x, y, 0]}>
      <RoundedBox args={[w, .05, .012]} radius={.012} smoothness={4} position={[0, 0, down ? -.004 : 0]}
        onClick={e => { e.stopPropagation(); onClick() }} onPointerOver={() => setHot(true)} onPointerOut={() => { setHot(false); setDown(false) }}
        onPointerDown={() => setDown(true)} onPointerUp={() => setDown(false)}>
        <meshBasicMaterial color={primary ? colour : hot ? '#3a2f22' : '#1a1510'} transparent opacity={.94} toneMapped={false} />
      </RoundedBox>
      <Text font={FONT} fontSize={.0175} color={primary ? '#1a1208' : '#f4e7c6'} anchorX="center" anchorY="middle" position={[0, 0, .0075 - (down ? .004 : 0)]} raycast={noHit}>{label}</Text>
    </group>
  )
}
