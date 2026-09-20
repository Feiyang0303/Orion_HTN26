import { useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Agent } from '../plan/events'
import { MEMBER, type Status } from '../crew/roster'

/* The crew's magic. Each member of the crew has one spell, cast on the city while
 * that member's step is running and fading when it stops; all of them are drawn
 * in the city's own frame (y is straight up out of the ground there), in that
 * member's colour, so what is going on can be read from the globe alone:
 *
 *   Surveyor    a targeting reticle locks on
 *   Scout       a searchlight sweeps, and each place it finds lights up
 *   Router      routes run between the places, as dashed light
 *   Timekeeper  a clock face ticks around the city
 *   Critic      a red lens scans over the places
 *   Narrator    words rise from the city as a spiral of light
 *   Voice       sound rings roll outward
 *   Director    a viewfinder walks round each place, side by side, and flashes when it takes one
 *
 * They are pure decoration in the sense that nothing depends on them, and pure
 * information in the sense that every one of them is on exactly when its step is. */

const add = THREE.AdditiveBlending

/** How much a member is working, eased, read from a ref so nothing re-renders. */
function useWork(status: MutableRefObject<Record<Agent, Status>>, id: Agent) {
  const w = useRef(0)
  return { w, tick: (dt: number) => { w.current += ((status.current[id].state === 'working' ? 1 : 0) - w.current) * (1 - Math.exp(-dt * 4)); return w.current } }
}

export default function CityFX({ status, places }: { status: MutableRefObject<Record<Agent, Status>>; places: { lat: number; lon: number }[] }) {
  // Places are all inside one city, far too close together to see on a globe, so
  // their layout around the marker is spread out: a cluster, not a coordinate.
  const spots = useMemo(() => {
    if (!places.length) return []
    const lat0 = places.reduce((a, p) => a + p.lat, 0) / places.length, lon0 = places.reduce((a, p) => a + p.lon, 0) / places.length
    const kx = Math.cos(lat0 * Math.PI / 180)
    let far = 1e-6
    places.forEach(p => { far = Math.max(far, Math.hypot((p.lon - lon0) * kx, p.lat - lat0)) })
    return places.map(p => new THREE.Vector3(((p.lon - lon0) * kx / far) * .19, 0, -((p.lat - lat0) / far) * .19))
  }, [places])

  return (
    <group>
      <Reticle status={status} />
      <Searchlight status={status} spots={spots} />
      <Routes status={status} spots={spots} />
      <Clock status={status} />
      <Lens status={status} spots={spots} />
      <Words status={status} />
      <SoundRings status={status} />
      <Viewfinder status={status} spots={spots} />
    </group>
  )
}

