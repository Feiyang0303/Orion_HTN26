import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Hat, Member, Prop, Status } from './roster'

/* One member of the crew, built from a few primitives: a tapered coat, a head, two
 * arms on shoulder pivots, and a prop that says what the job is. There is no model
 * file and no rig: the character comes from proportion, colour and, above all,
 * motion. A figure at rest breathes and looks around; working, it leans in, its
 * head drops and its writing arm moves; finished, it hops; failed, it shakes its
 * head. Those four states are the whole vocabulary, and they are enough to read
 * the state of the crew across a room. */

const dark = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k)

let glowTexture: THREE.CanvasTexture | null = null
/** A soft radial spot, drawn once and shared by every figure's floor glow. */
function glow() {
  if (glowTexture) return glowTexture
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.35, 'rgba(255,255,255,.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128)
  glowTexture = new THREE.CanvasTexture(c)
  return glowTexture
}

export default function Figure({ member, angle, radius, status, index }: {
  member: Member; angle: number; radius: number; status: Status; index: number
}) {
  const root = useRef<THREE.Group>(null)
  const torso = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const eyes = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const spot = useRef<THREE.Sprite>(null)
  const st = useRef({ work: 0, hop: 0, shake: 0, serial: 0, tint: 0 })

  const colour = useMemo(() => new THREE.Color(member.colour), [member.colour])
  const red = useMemo(() => new THREE.Color('#ff5a5a'), [])
  const coat = useMemo(() => dark(member.colour, .26), [member.colour])
  const tex = useMemo(() => glow(), [])

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, .05), t = clock.elapsedTime + index * 1.7, s = st.current
    s.work += ((status.state === 'working' ? 1 : 0) - s.work) * (1 - Math.exp(-dt * 5))
    if (status.serial !== s.serial) {
      s.serial = status.serial
      if (status.state === 'done') s.hop = 1
      if (status.state === 'failed') { s.shake = 1; s.tint = 1 }
    }
    s.hop = Math.max(0, s.hop - dt * 1.5)
    s.shake = Math.max(0, s.shake - dt * 1.1)
    s.tint = Math.max(0, s.tint - dt * .35)
    const w = s.work

    root.current!.position.y = s.hop > 0 ? Math.sin((1 - s.hop) * Math.PI) * .3 * Math.min(1, s.hop * 2.4) : 0
    torso.current!.rotation.x = .16 * w + Math.sin(t * 1.3) * .012
    torso.current!.scale.y = 1 + Math.sin(t * 1.4) * .012
    head.current!.rotation.x = .25 * w + Math.sin(t * .9) * .03
    head.current!.rotation.y = Math.sin(t * .5) * .18 * (1 - w) + Math.sin(t * 7) * .05 * w
    head.current!.rotation.z = Math.sin(s.shake * 34) * .14 * s.shake
    armR.current!.rotation.x = THREE.MathUtils.lerp(.12 + Math.sin(t * 1.2) * .03, -1.15 + Math.sin(t * 11) * .2, w)
    armL.current!.rotation.x = THREE.MathUtils.lerp(.1 + Math.sin(t * 1.1 + 1) * .03, -.95 + Math.sin(t * 3) * .06, w)
    const blink = Math.sin(t * .8) > .985 ? .1 : 1
    eyes.current!.scale.y += (blink - eyes.current!.scale.y) * .5

    const m = ring.current!.material as THREE.MeshBasicMaterial
    m.color.copy(colour).lerp(red, s.tint)
    m.opacity = .3 + .6 * w + .5 * s.hop
    ring.current!.scale.setScalar(1 + Math.sin(t * 3) * .05 * w + s.hop * .18)
    const sm = spot.current!.material as THREE.SpriteMaterial
    sm.color.copy(colour).lerp(red, s.tint)
    sm.opacity = .16 + .5 * w + .45 * s.hop
  })

  const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius
  const skin = member.skin

  return (
    <group position={[x, 0, z]} rotation={[0, angle + Math.PI, 0]}>
      <group ref={root}>
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, .03, 0]}>
          <torusGeometry args={[.68, .022, 8, 64]} />
          <meshBasicMaterial color={member.colour} transparent opacity={.3} depthWrite={false} />
        </mesh>
        <sprite ref={spot} scale={[2.6, 2.6, 1]} position={[0, .04, 0]}>
          <spriteMaterial map={tex} color={member.colour} transparent opacity={.2} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>

        <group ref={torso}>
          {/* coat */}
          <mesh position={[0, .64, 0]}>
            <cylinderGeometry args={[.3, .5, 1.28, 28]} />
            <meshStandardMaterial color={coat} roughness={.72} metalness={.05} emissive={member.colour} emissiveIntensity={.05} />
          </mesh>
          <mesh position={[0, 1.22, 0]} scale={[1, .62, .82]}>
            <sphereGeometry args={[.4, 24, 16]} />
            <meshStandardMaterial color={coat} roughness={.72} emissive={member.colour} emissiveIntensity={.05} />
          </mesh>
          {/* belt and collar carry the colour */}
          <mesh position={[0, .86, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[.375, .035, 8, 40]} />
            <meshStandardMaterial color={member.colour} emissive={member.colour} emissiveIntensity={.45} roughness={.4} />
          </mesh>
          <mesh position={[0, 1.42, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[.2, .05, 8, 32]} />
            <meshStandardMaterial color={member.colour} emissive={member.colour} emissiveIntensity={.35} roughness={.45} />
          </mesh>

          {/* head */}
          <group ref={head} position={[0, 1.66, 0]}>
            <mesh>
              <sphereGeometry args={[.27, 28, 20]} />
              <meshStandardMaterial color={skin} roughness={.85} />
            </mesh>
            <group ref={eyes} position={[0, .02, .252]}>
              <mesh position={[-.095, 0, 0]}><sphereGeometry args={[.045, 12, 10]} /><meshBasicMaterial color="#15110e" /></mesh>
              <mesh position={[.095, 0, 0]}><sphereGeometry args={[.045, 12, 10]} /><meshBasicMaterial color="#15110e" /></mesh>
            </group>
            <HatMesh hat={member.hat} colour={member.colour} />
          </group>

          {/* arms hang from the shoulders and swing forward to work */}
          <group ref={armR} position={[-.4, 1.27, 0]}>
            <mesh position={[0, -.3, 0]}><capsuleGeometry args={[.085, .44, 4, 10]} /><meshStandardMaterial color={coat} roughness={.72} /></mesh>
            <mesh position={[0, -.62, 0]}><sphereGeometry args={[.085, 12, 10]} /><meshStandardMaterial color={skin} roughness={.85} /></mesh>
          </group>
          <group ref={armL} position={[.4, 1.27, 0]}>
            <mesh position={[0, -.3, 0]}><capsuleGeometry args={[.085, .44, 4, 10]} /><meshStandardMaterial color={coat} roughness={.72} /></mesh>
            <mesh position={[0, -.62, 0]}><sphereGeometry args={[.085, 12, 10]} /><meshStandardMaterial color={skin} roughness={.85} /></mesh>
          </group>

          <group position={[0, 1.2, .78]}><PropMesh kind={member.prop} colour={member.colour} work={st} /></group>
        </group>

        <Html position={[0, 2.62, 0]} center distanceFactor={12} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`cs-tag is-${status.state}`} style={{ ['--c' as string]: member.colour }}>
            <div className="cs-name"><i />{member.name}<em>{member.kind}</em></div>
            <div className="cs-say">{status.state === 'idle' ? '' : status.detail}</div>
          </div>
        </Html>
      </group>
    </group>
  )
}

