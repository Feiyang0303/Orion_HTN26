import { useMemo, useRef, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Sparkles, Stars } from '@react-three/drei'
import * as THREE from 'three'
import type { Agent, CrewEvent } from '../plan/events'
import type { LatLon } from '../types'
import Figure from '../crew/Figure'
import { CREW, MEMBER, fold, type Status } from '../crew/roster'
import Globe from './Globe'
import CityFX from './Magic'

/* The stage that stays behind every screen before the flight.
 *
 * One globe, one canvas. At the kickoff the globe sits to one side, turning, and
 * lights up the city when there is one. When the crew is sent, the globe rises to
 * the middle, eight figures stand up around it on a platform, and each of them
 * works on the city while their step runs: their light streams across to the
 * marker, and their spell plays out there. Nothing on this stage is a picture of
 * progress: every figure, stream and spell is driven by the crew's real events.
 */

export type GlobeMode = 'kickoff' | 'crew'

const RING = 4.3
/* The ring is an ellipse, not a circle. A circle puts two of the crew directly
   behind the globe, where the planet cuts their heads off — and the only ways
   out of that are a smaller globe or a lower one, both of which cost more than
   this does. Pulling the back of the ring in brings those two forward and down
   the screen instead, and it stops the front pair falling off the bottom edge. */
const DEPTH = .75
const angleOf = (i: number) => (i / CREW.length) * Math.PI * 2 + Math.PI / CREW.length
const CAMERA_DISTANCE = Math.hypot(6.2, 16.5)

export default function GlobeScene({ mode, city, events, places, className }: {
  mode: GlobeMode
  city: LatLon | null
  events: CrewEvent[]
  /** The places found so far, so the scout's discoveries can be lit on the globe. */
  places: { lat: number; lon: number }[]
  className?: string
}) {
  const { status } = useMemo(() => fold(events), [events])
  const statusRef = useRef(status)
  statusRef.current = status
  const energy = useRef(0)
  const cityWorld = useRef(new THREE.Vector3(0, 3, 0))
  const crewScale = useRef(0)

  return (
    <Canvas className={className} dpr={[1, 1.25]} camera={{ position: [0, 6.2, 16.5], fov: 32 }} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }} style={{ pointerEvents: 'none' }}>
      <hemisphereLight args={['#a9bcff', '#2a1f16', .8]} />
      <directionalLight position={[5, 9, 6]} intensity={1.6} color="#ffe9c9" />
      <directionalLight position={[-6, 4, -7]} intensity={.7} color="#7fa6ff" />
      {/* two layers, so the sky has depth: a far dusting and a nearer, brighter few */}
      <Stars radius={96} depth={60} count={1400} factor={2.8} fade speed={.18} />
      <Stars radius={48} depth={26} count={350} factor={5.2} fade speed={.5} />

      <Layout mode={mode} statusRef={statusRef} energy={energy} crewScale={crewScale}
        globe={<Globe city={city} cityWorld={cityWorld} energy={energy}><CityFX status={statusRef} places={places} /></Globe>}
        // Only on stage when it is needed: the name tags are DOM, and DOM does not obey a hidden 3D group.
        crew={mode === 'crew' ? <>
          <Floor depth={DEPTH} />
          {CREW.map((m, i) => <Figure key={m.id} member={m} index={i} angle={angleOf(i)} radius={RING} depth={DEPTH} status={status[m.id]} />)}
        </> : null} />
      <Streams status={statusRef} cityWorld={cityWorld} crewScale={crewScale} />
      {/* Motes in the air around the stage. The box stays shallow in z on purpose:
          these are point sprites with size attenuation, so one that wanders close
          to the camera is drawn as a quad subtending its size over its distance —
          at z = +8 a 2-unit mote fills a quarter of the screen as a glowing slab.
          Keeping |z| under 3 puts every one of them at least 13 units out. */}
      <Sparkles count={50} scale={[17, 8, 5]} size={1.2} speed={.18} opacity={.3} color="#f0b45e" position={[0, 3, 0]} />
      <Sparkles count={24} scale={[11, 5, 4]} size={1.7} speed={.1} opacity={.16} color="#8fb4ff" position={[0, 3.2, 0]} />
    </Canvas>
  )
}

