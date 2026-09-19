import { useMemo, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/* What is drawn over everything: the blink (the whole view to black and back) and the
 * vignette (the edges of the view closed in while the person is being moved, which takes
 * away the streaming periphery that does most of the harm).
 *
 * It is a quad written straight into clip space, so it needs no position: each eye draws
 * it over its own whole view, locked to the head with no lag, however the person's space
 * is scaled or moved. The vignette is measured as an angle from where each eye is actually
 * pointing (a headset's lenses are off-centre in their views, by a different amount in each
 * eye), so the two eyes see the same ring and do not fight over its edge. */

export type VeilState = { fade: number; vignette: number }

const OPEN = 1.6, CLOSED = .62            // tan of the clear half-angle: wide open, and about 32° at full speed

export default function Veil({ state }: { state: MutableRefObject<VeilState> }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { fade: { value: 1 }, inner: { value: OPEN } },
    vertexShader: /* glsl */`
      varying vec2 ray;
      void main() {
        gl_Position = vec4(position.xy, 0., 1.);
        ray = vec2((position.x + projectionMatrix[2][0]) / projectionMatrix[0][0], (position.y + projectionMatrix[2][1]) / projectionMatrix[1][1]);
      }`,
    fragmentShader: /* glsl */`
      uniform float fade, inner;
      varying vec2 ray;
      void main() {
        float edge = smoothstep(inner, inner + .4, length(ray));
        gl_FragColor = vec4(0., 0., 0., max(fade, edge));
      }`,
  }), [])
  const eased = useMemo(() => ({ v: 0 }), [])
  useFrame((_, dt) => {
    eased.v += (state.current.vignette - eased.v) * (1 - Math.exp(-Math.min(dt, .05) * 4))     // it closes and opens over about half a second
    material.uniforms.fade.value = state.current.fade
    material.uniforms.inner.value = THREE.MathUtils.lerp(OPEN, CLOSED, eased.v)
  })
  return (
    <mesh frustumCulled={false} renderOrder={999} raycast={() => null} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}