function HatMesh({ hat, colour }: { hat: Hat; colour: string }) {
  const hair = '#221c18'
  const felt = dark(colour, .55)
  return (
    <>
      {hat !== 'beret' && hat !== 'hood' && hat !== 'cap' && (
        <mesh position={[0, .05, -.02]} rotation={[-.15, 0, 0]}>
          <sphereGeometry args={[.285, 24, 14, 0, Math.PI * 2, 0, Math.PI * .52]} /><meshStandardMaterial color={hair} roughness={.9} />
        </mesh>
      )}
      {hat === 'cap' && (<>
        <mesh position={[0, .07, 0]}><sphereGeometry args={[.295, 24, 14, 0, Math.PI * 2, 0, Math.PI * .5]} /><meshStandardMaterial color={felt} emissive={colour} emissiveIntensity={.12} roughness={.7} /></mesh>
        <mesh position={[0, .08, .25]} rotation={[.2, 0, 0]}><boxGeometry args={[.3, .025, .17]} /><meshStandardMaterial color={felt} roughness={.7} /></mesh>
      </>)}
      {hat === 'hood' && (
        <mesh position={[0, .02, -.03]} rotation={[-.28, 0, 0]}><sphereGeometry args={[.34, 24, 16, 0, Math.PI * 2, 0, Math.PI * .68]} /><meshStandardMaterial color={felt} emissive={colour} emissiveIntensity={.14} roughness={.8} side={THREE.DoubleSide} /></mesh>
      )}
      {hat === 'beret' && (
        <mesh position={[.03, .25, 0]} rotation={[0, 0, -.12]}><cylinderGeometry args={[.3, .27, .08, 28]} /><meshStandardMaterial color={felt} emissive={colour} emissiveIntensity={.16} roughness={.85} /></mesh>
      )}
      {hat === 'band' && (
        <mesh position={[0, .14, 0]} rotation={[Math.PI / 2 - .1, 0, 0]}><torusGeometry args={[.262, .028, 8, 36]} /><meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={.5} roughness={.4} /></mesh>
      )}
      {hat === 'bun' && (
        <mesh position={[0, .3, -.12]}><sphereGeometry args={[.11, 14, 12]} /><meshStandardMaterial color={hair} roughness={.9} /></mesh>
      )}
    </>
  )
}