/** Where the globe and the crew are, for the screen we are on; both glide there. */
function Layout({ mode, globe, crew, statusRef, energy, crewScale }: {
  mode: GlobeMode; globe: React.ReactNode; crew: React.ReactNode
  statusRef: MutableRefObject<Record<Agent, Status>>; energy: MutableRefObject<number>; crewScale: MutableRefObject<number>
}) {
  const { camera, size } = useThree()
  const globeGroup = useRef<THREE.Group>(null)
  const crewGroup = useRef<THREE.Group>(null)
  const s = useRef({ x: 0, y: 2.9, k: 1.4, c: 0 })

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, .05), t = clock.elapsedTime
    const cam = camera as THREE.PerspectiveCamera
    const hw = Math.tan(cam.fov * Math.PI / 360) * CAMERA_DISTANCE * (size.width / size.height)   // half the visible width at the origin
    const st = s.current
    const portrait = size.width / size.height < 1.05
    const goal = mode === 'kickoff'
      ? (portrait
        ? { x: 0, y: 6.7, k: THREE.MathUtils.clamp(hw * .38, 1.0, 1.5), c: 0 }                       // narrow screens: above the card
        : { x: Math.min(hw * .5, 4.6), y: 2.9, k: THREE.MathUtils.clamp(hw * .3, 1.3, 2.5), c: 0 })   // wide screens: beside it
      // Sized and placed so its lowest edge sits above the heads of the two at
      // the back of the ring, and its top stays clear of the phase chips.
      : { x: 0, y: 4.35, k: THREE.MathUtils.clamp(hw * .19, 1.1, 1.5), c: 1 }
    const e = 1 - Math.exp(-dt * 2.2)
    st.x += (goal.x - st.x) * e; st.y += (goal.y - st.y) * e; st.k += (goal.k - st.k) * e; st.c += (goal.c - st.c) * (1 - Math.exp(-dt * 1.4))

    globeGroup.current!.position.set(st.x, st.y + Math.sin(t * .6) * .06, 0)
    globeGroup.current!.scale.setScalar(st.k)
    const fit = Math.min(1, hw / 6.6)                                 // the crew's ring must fit the screen
    crewGroup.current!.scale.setScalar(Math.max(.001, st.c * fit))
    crewGroup.current!.visible = st.c > .01
    crewScale.current = st.c * fit

    const working = CREW.reduce((n, m) => n + (statusRef.current[m.id].state === 'working' ? 1 : 0), 0)
    energy.current += (Math.min(1, working / 3) - energy.current) * (1 - Math.exp(-dt * 2))

    camera.position.x = Math.sin(t * .1) * .7
    camera.lookAt(0, 2.7, 0)
  })

  return (
    <>
      <group ref={globeGroup}>{globe}</group>
      <group ref={crewGroup}>{crew}</group>
    </>
  )
}

function Floor({ depth = 1 }: { depth?: number }) {
  return (
    <group scale={[1, 1, depth]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.02, 0]}>
        <circleGeometry args={[6.7, 72]} />
        <meshStandardMaterial color="#0d0f15" roughness={.85} metalness={.25} transparent opacity={.6} />
      </mesh>
      {[5.15, 6.4].map((r, i) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r, r + .02, 128]} />
          <meshBasicMaterial color="#f0b45e" transparent opacity={i ? .1 : .22} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

/** Light from the hands of whoever is working, arcing across to the city: the crew's effort made visible. */
function Streams({ status, cityWorld, crewScale }: { status: MutableRefObject<Record<Agent, Status>>; cityWorld: MutableRefObject<THREE.Vector3>; crewScale: MutableRefObject<number> }) {
  const MAX = 360
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3).fill(-999), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3))
    return g
  }, [])
  const live = useRef<{ a: number; t: number; dur: number; jx: number; jz: number }[]>([])
  const acc = useRef<number[]>(CREW.map(() => 0))
  const colours = useMemo(() => CREW.map(m => new THREE.Color(MEMBER[m.id].colour)), [])
  const dot = useMemo(() => softDot(), [])
  const v = useMemo(() => ({ hand: new THREE.Vector3(), mid: new THREE.Vector3(), out: new THREE.Vector3() }), [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, .05)
    const k = crewScale.current
    CREW.forEach((m, i) => {
      if (status.current[m.id].state !== 'working' || k < .5) { acc.current[i] = 0; return }
      acc.current[i] += dt * 24
      while (acc.current[i] >= 1 && live.current.length < MAX) { acc.current[i]--; live.current.push({ a: i, t: 0, dur: 1 + Math.random() * .7, jx: (Math.random() - .5) * .5, jz: (Math.random() - .5) * .5 }) }
    })
    const pos = geo.attributes.position as THREE.BufferAttribute, col = geo.attributes.color as THREE.BufferAttribute
    for (let i = live.current.length - 1; i >= 0; i--) { live.current[i].t += dt / live.current[i].dur; if (live.current[i].t >= 1) live.current.splice(i, 1) }
    for (let i = 0; i < MAX; i++) {
      const p = live.current[i]
      if (!p) { pos.setXYZ(i, 0, -999, 0); continue }
      const a = angleOf(p.a)
      v.hand.set(Math.sin(a) * (RING - .55) * k, 1.55 * k, Math.cos(a) * (RING - .55) * DEPTH * k)
      const to = cityWorld.current
      v.mid.copy(v.hand).lerp(to, .5); v.mid.y += 1.7
      const t = p.t, u = 1 - t
      v.out.set(0, 0, 0).addScaledVector(v.hand, u * u).addScaledVector(v.mid, 2 * u * t).addScaledVector(to, t * t)
      v.out.x += p.jx * Math.sin(t * Math.PI) * .25; v.out.z += p.jz * Math.sin(t * Math.PI) * .25
      pos.setXYZ(i, v.out.x, v.out.y, v.out.z)
      const f = Math.sin(t * Math.PI)
      col.setXYZ(i, colours[p.a].r * f, colours[p.a].g * f, colours[p.a].b * f)
    }
    pos.needsUpdate = true; col.needsUpdate = true
  })

  return (
    <points geometry={geo} frustumCulled={false}>
      <pointsMaterial size={.34} map={dot} vertexColors transparent blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation />
    </points>
  )
}

/** A soft round spot, so light reads as light and not as a square of pixels. */
function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.4, 'rgba(255,255,255,.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}
