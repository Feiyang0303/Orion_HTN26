import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/* The narrator, in person: a small magic goose who flies beside you.
 *
 * It lives in its own little canvas laid over the corner of the flight, not
 * in the city's scene. It is never behind a building, because it is not in
 * the same world as the buildings; it costs the city's renderer nothing; and
 * it is told what to do with plain props from React, which is how the rest of
 * the flight already talks.
 *
 * It is drawn the way the journal draws things: flat cel shading in the
 * app's own parchment and amber, with an ink line around every part — the
 * inverted-hull trick, a copy of each mesh scaled up a little and painted ink
 * on its back faces — so it sits with the hand-drawn pages rather than
 * looking like a render dropped on top of them.
 *
 * And it is a goose — a Canada goose, the one that owns Waterloo — which is
 * mostly a neck: a long S-curve from a low body up to a small head, ink-dark
 * from the bill to the shoulders with the white chinstrap across the cheeks,
 * a brown back, a pale breast, black bill and feet, white under the tail,
 * wings folded along the back. Everything is a sphere, a cone or a tube;
 * nothing has to be downloaded for it to turn up.
 *
 * What it does: breathes and bobs when idle; blinks now and then; flaps and
 * chatters — the bill opening on the rhythm of speech, sparks rising from
 * the hat — while the guide is talking; leans in and thinks, the hat's star
 * glowing, while an answer is composed; sits still, looking at you, when the
 * flight is paused.
 */

export type GooseState = 'idle' | 'talking' | 'thinking' | 'paused'

/* A Canada goose, in the app's own browns and parchment. The head and neck
   are ink rather than black so the cel shading still has two tones to work
   with, and the outline is darker than any of it so it still reads. */
const HEAD = '#3a2e26'
const CHINSTRAP = '#f3e7cf'
const BACK = '#8a7156'
const BACK_SHADE = '#6e5843'
const BREAST = '#d9c8a9'
const UNDERTAIL = '#f0e4cc'
const BILL = '#1a1411'
const INK = '#0f0b09'
const LINE = '#1c1410'
const BLUSH = '#d99a8a'
const HAT = '#6b4326'
const HAT_BAND = '#f0b45e'
const STAR = '#ffd98a'

const SPARKS = 26

/* Three-step toon shading, shared by every part. */
function useToonRamp() {
  return useMemo(() => {
    const tex = new THREE.DataTexture(new Uint8Array([70, 70, 70, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat)
    tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true
    return tex
  }, [])
}

/** One part of the goose: the toon-shaded mesh and its ink outline. */
function Part({ geometry, color, ramp, line = 1.045, position, rotation, scale, meshRef, opacity }: {
  geometry: THREE.BufferGeometry; color: string; ramp: THREE.Texture; line?: number
  position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number
  meshRef?: React.Ref<THREE.Mesh>; opacity?: number
}) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh ref={meshRef} geometry={geometry}>
        <meshToonMaterial color={color} gradientMap={ramp} transparent={opacity !== undefined} opacity={opacity ?? 1} />
      </mesh>
      {line > 0 && (
        <mesh geometry={geometry} scale={line}>
          <meshBasicMaterial color={LINE} side={THREE.BackSide} />
        </mesh>
      )}
    </group>
  )
}