/** The prop each role carries: a few shapes that say the job, and that move when it is being done. */
function PropMesh({ kind, colour, work }: { kind: Prop; colour: string; work: React.MutableRefObject<{ work: number }> }) {
  const a = useRef<THREE.Object3D>(null)
  const b = useRef<THREE.Object3D>(null)
  const c = useRef<THREE.Object3D>(null)
  const g = useRef<THREE.Group>(null)
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: .5, roughness: .35, metalness: .1 }), [colour])
  const soft = useMemo(() => new THREE.MeshStandardMaterial({ color: dark(colour, .4), emissive: colour, emissiveIntensity: .12, roughness: .6, transparent: true, opacity: .9 }), [colour])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime, w = work.current.work
    mat.emissiveIntensity = .4 + 1.1 * w
    g.current!.position.y = Math.sin(t * 1.6) * .03
    switch (kind) {
      case 'globe': a.current!.rotation.y = t * (.5 + w * 3); break
      case 'compass': b.current!.rotation.z = t * (.6 + w * 7); break
      case 'clock': a.current!.rotation.z = -t * (1 + w * 12); b.current!.rotation.z = -t * (.1 + w * 1); break
      case 'lens': g.current!.position.x = Math.sin(t * (1 + w * 4)) * (.06 + .18 * w); break
      case 'quill': a.current!.position.x = Math.sin(t * 11) * .05 * w; a.current!.rotation.z = -.6 + Math.sin(t * 11) * .12 * w; break
      case 'stamp': a.current!.position.y = .12 + (w > .3 ? Math.max(0, Math.sin(t * 5)) * -.13 : 0); break
      case 'mic': [a, b, c].forEach((r, i) => { const k = ((t * (.8 + w * 1.6) + i / 3) % 1); r.current!.scale.setScalar(.6 + k * 1.1 * (.4 + w)); (((r.current as THREE.Mesh).material) as THREE.MeshBasicMaterial).opacity = (1 - k) * (.15 + .5 * w) }); break
    }
  })

  return (
    <group ref={g}>
      {kind === 'globe' && (<>
        <mesh ref={a as React.RefObject<THREE.Mesh>} material={soft}><sphereGeometry args={[.24, 20, 14]} /></mesh>
        <mesh rotation={[0, 0, .4]}><torusGeometry args={[.3, .012, 6, 40]} /><primitive object={mat} attach="material" /></mesh>
      </>)}
      {kind === 'spyglass' && (<group rotation={[.5, 0, -.25]}>
        <mesh><cylinderGeometry args={[.05, .07, .55, 14]} /><primitive object={mat} attach="material" /></mesh>
        <mesh position={[0, .3, 0]}><cylinderGeometry args={[.085, .07, .06, 16]} /><primitive object={mat} attach="material" /></mesh>
      </group>)}
      {kind === 'compass' && (<>
        <mesh><torusGeometry args={[.25, .02, 8, 48]} /><primitive object={mat} attach="material" /></mesh>
        <mesh material={soft}><circleGeometry args={[.24, 32]} /></mesh>
        <mesh ref={b as React.RefObject<THREE.Mesh>}><coneGeometry args={[.05, .3, 4]} /><primitive object={mat} attach="material" /></mesh>
      </>)}
      {kind === 'clock' && (<>
        <mesh><torusGeometry args={[.25, .02, 8, 48]} /><primitive object={mat} attach="material" /></mesh>
        <mesh material={soft}><circleGeometry args={[.24, 32]} /></mesh>
        <group ref={a as React.RefObject<THREE.Group>}><mesh position={[0, .1, .01]}><boxGeometry args={[.02, .2, .01]} /><primitive object={mat} attach="material" /></mesh></group>
        <group ref={b as React.RefObject<THREE.Group>}><mesh position={[0, .065, .015]}><boxGeometry args={[.03, .13, .01]} /><primitive object={mat} attach="material" /></mesh></group>
      </>)}
      {kind === 'lens' && (<group rotation={[0, 0, -.5]}>
        <mesh><torusGeometry args={[.19, .022, 8, 40]} /><primitive object={mat} attach="material" /></mesh>
        <mesh material={soft}><circleGeometry args={[.18, 28]} /></mesh>
        <mesh position={[0, -.32, 0]}><cylinderGeometry args={[.025, .025, .26, 8]} /><primitive object={mat} attach="material" /></mesh>
      </group>)}
      {kind === 'quill' && (<>
        <mesh material={soft} rotation={[-.25, 0, 0]}><boxGeometry args={[.42, .55, .012]} /></mesh>
        <group ref={a as React.RefObject<THREE.Group>} position={[.02, .02, .05]} rotation={[0, 0, -.6]}>
          <mesh position={[0, .16, 0]}><coneGeometry args={[.025, .34, 6]} /><primitive object={mat} attach="material" /></mesh>
        </group>
      </>)}
      {kind === 'stamp' && (<>
        <mesh position={[0, -.14, 0]} material={soft}><boxGeometry args={[.5, .04, .34]} /></mesh>
        <group ref={a as React.RefObject<THREE.Group>} position={[0, .12, 0]}>
          <mesh><cylinderGeometry args={[.11, .13, .1, 18]} /><primitive object={mat} attach="material" /></mesh>
          <mesh position={[0, .12, 0]}><cylinderGeometry args={[.035, .035, .16, 10]} /><primitive object={mat} attach="material" /></mesh>
        </group>
      </>)}
      {kind === 'mic' && (<>
        <mesh position={[0, .02, 0]}><capsuleGeometry args={[.07, .14, 6, 12]} /><primitive object={mat} attach="material" /></mesh>
        <mesh position={[0, -.2, 0]}><cylinderGeometry args={[.015, .015, .26, 8]} /><primitive object={mat} attach="material" /></mesh>
        {[a, b, c].map((r, i) => (
          <mesh key={i} ref={r as React.RefObject<THREE.Mesh>} position={[0, .02, 0]}><ringGeometry args={[.2, .215, 40]} /><meshBasicMaterial color={colour} transparent opacity={.3} side={THREE.DoubleSide} depthWrite={false} /></mesh>
        ))}
      </>)}
    </group>
  )
}
