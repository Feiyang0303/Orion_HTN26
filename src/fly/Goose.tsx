import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/* The narrator, in person: a small magic goose who flies beside you.
 *
 * It lives in its own little canvas laid over the corner of the flight, not
 * in the city's scene, for three reasons that all point the same way. It is
 * never behind a building, because it is not in the same world as the
 * buildings. It costs nothing the city's renderer can feel — a dozen spheres
 * and a handful of sparks. And it can be told what to do with plain props
 * from React, which is how the rest of the flight already talks.
 *
 * It is built from primitives rather than a model file, and that is a choice
 * about the character and not a shortcut: round parts, big eyes, a beak, a
 * hat. Everything a goose needs to be cute is a sphere or a cone, and nothing
 * has to be downloaded for it to turn up.
 *
 * What it does: breathes and bobs when idle; blinks now and then; flaps and
 * chatters — the beak opening on the rhythm of speech — while the guide is
 * talking, with sparks rising from the wand; leans in and thinks, hat-star
 * glowing, while the guide is composing an answer; and sits very still,
 * looking at you, when the flight is paused.
 */

export type GooseState = 'idle' | 'talking' | 'thinking' | 'paused'

const CREAM = '#fbf6ec'
const CREAM_SHADE = '#efe4d0'
const ORANGE = '#f2a341'
const ORANGE_DEEP = '#d9832c'
const INK = '#2a2118'
const BLUSH = '#f4b0a8'
const HAT = '#4a3a8f'
const HAT_BAND = '#f0b45e'
const STAR = '#ffe08a'

const SPARKS = 24