function Reticle({ status }: { status: MutableRefObject<Record<Agent, Status>> }) {
  const g = useRef<THREE.Group>(null)
  const { tick } = useWork(status, 'Geocode')
  const c = MEMBER.Geocode.colour
  useFrame(({ clock }, dt) => {
    const w = tick(dt), t = clock.elapsedTime
    g.current!.visible = w > .02
    g.current!.rotation.y = t * 1.6
    g.current!.scale.setScalar((.4 + .6 * w) * (1 + Math.sin(t * 5) * .06))
    g.current!.children.forEach(m => ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = .9 * w)
  })
  return (
    <group ref={g} position={[0, .012, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><ringGeometry args={[.19, .2, 64]} /><meshBasicMaterial color={c} transparent side={THREE.DoubleSide} blending={add} depthWrite={false} /></mesh>
      {[0, 1, 2, 3].map(i => (
        <mesh key={i} position={[Math.sin(i * Math.PI / 2) * .245, 0, Math.cos(i * Math.PI / 2) * .245]} rotation={[0, i * Math.PI / 2, 0]}>
          <boxGeometry args={[.012, .004, .07]} /><meshBasicMaterial color={c} transparent blending={add} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

function Searchlight({ status, spots }: { status: MutableRefObject<Record<Agent, Status>>; spots: THREE.Vector3[] }) {
  const cone = useRef<THREE.Group>(null)
  const dots = useRef<THREE.Group>(null)
  const { tick } = useWork(status, 'Scout')
  const c = MEMBER.Scout.colour
  useFrame(({ clock }, dt) => {
    const w = tick(dt), t = clock.elapsedTime
    cone.current!.visible = w > .02
    cone.current!.rotation.set(Math.sin(t * .9) * .35, t * 1.1, Math.cos(t * .7) * .3)
    ;(cone.current!.children[0] as THREE.Mesh).scale.setScalar(.6 + .4 * w)
    ;(((cone.current!.children[0] as THREE.Mesh).material) as THREE.MeshBasicMaterial).opacity = .22 * w
    dots.current!.children.forEach((m, i) => {
      const seen = Math.min(1, Math.max(0, (t * 2 - i * .6) % 999))
      m.scale.setScalar(.012 + Math.sin(t * 3 + i) * .002 + seen * .012)
    })
  })
  return (
    <>
      <group ref={cone} position={[0, .005, 0]}>
        <mesh position={[0, .25, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[.13, .5, 32, 1, true]} /><meshBasicMaterial color={c} transparent opacity={.2} side={THREE.DoubleSide} blending={add} depthWrite={false} />
        </mesh>
      </group>
      <group ref={dots}>
        {spots.map((p, i) => (
          <mesh key={i} position={[p.x, .02, p.z]}>
            <sphereGeometry args={[1, 10, 8]} /><meshBasicMaterial color={c} transparent opacity={.95} blending={add} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </>
  )
}

function Routes({ status, spots }: { status: MutableRefObject<Record<Agent, Status>>; spots: THREE.Vector3[] }) {
  const g = useRef<THREE.Group>(null)
  const { tick } = useWork(status, 'Router')
  const c = MEMBER.Router.colour
  // Arcs between consecutive places, lifted off the ground; three rings if there are none yet.
  const lines = useMemo(() => {
    const out: THREE.BufferGeometry[] = []
    if (spots.length > 1) {
      for (let i = 1; i < spots.length; i++) {
        const a = spots[i - 1], b = spots[i], mid = a.clone().lerp(b, .5).add(new THREE.Vector3(0, .07 + a.distanceTo(b) * .35, 0))
        out.push(new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(a.clone().setY(.02), mid, b.clone().setY(.02)).getPoints(28)))
      }
    } else {
      for (const r of [.15, .22, .29]) out.push(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 65 }, (_, i) => new THREE.Vector3(Math.cos(i / 64 * Math.PI * 2) * r, .015, Math.sin(i / 64 * Math.PI * 2) * r))))
    }
    return out
  }, [spots])
  const mats = useMemo(() => lines.map(() => new THREE.LineDashedMaterial({ color: c, dashSize: .03, gapSize: .02, transparent: true, opacity: 0, blending: add, depthWrite: false })), [lines, c])
  useFrame((_, dt) => {
    const w = tick(dt)
    g.current!.visible = w > .02
    mats.forEach((m, i) => { m.opacity = .9 * w; m.dashOffset -= dt * (.18 + i * .05) })
  })
  return (
    <group ref={g}>
      {lines.map((geo, i) => <primitive key={i} object={(() => { const l = new THREE.Line(geo, mats[i]); l.computeLineDistances(); return l })()} />)}
    </group>
  )
}

function Clock({ status }: { status: MutableRefObject<Record<Agent, Status>> }) {
  const g = useRef<THREE.Group>(null)
  const hand = useRef<THREE.Mesh>(null)
  const { tick } = useWork(status, 'Timekeeper')
  const c = MEMBER.Timekeeper.colour
  useFrame(({ clock }, dt) => {
    const w = tick(dt), t = clock.elapsedTime
    g.current!.visible = w > .02
    g.current!.scale.setScalar(.7 + .3 * w)
    hand.current!.rotation.y = -t * 5
    g.current!.children.forEach(m => { const mat = (m as THREE.Mesh).material as THREE.MeshBasicMaterial; if (mat) mat.opacity = .8 * w })
  })
  return (
    <group ref={g} position={[0, .01, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><ringGeometry args={[.245, .255, 72]} /><meshBasicMaterial color={c} transparent side={THREE.DoubleSide} blending={add} depthWrite={false} /></mesh>
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} position={[Math.sin(i / 12 * Math.PI * 2) * .27, 0, Math.cos(i / 12 * Math.PI * 2) * .27]} rotation={[0, i / 12 * Math.PI * 2, 0]}>
          <boxGeometry args={[.008, .004, i % 3 ? .02 : .045]} /><meshBasicMaterial color={c} transparent blending={add} depthWrite={false} />
        </mesh>
      ))}
      <mesh ref={hand} position={[0, 0, 0]}>
        <boxGeometry args={[.006, .004, .5]} /><meshBasicMaterial color={c} transparent blending={add} depthWrite={false} />
      </mesh>
    </group>
  )
}

function Lens({ status, spots }: { status: MutableRefObject<Record<Agent, Status>>; spots: THREE.Vector3[] }) {
  const g = useRef<THREE.Group>(null)
  const { tick } = useWork(status, 'Critic')
  const c = MEMBER.Critic.colour
  useFrame(({ clock }, dt) => {
    const w = tick(dt), t = clock.elapsedTime
    g.current!.visible = w > .02
    const p = spots.length ? spots[Math.floor(t * .9) % spots.length] : new THREE.Vector3(Math.sin(t * 1.3) * .14, 0, Math.cos(t * 1.7) * .14)
    g.current!.position.lerp(new THREE.Vector3(p.x, .05, p.z), .08)
    g.current!.scale.setScalar(.6 + .4 * w)
    g.current!.children.forEach(m => { const mat = (m as THREE.Mesh).material as THREE.MeshBasicMaterial; mat.opacity = .85 * w })
  })
  return (
    <group ref={g}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><ringGeometry args={[.06, .07, 40]} /><meshBasicMaterial color={c} transparent side={THREE.DoubleSide} blending={add} depthWrite={false} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><circleGeometry args={[.06, 32]} /><meshBasicMaterial color={c} transparent side={THREE.DoubleSide} blending={add} depthWrite={false} /></mesh>
    </group>
  )
}

function Words({ status }: { status: MutableRefObject<Record<Agent, Status>> }) {
  const N = 90
  const pts = useRef<THREE.Points>(null)
  const { tick } = useWork(status, 'Narrator')
  const c = MEMBER.Narrator.colour
  const geo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); return g }, [])
  useFrame(({ clock }, dt) => {
    const w = tick(dt), t = clock.elapsedTime
    pts.current!.visible = w > .02
    const a = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < N; i++) {
      const u = ((t * .25 + i / N) % 1)
      const ang = u * 15 + i * .7, r = .05 + u * .1
      a.setXYZ(i, Math.cos(ang) * r, .02 + u * .7, Math.sin(ang) * r)
    }
    a.needsUpdate = true
    ;(pts.current!.material as THREE.PointsMaterial).opacity = .95 * w
  })
  return <points ref={pts} geometry={geo}><pointsMaterial color={c} size={.02} transparent blending={add} depthWrite={false} sizeAttenuation /></points>
}

function SoundRings({ status }: { status: MutableRefObject<Record<Agent, Status>> }) {
  const rings = useRef<(THREE.Mesh | null)[]>([])
  const { tick } = useWork(status, 'Voice')
  const c = MEMBER.Voice.colour
  useFrame(({ clock }, dt) => {
    const w = tick(dt), t = clock.elapsedTime
    rings.current.forEach((m, i) => {
      if (!m) return
      const p = (t * 1.1 + i / 4) % 1
      m.visible = w > .02
      m.scale.setScalar(.05 + p * .36)
      ;(m.material as THREE.MeshBasicMaterial).opacity = (1 - p) * .8 * w
    })
  })
  return (
    <group position={[0, .014, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {[0, 1, 2, 3].map(i => (
        <mesh key={i} ref={el => { rings.current[i] = el }}>
          <ringGeometry args={[.94, 1, 56]} /><meshBasicMaterial color={c} transparent side={THREE.DoubleSide} blending={add} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

/** The Director's: an upright frame that stands on each side of a place in turn, facing it, as the real one does. */
function Viewfinder({ status, spots }: { status: MutableRefObject<Record<Agent, Status>>; spots: THREE.Vector3[] }) {
  const SIDES = 6, PER_SIDE = .45
  const g = useRef<THREE.Group>(null)
  const frame = useRef<THREE.Mesh>(null), flash = useRef<THREE.Mesh>(null)
  const { tick } = useWork(status, 'Director')
  const c = MEMBER.Director.colour
  const goal = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ clock }, dt) => {
    const w = tick(dt), t = clock.elapsedTime
    g.current!.visible = w > .02
    const n = Math.floor(t / PER_SIDE), u = (t / PER_SIDE) % 1
    const p = spots.length ? spots[Math.floor(n / SIDES) % spots.length] : goal.set(0, 0, 0)
    const a = (n % SIDES) / SIDES * Math.PI * 2
    g.current!.position.lerp(goal.set(p.x + Math.cos(a) * .075, .06, p.z + Math.sin(a) * .075), .2)
    g.current!.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a))          // the frame's face turned to the place
    ;(frame.current!.material as THREE.MeshBasicMaterial).opacity = .9 * w
    ;(flash.current!.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - u * 5) * .55 * w   // the shutter
  })
  return (
    <group ref={g}>
      {/* a four-sided ring is a diamond until it is turned; it is widened after turning, or it would shear */}
      <group scale={[1.3, 1, 1]}><mesh ref={frame} rotation={[0, 0, Math.PI / 4]}><ringGeometry args={[.04, .046, 4]} /><meshBasicMaterial color={c} transparent side={THREE.DoubleSide} blending={add} depthWrite={false} /></mesh></group>
      <mesh ref={flash} scale={[1.3, 1, 1]}><planeGeometry args={[.056, .056]} /><meshBasicMaterial color={c} transparent side={THREE.DoubleSide} blending={add} depthWrite={false} /></mesh>
    </group>
  )
}
