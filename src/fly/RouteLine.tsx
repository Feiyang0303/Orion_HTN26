import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { Transport } from '../types'
import Icon from '../ui/Icon'
import { legStyle } from './legStyle'

/* One leg of a journey drawn on the city in the manner of how it is travelled (see
 * legStyle), with a light that runs along it in the direction of travel and, when
 * asked, a small label at its middle saying how long it takes. */

const noHit = () => null

export default function RouteLine({ pts, colour, transport, estimated, dim, lift = 3, label }: {
  /** Already on the ground and smoothed (routeLine.smoothHeights). */
  pts: THREE.Vector3[]
  colour: string
  transport: Transport
  estimated?: boolean
  dim?: boolean
  lift?: number
  label?: string
}) {
  const style = legStyle(transport, estimated)
  const line = useMemo(() => pts.map(p => [p.x, p.y + lift, p.z] as [number, number, number]), [pts, lift])
  const cum = useMemo(() => {
    const c = [0]
    for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + pts[i].distanceTo(pts[i - 1]))
    return c
  }, [pts])
  const spark = useRef<THREE.Mesh>(null)
  const w = dim ? style.width * .6 : style.width
  const o = dim ? .35 : style.opacity

  useFrame(({ clock }) => {
    const m = spark.current, total = cum[cum.length - 1]
    if (!m || dim || total < 1) return
    const s = (clock.elapsedTime * style.pulseMps) % (total + 60)     // a short pause at the far end before it starts again
    if (s > total) { m.visible = false; return }
    m.visible = true
    let hi = cum.findIndex(v => v >= s); if (hi < 1) hi = 1
    const t = (s - cum[hi - 1]) / Math.max(1e-6, cum[hi] - cum[hi - 1])
    m.position.lerpVectors(pts[hi - 1], pts[hi], t); m.position.y += lift + 1
  })

  if (pts.length < 2) return null
  const mid = pts[pts.length >> 1]
  return (
    <>
      {style.glow && <Line points={line} color={colour} lineWidth={w * 2.8} transparent opacity={dim ? .06 : .16} raycast={noHit} depthWrite={false} />}
      <Line points={line} color={colour} lineWidth={w} transparent opacity={o} raycast={noHit}
        dashed={!!style.dash} dashSize={style.dash?.on} gapSize={style.dash?.off} />
      {!dim && (
        <mesh ref={spark} raycast={noHit} visible={false}>
          <sphereGeometry args={[7, 12, 8]} /><meshBasicMaterial color="#fff3d6" transparent opacity={.9} depthTest={false} toneMapped={false} />
        </mesh>
      )}
      {label && !dim && (
        <Html position={[mid.x, mid.y + lift + 14, mid.z]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div className="route-pill" style={{ ['--c' as string]: colour }}><Icon name={transport} size={13} />{label}{estimated ? ' · est.' : ''}</div>
        </Html>
      )}
    </>
  )
}
