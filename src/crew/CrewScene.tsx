import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Billboard, Html, Sparkles } from '@react-three/drei'
import { AnimatePresence, motion } from 'motion/react'
import * as THREE from 'three'
import type { CrewEvent } from '../plan/events'
import Figure from './Figure'
import { CREW, MEMBER, fold, type LedgerEntry } from './roster'

/* The crew at work.
 *
 * Eight people stand in a ring around a table. Each is one of the planner's
 * agents or tools, and when its step is running it leans over its work, and when
 * a result lands a small light leaves its hands, arcs to the middle of the table
 * and is written into the ledger, which hangs above it and is the plan's actual
 * running record. The scene is a pure function of the crew's event stream, so it
 * can be replayed from a recording and needs no state of its own.
 */

const RADIUS = 4.3
const angleOf = (i: number) => (i / CREW.length) * Math.PI * 2 + Math.PI / CREW.length

export default function CrewScene({ events, className }: { events: CrewEvent[]; className?: string }) {
  const { status, ledger } = useMemo(() => fold(events), [events])
  return (
    <Canvas className={className} dpr={[1, 1.6]} camera={{ position: [0, 10.2, 17.6], fov: 34 }} gl={{ alpha: true, antialias: true }}>
      <hemisphereLight args={['#a9bcff', '#2a1f16', .9]} />
      <directionalLight position={[5, 9, 6]} intensity={1.7} color="#ffe9c9" />
      <directionalLight position={[-6, 4, -7]} intensity={.8} color="#7fa6ff" />
      <pointLight position={[0, 3.2, 0]} intensity={14} distance={9} color="#f0b45e" />
      <Sway />
      <Floor />
      {CREW.map((m, i) => (
        <Figure key={m.id} member={m} index={i} angle={angleOf(i)} radius={RADIUS} status={status[m.id]} />
      ))}
      <Table ledger={ledger} />
      <Motes ledger={ledger} />
      <Sparkles count={70} scale={[13, 5, 13]} size={2.4} speed={.25} opacity={.5} color="#f0b45e" position={[0, 2.4, 0]} />
    </Canvas>
  )
}

/** The camera drifts: a still frame reads as a screenshot, a slow drift reads as a room. */
function Sway() {
  const { camera, size } = useThree()
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    // Stand far enough back that the whole ring fits the panel, whatever its shape.
    const fov = (camera as THREE.PerspectiveCamera).fov * Math.PI / 180
    const d = THREE.MathUtils.clamp(6.9 / (Math.tan(fov / 2) * (size.width / size.height)), 13.5, 26)
    camera.position.set(Math.sin(t * .13) * 1.6, d * .5 + Math.sin(t * .17) * .25, d * .86)
    camera.lookAt(0, 1.2, 0)
  })
  return null
}

