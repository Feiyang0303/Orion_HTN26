import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { LatLon } from '../types'
import { coastDistance, isLand } from './landMask'
import { toSphere } from './geo'

/* The globe. Drawn, not textured: the continents are tens of thousands of points
 * placed on the land, thick along the shores and thinning inland, so they read as
 * marks on a chart and not as a photograph of Earth. That keeps it in the same
 * visual language as the rest of the product, and makes it cheap enough to leave
 * running behind every screen.
 *
 * It does three jobs. Before there is a city it turns slowly. When a city is
 * chosen it turns to face the camera and the land around that city lights up in
 * amber, with a wave that goes out across the continent: the place has been
 * found. And while the crew works it stays turned there, as the thing the work is
 * being done to. */

export const R = 1

type Land = { position: Float32Array; scatter: Float32Array; colour: Float32Array; seed: Float32Array }

function stipple(samples: number): Land {
  const golden = Math.PI * (3 - Math.sqrt(5))
  const pos: number[] = [], sca: number[] = [], col: number[] = [], seed: number[] = []
  const shore = new THREE.Color('#e6d5ad'), inland = new THREE.Color('#8f7f5f')
  const rand = mulberry(7)
  for (let i = 0; i < samples; i++) {
    const y = 1 - (i / (samples - 1)) * 2
    const rad = Math.sqrt(Math.max(0, 1 - y * y))
    const th = i * golden
    const lat = Math.asin(y) * 180 / Math.PI
    const lon = Math.atan2(Math.sin(th) * rad, Math.cos(th) * rad) * 180 / Math.PI
    if (!isLand(lat, lon)) continue
    const near = coastDistance(lat, lon, 3)                // 1 = shoreline, 4 = deep inland
    if (rand() > (near <= 1 ? 1 : near === 2 ? .7 : .34)) continue   // draw the shore, hint the interior
    const v = toSphere(lat, lon, R * 1.002)
    pos.push(v.x, v.y, v.z)
    const s = v.clone().multiplyScalar(1.9 + rand() * 2.4)
    sca.push(s.x, s.y, s.z)
    const c = shore.clone().lerp(inland, Math.min(1, (near - 1) / 3) * .8)
    col.push(c.r, c.g, c.b)
    seed.push(rand())
  }
  return { position: new Float32Array(pos), scatter: new Float32Array(sca), colour: new Float32Array(col), seed: new Float32Array(seed) }
}

/** A tiny seeded generator: the same globe every time, so it does not shimmer between renders. */
function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const VERT = /* glsl */`
  attribute vec3 aScatter; attribute vec3 aColour; attribute float aSeed;
  uniform float uTime, uReveal, uSize, uPx, uGlow, uWave;
  uniform vec3 uCity;
  varying vec3 vColour; varying float vAlpha; varying float vHeat;
  void main() {
    float e = 1.0 - pow(1.0 - clamp(uReveal, 0.0, 1.0), 3.0);
    float st = clamp((e - aSeed * 0.4) / 0.6, 0.0, 1.0);
    vec3 p = mix(aScatter, position, 1.0 - pow(1.0 - st, 2.0));
    vec3 n = normalize(position);
    float d = acos(clamp(dot(n, normalize(uCity)), -1.0, 1.0));
    float near = uGlow * smoothstep(0.36, 0.0, d);
    float wave = uGlow * exp(-pow((d - uWave * 1.9) * 9.0, 2.0)) * (1.0 - uWave);
    float heat = clamp(near * 1.4 + wave, 0.0, 1.0);
    float tw = 0.85 + 0.15 * sin(uTime * 2.0 + aSeed * 60.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // dim what is on the far side of the sphere; it is still there, just not competing
    float facing = dot(normalize(normalMatrix * n), vec3(0.0, 0.0, 1.0));
    vAlpha = mix(0.16, 1.0, smoothstep(-0.25, 0.35, facing)) * tw * st;
    vColour = aColour; vHeat = heat;
    gl_PointSize = uSize * uPx * (1.0 + heat * 2.2) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`
const FRAG = /* glsl */`
  varying vec3 vColour; varying float vAlpha; varying float vHeat;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.15, r);
    vec3 amber = vec3(1.0, 0.72, 0.32);
    vec3 col = mix(vColour, amber, vHeat) * (1.3 + vHeat * 1.4);
    gl_FragColor = vec4(col, vAlpha * soft);
  }`

const ATMO_VERT = /* glsl */`
  varying vec3 vN; varying vec3 vV;
  void main() { vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`
const ATMO_FRAG = /* glsl */`
  varying vec3 vN; varying vec3 vV; uniform float uPulse;
  void main() {
    float f = pow(1.0 - abs(dot(vN, vV)), 2.6);
    vec3 col = mix(vec3(0.38, 0.55, 1.0), vec3(1.0, 0.72, 0.36), 0.35 + 0.25 * uPulse);
    gl_FragColor = vec4(col, f * (0.55 + 0.35 * uPulse));
  }`

let glowTex: THREE.CanvasTexture | null = null
function glow() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')!, grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.3, 'rgba(255,255,255,.4)'); grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128)
  glowTex = new THREE.CanvasTexture(c)
  return glowTex
}