function Bird({ state }: { state: GooseState }) {
  const ramp = useToonRamp()
  const root = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const billTop = useRef<THREE.Group>(null)
  const billBottom = useRef<THREE.Group>(null)
  const wingL = useRef<THREE.Group>(null)
  const wingR = useRef<THREE.Group>(null)
  const lidL = useRef<THREE.Mesh>(null)
  const lidR = useRef<THREE.Mesh>(null)
  const star = useRef<THREE.Mesh>(null)
  const starLight = useRef<THREE.PointLight>(null)
  const sparks = useRef<THREE.InstancedMesh>(null)

  const geo = useMemo(() => ({
    body: new THREE.SphereGeometry(0.6, 32, 24),
    tail: new THREE.SphereGeometry(0.5, 16, 12),
    breast: new THREE.SphereGeometry(0.5, 24, 18),
    strap: new THREE.SphereGeometry(0.2, 16, 12),
    wing: new THREE.SphereGeometry(0.5, 20, 14),
    neck: new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.2, 0.3), new THREE.Vector3(0, 0.48, 0.58), new THREE.Vector3(0, 0.8, 0.48), new THREE.Vector3(0, 1.06, 0.62),
    ]), 24, 0.135, 12, false),
    head: new THREE.SphereGeometry(0.29, 32, 24),
    billTop: new THREE.ConeGeometry(0.13, 0.42, 8),
    billBottom: new THREE.ConeGeometry(0.11, 0.34, 8),
    eye: new THREE.SphereGeometry(0.055, 14, 10),
    glint: new THREE.SphereGeometry(0.017, 8, 6),
    lid: new THREE.SphereGeometry(0.064, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    cheek: new THREE.SphereGeometry(0.085, 12, 8),
    foot: new THREE.SphereGeometry(0.1, 10, 8),
    brim: new THREE.CylinderGeometry(0.31, 0.31, 0.04, 24),
    cone: new THREE.ConeGeometry(0.18, 0.62, 20),
    band: new THREE.CylinderGeometry(0.19, 0.2, 0.06, 20),
    star: new THREE.OctahedronGeometry(0.085, 0),
    spark: new THREE.OctahedronGeometry(1, 0),
  }), [])

  const spark = useMemo(() => Array.from({ length: SPARKS }, (_, i) => ({
    phase: (i / SPARKS) * Math.PI * 2 + Math.random(),
    r: 0.5 + Math.random() * 0.5,
    speed: 0.6 + Math.random() * 0.7,
    size: 0.028 + Math.random() * 0.03,
  })), [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const blink = useRef({ next: 2 + Math.random() * 3, until: 0 })

  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime()
    const talking = state === 'talking', thinking = state === 'thinking', paused = state === 'paused'
    const k = (r: number) => Math.min(1, dt * r)

    if (root.current) {
      const bob = paused ? Math.sin(t * 1.2) * 0.01 : Math.sin(t * 2.1) * 0.045 + (talking ? Math.sin(t * 9) * 0.012 : 0)
      root.current.position.y = bob
      root.current.rotation.z += ((talking ? Math.sin(t * 3.7) * 0.04 : 0) - root.current.rotation.z) * k(6)
      root.current.rotation.x += ((thinking ? 0.12 : paused ? 0.05 : 0) - root.current.rotation.x) * k(4)
      // Stands in three-quarter profile facing the caption, so the neck reads; turns to you when paused.
      root.current.rotation.y += ((paused ? 0.34 : thinking ? 0.75 : 1.05 + Math.sin(t * 0.7) * 0.08) - root.current.rotation.y) * k(4)
    }
    if (head.current) {
      head.current.rotation.x += ((talking ? Math.sin(t * 8.5) * 0.05 : thinking ? -0.1 : 0) - head.current.rotation.x) * k(12)
      head.current.rotation.z += ((thinking ? 0.24 : 0) - head.current.rotation.z) * k(5)
      head.current.rotation.y += ((paused ? -0.3 : 0) - head.current.rotation.y) * k(4)
    }
    const open = talking ? Math.max(0, Math.sin(t * 11) * 0.5 + Math.sin(t * 17.3) * 0.3 + 0.2) * 0.32 : 0
    if (billTop.current) billTop.current.rotation.x += (-open * 0.5 - billTop.current.rotation.x) * k(20)
    if (billBottom.current) billBottom.current.rotation.x += (open - billBottom.current.rotation.x) * k(20)
    // Wings rest folded along the back and lift from the shoulder.
    const raise = paused ? 0 : talking ? Math.max(0, Math.sin(t * 7)) * 0.9 + 0.1 : Math.sin(t * 2.4) * 0.05 + 0.04
    if (wingL.current) wingL.current.rotation.z = raise
    if (wingR.current) wingR.current.rotation.z = -raise
    const b = blink.current
    if (t > b.next) { b.until = t + 0.11; b.next = t + 2.5 + Math.random() * 3.5 }
    const shut = t < b.until ? 1 : 0
    if (lidL.current) lidL.current.scale.y = shut
    if (lidR.current) lidR.current.scale.y = shut
    const glow = thinking ? 1.8 + Math.sin(t * 5) * 0.5 : talking ? 1.2 : 0.5
    if (star.current) { const m = star.current.material as THREE.MeshToonMaterial; m.emissiveIntensity += (glow - m.emissiveIntensity) * k(6) }
    if (starLight.current) starLight.current.intensity += ((thinking ? 1.4 : talking ? 0.8 : 0.2) - starLight.current.intensity) * k(6)
    if (sparks.current) {
      const m = sparks.current
      const cur = (m.userData.alive ?? 0) as number
      const alive = cur + ((talking ? 1 : thinking ? 0.5 : 0) - cur) * k(3)
      m.userData.alive = alive
      spark.forEach((s, i) => {
        const life = ((t * s.speed + s.phase) % 1.6) / 1.6
        const a = s.phase + t * 0.9
        const scale = alive * s.size * (1 - life) * (0.6 + Math.sin(life * Math.PI) * 0.8)
        dummy.position.set(Math.cos(a) * s.r * (0.3 + life * 0.7), -0.1 + life * 1.4, Math.sin(a) * s.r * (0.3 + life * 0.7))
        dummy.scale.setScalar(Math.max(0.0001, scale))
        dummy.updateMatrix()
        m.setMatrixAt(i, dummy.matrix)
      })
      m.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group ref={root}>
      {/* the body: a brown back, low and long; the pale breast under the neck; white under the tail, tail up behind */}
      <Part geometry={geo.body} color={BACK} ramp={ramp} position={[0, 0, -0.05]} scale={[0.82, 0.68, 1.28]} line={1.035} />
      <Part geometry={geo.breast} color={BREAST} ramp={ramp} position={[0, -0.14, 0.3]} scale={[0.86, 0.62, 0.9]} line={0} />
      <Part geometry={geo.tail} color={BACK_SHADE} ramp={ramp} position={[0, 0.2, -0.74]} rotation={[-0.75, 0, 0]} scale={[0.3, 0.14, 0.42]} />
      <Part geometry={geo.tail} color={UNDERTAIL} ramp={ramp} position={[0, -0.08, -0.7]} rotation={[-0.3, 0, 0]} scale={[0.4, 0.16, 0.36]} line={0} />
      {/* wings, folded along the sides, hinged at the shoulder */}
      <group ref={wingL} position={[-0.36, 0.2, 0]}>
        <Part geometry={geo.wing} color={BACK_SHADE} ramp={ramp} position={[-0.06, -0.06, -0.3]} rotation={[0.05, 0, 0.2]} scale={[0.13, 0.34, 1]} />
      </group>
      <group ref={wingR} position={[0.36, 0.2, 0]}>
        <Part geometry={geo.wing} color={BACK_SHADE} ramp={ramp} position={[0.06, -0.06, -0.3]} rotation={[0.05, 0, -0.2]} scale={[0.13, 0.34, 1]} />
      </group>
      {/* the neck: an S from the chest to the head */}
      <Part geometry={geo.neck} color={HEAD} ramp={ramp} line={1.06} />
      {/* the head, forward on the neck */}
      <group ref={head} position={[0, 1.12, 0.64]}>
        <Part geometry={geo.head} color={HEAD} ramp={ramp} scale={[1, 0.96, 1.1]} />
        {/* the chinstrap: a white patch sweeping from behind each eye down under the chin, blushed a little */}
        <Part geometry={geo.strap} color={CHINSTRAP} ramp={ramp} position={[-0.2, -0.07, -0.01]} rotation={[0.15, -0.35, 0.45]} scale={[0.5, 0.8, 1.1]} line={0} />
        <Part geometry={geo.strap} color={CHINSTRAP} ramp={ramp} position={[0.2, -0.07, -0.01]} rotation={[0.15, 0.35, -0.45]} scale={[0.5, 0.8, 1.1]} line={0} />
        <Part geometry={geo.strap} color={CHINSTRAP} ramp={ramp} position={[0, -0.2, 0.04]} scale={[0.85, 0.45, 0.8]} line={0} />
        <Part geometry={geo.cheek} color={BLUSH} ramp={ramp} position={[-0.27, -0.07, 0.06]} rotation={[0, -0.9, 0]} scale={[0.7, 0.45, 0.25]} line={0} opacity={0.5} />
        <Part geometry={geo.cheek} color={BLUSH} ramp={ramp} position={[0.27, -0.07, 0.06]} rotation={[0, 0.9, 0]} scale={[0.7, 0.45, 0.25]} line={0} opacity={0.5} />
        {[-1, 1].map(side => (
          <group key={side} position={[side * 0.16, 0.07, 0.235]}>
            <mesh geometry={geo.eye} scale={1.45}>
              <meshBasicMaterial color={CHINSTRAP} />
            </mesh>
            <Part geometry={geo.eye} color={INK} ramp={ramp} line={0} position={[0, 0, 0.03]} />
            <mesh geometry={geo.glint} position={[side * -0.02, 0.025, 0.075]} scale={1.5}>
              <meshBasicMaterial color="#ffffff" />
            </mesh>
            <mesh ref={side < 0 ? lidL : lidR} geometry={geo.lid} position={[0, 0.015, 0.004]} scale={[1.2, 0, 1.2]}>
              <meshToonMaterial color={HEAD} gradientMap={ramp} />
            </mesh>
          </group>
        ))}
        {/* the bill: flat and forward, in two halves */}
        <group position={[0, -0.04, 0.26]}>
          <group ref={billTop}>
            <Part geometry={geo.billTop} color={BILL} ramp={ramp} position={[0, 0.035, 0.21]} rotation={[Math.PI / 2, 0, 0]} scale={[1.2, 1, 0.62]} line={1.07} />
          </group>
          <group ref={billBottom}>
            <Part geometry={geo.billBottom} color={BILL} ramp={ramp} position={[0, -0.035, 0.17]} rotation={[Math.PI / 2, 0, 0]} scale={[1.1, 1, 0.55]} line={1.07} />
          </group>
        </group>
        {/* the hat, in the ink of the pages, banded in the app's amber */}
        <group position={[0.02, 0.27, -0.05]} rotation={[0.14, 0, -0.2]}>
          <Part geometry={geo.brim} color={HAT} ramp={ramp} position={[0, 0.02, 0]} line={1.03} />
          <Part geometry={geo.cone} color={HAT} ramp={ramp} position={[0, 0.33, 0]} line={1.04} />
          <Part geometry={geo.band} color={HAT_BAND} ramp={ramp} position={[0, 0.08, 0]} line={0} />
          <mesh ref={star} geometry={geo.star} position={[0, 0.7, 0]} rotation={[0, 0, 0.3]}>
            <meshToonMaterial color={STAR} gradientMap={ramp} emissive={STAR} emissiveIntensity={0.5} />
          </mesh>
          <pointLight ref={starLight} position={[0, 0.78, 0.1]} color={STAR} intensity={0.2} distance={2.5} decay={2} />
        </group>
      </group>
      {/* feet, webbed and tucked */}
      <Part geometry={geo.foot} color={BILL} ramp={ramp} position={[-0.15, -0.46, 0.14]} rotation={[0.25, 0, 0]} scale={[1.3, 0.32, 1.8]} line={1.07} />
      <Part geometry={geo.foot} color={BILL} ramp={ramp} position={[0.15, -0.46, 0.14]} rotation={[0.25, 0, 0]} scale={[1.3, 0.32, 1.8]} line={1.07} />
      {/* sparks */}
      <instancedMesh ref={sparks} args={[geo.spark, undefined, SPARKS]} position={[0, 1.1, 0.5]}>
        <meshBasicMaterial color={STAR} transparent opacity={0.9} />
      </instancedMesh>
    </group>
  )
}

/** The goose, in its corner. `state` is what it is doing; nothing else is needed. */
export default function Goose({ state }: { state: GooseState }) {
  return (
    <div className={`goose is-${state}`} aria-hidden>
      <Canvas dpr={[1, 1.5]} camera={{ fov: 33, near: 0.1, far: 20, position: [1.7, 1.2, 5.1] }} gl={{ alpha: true, antialias: true }}
        onCreated={({ gl, camera }) => { gl.setClearColor(0x000000, 0); camera.lookAt(0, 0.62, 0.1) }}>
        {/* Warm key from the upper right, a cool fill from behind; toon shading turns them into two flat tones. */}
        <ambientLight intensity={0.9} color="#fff1dc" />
        <directionalLight position={[3, 4, 3]} intensity={1.5} color="#ffe6c4" />
        <directionalLight position={[-3, 1, -2]} intensity={0.45} color="#a9b7d6" />
        <Bird state={state} />
      </Canvas>
    </div>
  )
}