function Floor() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.02, 0]}>
        <circleGeometry args={[7.6, 72]} />
        <meshStandardMaterial color="#0d0f15" roughness={.85} metalness={.25} transparent opacity={.72} />
      </mesh>
      {[5.15, 6.9].map((r, i) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <ringGeometry args={[r, r + .02, 128]} />
          <meshBasicMaterial color="#f0b45e" transparent opacity={i ? .1 : .22} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

/** The table in the middle, and the ledger floating over it. */
function Table({ ledger }: { ledger: LedgerEntry[] }) {
  const halo = useRef<THREE.Mesh>(null)
  const last = useRef(0)
  const kick = useRef(0)
  useFrame(({ clock }, dt) => {
    if (ledger.length !== last.current) { last.current = ledger.length; kick.current = 1 }
    kick.current = Math.max(0, kick.current - dt * 1.8)
    const m = halo.current!.material as THREE.MeshBasicMaterial
    m.opacity = .32 + .5 * kick.current
    halo.current!.scale.setScalar(1 + kick.current * .22 + Math.sin(clock.elapsedTime * 1.4) * .02)
  })
  return (
    <group>
      <mesh position={[0, .12, 0]}>
        <cylinderGeometry args={[1.15, 1.3, .24, 48]} />
        <meshStandardMaterial color="#14161d" roughness={.5} metalness={.4} emissive="#f0b45e" emissiveIntensity={.05} />
      </mesh>
      <mesh ref={halo} rotation={[-Math.PI / 2, 0, 0]} position={[0, .26, 0]}>
        <ringGeometry args={[1.02, 1.12, 64]} />
        <meshBasicMaterial color="#f0b45e" transparent opacity={.35} depthWrite={false} />
      </mesh>
      <Billboard position={[0, 4.1, 0]}>
        <Html center transform distanceFactor={5.6} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <Ledger entries={ledger} />
        </Html>
      </Billboard>
    </group>
  )
}

function Ledger({ entries }: { entries: LedgerEntry[] }) {
  const shown = entries.slice(-6)
  return (
    <div className="cs-ledger">
      <div className="cs-ledger-head"><span>The ledger</span><b>{entries.length}</b></div>
      <ul>
        <AnimatePresence initial={false}>
          {shown.map(e => (
            <motion.li key={e.id} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, height: 0 }} transition={{ duration: .5, ease: [.22, .9, .24, 1] }}
              className={e.failed ? 'is-failed' : ''} style={{ ['--c' as string]: MEMBER[e.agent].colour }}>
              <i /><span><b>{MEMBER[e.agent].name}</b> {e.text.length > 92 ? e.text.slice(0, 91) + '…' : e.text}</span>
            </motion.li>
          ))}
        </AnimatePresence>
        {!shown.length && <li className="cs-empty"><span>Waiting for the crew…</span></li>}
      </ul>
    </div>
  )
}

/** When a result is written, a light carries it from the hands that made it to the table. */
function Motes({ ledger }: { ledger: LedgerEntry[] }) {
  const N = 28
  const pool = useRef<(THREE.Mesh | null)[]>([])
  const live = useRef<{ from: THREE.Vector3; ctrl: THREE.Vector3; t: number; colour: THREE.Color }[]>([])
  const seen = useRef(0)
  const to = useMemo(() => new THREE.Vector3(0, 1.9, 0), [])

  useEffect(() => {
    for (const e of ledger.slice(seen.current)) {
      const i = CREW.findIndex(m => m.id === e.agent)
      if (i < 0) continue
      const a = angleOf(i)
      const from = new THREE.Vector3(Math.sin(a) * (RADIUS - .8), 1.35, Math.cos(a) * (RADIUS - .8))
      const ctrl = from.clone().lerp(to, .5).add(new THREE.Vector3(0, 2.2, 0))
      const colour = new THREE.Color(MEMBER[e.agent].colour)
      // A little burst, not a single dot: results feel heavier than that.
      for (let k = 0; k < 4; k++) live.current.push({ from, ctrl: ctrl.clone().add(new THREE.Vector3((Math.random() - .5) * .8, Math.random() * .6, (Math.random() - .5) * .8)), t: -k * .07, colour })
    }
    seen.current = ledger.length
  }, [ledger, to])

  const p = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, dt) => {
    const items = live.current
    for (let i = items.length - 1; i >= 0; i--) { items[i].t += dt / 1.15; if (items[i].t >= 1) items.splice(i, 1) }
    for (let i = 0; i < N; i++) {
      const mesh = pool.current[i]; if (!mesh) continue
      const it = items[i]
      if (!it || it.t < 0) { mesh.visible = false; continue }
      const t = it.t, u = 1 - t
      p.set(0, 0, 0).addScaledVector(it.from, u * u).addScaledVector(it.ctrl, 2 * u * t).addScaledVector(to, t * t)
      mesh.visible = true
      mesh.position.copy(p)
      mesh.scale.setScalar(.09 + Math.sin(t * Math.PI) * .09)
      ;(mesh.material as THREE.MeshBasicMaterial).color.copy(it.colour)
    }
  })

  return (
    <group>
      {Array.from({ length: N }, (_, i) => (
        <mesh key={i} ref={el => { pool.current[i] = el }} visible={false}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshBasicMaterial transparent opacity={.95} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}