export default function Globe({ city, cityWorld, energy, children }: {
  children?: React.ReactNode
  city: LatLon | null
  /** Filled every frame with where the city is in the world, so effects can aim at it. */
  cityWorld: MutableRefObject<THREE.Vector3>
  /** 0..1, how busy the crew is: brightens the atmosphere and quickens the wave. */
  energy: MutableRefObject<number>
}) {
  const { gl } = useThree()
  const spin = useRef<THREE.Group>(null)
  const marker = useRef<THREE.Group>(null)
  const rings = useRef<(THREE.Mesh | null)[]>([])
  const beam = useRef<THREE.Mesh>(null)
  const land = useMemo(() => stipple(72000), [])
  const cityDir = useRef(new THREE.Vector3(0, 0, 1))
  const s = useRef({ reveal: 0, glow: 0, wave: 1, lit: false, waveHold: 0, pulse: 0 })
  const tex = useMemo(() => glow(), [])

  const points = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(land.position, 3))
    geo.setAttribute('aScatter', new THREE.BufferAttribute(land.scatter, 3))
    geo.setAttribute('aColour', new THREE.BufferAttribute(land.colour, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(land.seed, 1))
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uSize: { value: .024 }, uPx: { value: 800 }, uGlow: { value: 0 }, uWave: { value: 1 }, uCity: { value: new THREE.Vector3(0, 0, 1) } },
    })
    return { geo, mat }
  }, [land])

  const atmo = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPulse: { value: 0 } },
  }), [])

  const graticule = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 4) { pts.push(toSphere(lat, lon, 1.001), toSphere(lat, lon + 4, 1.001)) }
    for (let lon = -180; lon < 180; lon += 30) for (let lat = -88; lat < 88; lat += 4) { pts.push(toSphere(lat, lon, 1.001), toSphere(lat + 4, lon, 1.001)) }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [])

  // A new city: aim at it, and let the light wash out across the land again.
  useEffect(() => {
    if (!city) { s.current.lit = false; return }
    cityDir.current.copy(toSphere(city.lat, city.lon, 1)).normalize()
    points.mat.uniforms.uCity.value.copy(cityDir.current)
    marker.current?.position.copy(cityDir.current)
    marker.current?.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cityDir.current)
    s.current.lit = true; s.current.wave = 0
  }, [city, points])

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, .05), t = clock.elapsedTime, st = s.current
    st.reveal = Math.min(1, st.reveal + dt / 2.6)
    st.glow += ((st.lit ? 1 : 0) - st.glow) * (1 - Math.exp(-dt * 2.4))
    st.pulse += (energy.current - st.pulse) * (1 - Math.exp(-dt * 3))
    // The wave sweeps out once when a city is found, then again gently while the crew is busy.
    st.wave += dt * (.42 + .3 * st.pulse)
    if (st.wave > 1.6 + (1 - st.pulse) * 2.4) st.wave = 0
    const u = points.mat.uniforms
    u.uTime.value = t; u.uReveal.value = st.reveal; u.uGlow.value = st.glow; u.uWave.value = Math.min(1, st.wave)
    u.uPx.value = gl.domElement.height * .5
    atmo.uniforms.uPulse.value = .35 + .65 * st.pulse

    const g = spin.current!
    if (!st.lit) g.rotation.y += dt * .07
    else {
      // Turn the city to face the viewer, slightly from above, eased.
      const want = new THREE.Quaternion().setFromUnitVectors(cityDir.current, new THREE.Vector3(0, .22, 1).normalize())
      g.quaternion.slerp(want, 1 - Math.exp(-dt * 1.9))
    }

    if (marker.current) {
      marker.current.visible = st.glow > .02
      const k = st.glow
      rings.current.forEach((m, i) => {
        if (!m) return
        const p = ((t * (.5 + st.pulse * .5) + i / 3) % 1)
        m.scale.setScalar((.03 + p * .22) * k)
        ;(m.material as THREE.MeshBasicMaterial).opacity = (1 - p) * .7 * k
      })
      if (beam.current) beam.current.scale.set(1, .4 + .6 * k + Math.sin(t * 3) * .04 * st.pulse, 1)
      marker.current.getWorldPosition(cityWorld.current)
    }
  })

  return (
    <group>
      <group ref={spin}>
        <mesh>
          <sphereGeometry args={[R * .985, 64, 48]} />
          <meshBasicMaterial color="#0c0e1a" />
        </mesh>
        <lineSegments geometry={graticule}>
          <lineBasicMaterial color="#8d7a55" transparent opacity={.16} depthWrite={false} />
        </lineSegments>
        <points geometry={points.geo} material={points.mat} />

        <group ref={marker} visible={false}>
          <sprite scale={[.55, .55, 1]}>
            <spriteMaterial map={tex} color="#ffb85c" transparent opacity={.9} depthWrite={false} blending={THREE.AdditiveBlending} />
          </sprite>
          <mesh ref={beam} position={[0, .28, 0]}>
            <cylinderGeometry args={[.004, .012, .56, 10, 1, true]} />
            <meshBasicMaterial color="#ffcf8a" transparent opacity={.55} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
          {[0, 1, 2].map(i => (
            <mesh key={i} ref={el => { rings.current[i] = el }} rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[.9, 1, 48]} />
              <meshBasicMaterial color="#ffc46e" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
          ))}
          {/* the crew's spells are cast in the city's own frame: y is straight up out of the ground there */}
          {children}
        </group>
      </group>

      <mesh material={atmo} scale={1.17}><sphereGeometry args={[R, 48, 32]} /></mesh>
      {/* one thin astrolabe ring, and nothing else: an accessory, not a diagram */}
      <mesh rotation={[Math.PI / 2 + .41, 0, 0]}>
        <torusGeometry args={[1.34, .004, 6, 160]} />
        <meshBasicMaterial color="#c8873a" transparent opacity={.4} depthWrite={false} />
      </mesh>
    </group>
  )
}