function Bird({ state }: { state: GooseState }) {
  const root = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const beakTop = useRef<THREE.Mesh>(null)
  const beakBottom = useRef<THREE.Mesh>(null)
  const wingL = useRef<THREE.Group>(null)
  const wingR = useRef<THREE.Group>(null)
  const lidL = useRef<THREE.Mesh>(null)
  const lidR = useRef<THREE.Mesh>(null)
  const star = useRef<THREE.Mesh>(null)
  const starLight = useRef<THREE.PointLight>(null)
  const sparks = useRef<THREE.InstancedMesh>(null)

  /* Sparks are a tiny particle system: each has a phase and a radius, and
     their height is a function of time so there is nothing to simulate. */
  const spark = useMemo(() => Array.from({ length: SPARKS }, (_, i) => ({
    phase: (i / SPARKS) * Math.PI * 2 + Math.random(),
    r: 0.55 + Math.random() * 0.5,
    speed: 0.6 + Math.random() * 0.7,
    size: 0.03 + Math.random() * 0.035,
  })), [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const blink = useRef({ next: 2 + Math.random() * 3, until: 0 })

  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime()
    const talking = state === 'talking', thinking = state === 'thinking', paused = state === 'paused'

    // Breathing and hovering. Still when paused, as if listening.
    if (root.current) {
      const bob = paused ? Math.sin(t * 1.2) * 0.01 : Math.sin(t * 2.1) * 0.05 + (talking ? Math.sin(t * 9) * 0.015 : 0)
      root.current.position.y = bob
      const lean = thinking ? 0.18 : paused ? 0.08 : 0
      root.current.rotation.z += ((talking ? Math.sin(t * 3.7) * 0.05 : 0) - root.current.rotation.z) * Math.min(1, dt * 6)
      root.current.rotation.x += (lean - root.current.rotation.x) * Math.min(1, dt * 4)
      root.current.rotation.y += ((paused ? 0.25 : thinking ? -0.35 : Math.sin(t * 0.7) * 0.12) - root.current.rotation.y) * Math.min(1, dt * 4)
    }
    // The head nods along with speech and tilts when thinking.
    if (head.current) {
      const nod = talking ? Math.sin(t * 8.5) * 0.06 : 0
      head.current.rotation.x += (nod - head.current.rotation.x) * Math.min(1, dt * 12)
      head.current.rotation.z += ((thinking ? 0.22 : 0) - head.current.rotation.z) * Math.min(1, dt * 5)
    }
    // The beak: a chatter on two frequencies so it does not look mechanical.
    const open = talking ? Math.max(0, Math.sin(t * 11) * 0.5 + Math.sin(t * 17.3) * 0.3 + 0.2) * 0.35 : 0
    if (beakTop.current) beakTop.current.rotation.x += (-open * 0.6 - beakTop.current.rotation.x) * Math.min(1, dt * 20)
    if (beakBottom.current) beakBottom.current.rotation.x += (open - beakBottom.current.rotation.x) * Math.min(1, dt * 20)
    // Wings rest folded down along the body and lift from there: a slow
    // breathe when idle, a real flap while talking, still when paused.
    const raise = paused ? -0.08 : talking ? Math.sin(t * 7) * 0.5 + 0.35 : Math.sin(t * 2.4) * 0.1 - 0.02
    if (wingL.current) wingL.current.rotation.z = 0.62 - raise
    if (wingR.current) wingR.current.rotation.z = -(0.62 - raise)
    // Blinking: eyelids drop for a tenth of a second every few seconds.
    const b = blink.current
    if (t > b.next) { b.until = t + 0.11; b.next = t + 2.5 + Math.random() * 3.5 }
    const shut = t < b.until ? 1 : 0
    if (lidL.current) lidL.current.scale.y = shut
    if (lidR.current) lidR.current.scale.y = shut
    // The star on the hat glows when the goose is thinking or talking.
    const glow = thinking ? 1.6 + Math.sin(t * 5) * 0.4 : talking ? 1.1 : 0.55
    if (star.current) (star.current.material as THREE.MeshStandardMaterial).emissiveIntensity += (glow - (star.current.material as THREE.MeshStandardMaterial).emissiveIntensity) * Math.min(1, dt * 6)
    if (starLight.current) starLight.current.intensity += ((thinking ? 1.4 : talking ? 0.8 : 0.25) - starLight.current.intensity) * Math.min(1, dt * 6)
    // Sparks rise while talking, and fade away otherwise.
    if (sparks.current) {
      const want = talking ? 1 : thinking ? 0.5 : 0
      const m = sparks.current
      const cur = (m.userData.alive ?? 0) as number
      const alive = cur + (want - cur) * Math.min(1, dt * 3)
      m.userData.alive = alive
      spark.forEach((s, i) => {
        const life = ((t * s.speed + s.phase) % 1.6) / 1.6            // 0..1 up the column
        const a = s.phase + t * 0.9
        const scale = alive * s.size * (1 - life) * (0.6 + Math.sin(life * Math.PI) * 0.8)
        dummy.position.set(Math.cos(a) * s.r * (0.3 + life * 0.7), -0.2 + life * 1.5, Math.sin(a) * s.r * (0.3 + life * 0.7))
        dummy.scale.setScalar(Math.max(0.0001, scale))
        dummy.updateMatrix()
        m.setMatrixAt(i, dummy.matrix)
      })
      m.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group ref={root} position={[0, 0, 0]}>
      {/* body */}
      <mesh position={[0, -0.15, 0]} scale={[1, 0.82, 1.15]}>
        <sphereGeometry args={[0.62, 32, 24]} />
        <meshStandardMaterial color={CREAM} roughness={0.9} />
      </mesh>
      {/* tail feathers */}
      <mesh position={[0, 0.05, -0.62]} rotation={[0.5, 0, 0]} scale={[0.55, 0.3, 0.6]}>
        <sphereGeometry args={[0.5, 16, 12]} />
        <meshStandardMaterial color={CREAM_SHADE} roughness={0.9} />
      </mesh>
      {/* wings */}
      <group ref={wingL} position={[-0.5, 0.02, -0.05]}>
        <mesh position={[-0.3, 0, 0]} rotation={[0, 0, 0.15]} scale={[0.6, 0.2, 0.8]}>
          <sphereGeometry args={[0.6, 20, 14]} />
          <meshStandardMaterial color={CREAM_SHADE} roughness={0.9} />
        </mesh>
      </group>
      <group ref={wingR} position={[0.5, 0.02, -0.05]}>
        <mesh position={[0.3, 0, 0]} rotation={[0, 0, -0.15]} scale={[0.6, 0.2, 0.8]}>
          <sphereGeometry args={[0.6, 20, 14]} />
          <meshStandardMaterial color={CREAM_SHADE} roughness={0.9} />
        </mesh>
      </group>
      {/* neck */}
      <mesh position={[0, 0.35, 0.28]} rotation={[0.35, 0, 0]}>
        <capsuleGeometry args={[0.2, 0.55, 8, 16]} />
        <meshStandardMaterial color={CREAM} roughness={0.9} />
      </mesh>
      {/* head */}
      <group ref={head} position={[0, 0.82, 0.45]}>
        <mesh>
          <sphereGeometry args={[0.4, 32, 24]} />
          <meshStandardMaterial color={CREAM} roughness={0.9} />
        </mesh>
        {/* cheeks */}
        <mesh position={[-0.26, -0.06, 0.28]} rotation={[0, -0.6, 0]} scale={[1, 0.7, 0.3]}>
          <sphereGeometry args={[0.11, 12, 8]} />
          <meshStandardMaterial color={BLUSH} roughness={1} transparent opacity={0.75} />
        </mesh>
        <mesh position={[0.26, -0.06, 0.28]} rotation={[0, 0.6, 0]} scale={[1, 0.7, 0.3]}>
          <sphereGeometry args={[0.11, 12, 8]} />
          <meshStandardMaterial color={BLUSH} roughness={1} transparent opacity={0.75} />
        </mesh>
        {/* eyes: a dark sphere, a white glint, and a lid that scales down over it to blink */}
        {[-1, 1].map(side => (
          <group key={side} position={[side * 0.17, 0.08, 0.33]}>
            <mesh>
              <sphereGeometry args={[0.075, 16, 12]} />
              <meshStandardMaterial color={INK} roughness={0.35} />
            </mesh>
            <mesh position={[side * -0.025, 0.03, 0.06]}>
              <sphereGeometry args={[0.022, 8, 6]} />
              <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.6} />
            </mesh>
            <mesh ref={side < 0 ? lidL : lidR} position={[0, 0.02, 0.005]} scale={[1, 0, 1]}>
              <sphereGeometry args={[0.085, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color={CREAM} roughness={0.9} />
            </mesh>
          </group>
        ))}
        {/* beak, in two halves so it can open */}
        <group position={[0, -0.04, 0.38]}>
          <mesh ref={beakTop} position={[0, 0.02, 0]} rotation={[0, 0, 0]}>
            <coneGeometry args={[0.12, 0.3, 4]} />
            <meshStandardMaterial color={ORANGE} roughness={0.6} />
          </mesh>
          <mesh ref={beakBottom} position={[0, -0.03, 0]}>
            <coneGeometry args={[0.1, 0.24, 4]} />
            <meshStandardMaterial color={ORANGE_DEEP} roughness={0.6} />
          </mesh>
        </group>
        {/* the hat */}
        <group position={[0.04, 0.4, -0.04]} rotation={[0.12, 0, -0.22]}>
          <mesh position={[0, 0.02, 0]}>
            <cylinderGeometry args={[0.4, 0.4, 0.045, 24]} />
            <meshStandardMaterial color={HAT} roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.4, 0]}>
            <coneGeometry args={[0.23, 0.78, 20]} />
            <meshStandardMaterial color={HAT} roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.09, 0]}>
            <cylinderGeometry args={[0.24, 0.25, 0.07, 20]} />
            <meshStandardMaterial color={HAT_BAND} roughness={0.7} />
          </mesh>
          <mesh ref={star} position={[0, 0.84, 0]} rotation={[0, 0, 0.3]}>
            <octahedronGeometry args={[0.1, 0]} />
            <meshStandardMaterial color={STAR} emissive={STAR} emissiveIntensity={0.55} roughness={0.4} />
          </mesh>
          <pointLight ref={starLight} position={[0, 0.92, 0.1]} color={STAR} intensity={0.25} distance={2.5} decay={2} />
        </group>
      </group>
      {/* feet, tucked */}
      <mesh position={[-0.16, -0.62, 0.12]} rotation={[0.3, 0, 0]} scale={[1, 0.4, 1.4]}>
        <sphereGeometry args={[0.1, 10, 8]} />
        <meshStandardMaterial color={ORANGE} roughness={0.7} />
      </mesh>
      <mesh position={[0.16, -0.62, 0.12]} rotation={[0.3, 0, 0]} scale={[1, 0.4, 1.4]}>
        <sphereGeometry args={[0.1, 10, 8]} />
        <meshStandardMaterial color={ORANGE} roughness={0.7} />
      </mesh>
      {/* sparks */}
      <instancedMesh ref={sparks} args={[undefined, undefined, SPARKS]} position={[0, 0.6, 0.2]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={STAR} emissive={STAR} emissiveIntensity={1.4} roughness={0.3} transparent opacity={0.9} />
      </instancedMesh>
    </group>
  )
}

/** The goose, in its corner. `state` is what it is doing; nothing else is needed. */
export default function Goose({ state }: { state: GooseState }) {
  return (
    <div className={`goose is-${state}`} aria-hidden>
      <Canvas dpr={[1, 1.5]} camera={{ fov: 34, near: 0.1, far: 20, position: [0.4, 0.7, 4.5] }} gl={{ alpha: true, antialias: true }}
        onCreated={({ gl, camera }) => { gl.setClearColor(0x000000, 0); camera.lookAt(0, 0.35, 0) }}>
        <ambientLight intensity={0.85} color="#fff4e2" />
        <directionalLight position={[2, 3, 2.5]} intensity={1.6} color="#ffe9c8" />
        <directionalLight position={[-2, 1, -1]} intensity={0.5} color="#b9c9ff" />
        <Bird state={state} />
      </Canvas>
    </div>
  )
}
