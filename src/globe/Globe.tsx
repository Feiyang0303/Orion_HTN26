import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { LatLon } from '../types'
import { coastDistance, isLand } from './landMask'
import { toSphere } from './geo'

/* The globe. Drawn, not textured: the continents are a hundred thousand points
 * placed on the land, thick along the shores and thinning inland, so they read as
 * marks on a chart and not as a photograph of Earth. That keeps it in the same
 * visual language as the rest of the product, and makes it cheap enough to leave
 * running behind every screen — the whole planet is one draw call.
 *
 * On top of the land there are three things that make it feel like a place rather
 * than a diagram: a terminator, so one limb is in daylight and the other is dark
 * with a scatter of lit cities; a shell of slow dust and a tilted ring of it, so
 * there is something between the camera and the far side; and travel arcs that
 * sweep between real land points, converging on the city once there is one.
 *
 * It does three jobs. Before there is a city it turns slowly. When a city is
 * chosen it turns to face the camera and the land around that city lights up in
 * amber, with a wave that goes out across the continent: the place has been
 * found. And while the crew works it stays turned there, as the thing the work is
 * being done to. */

export const R = 1

/** A tiny seeded generator: the same globe every time, so it does not shimmer between renders. */
function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

type Land = { position: Float32Array; scatter: Float32Array; colour: Float32Array; seed: Float32Array; size: Float32Array; land: Float32Array }

/* Sampled on a Fibonacci sphere so the points are evenly spread whatever the
   latitude. The ocean keeps a fifth of its points, dim and cold, so the planet
   is a body made of particles rather than a black ball with continents stuck to
   it; the land keeps nearly all of them, brightest along the shore, which is
   what draws the coastline without a single line being drawn. */
function stipple(samples: number): Land {
  const golden = Math.PI * (3 - Math.sqrt(5))
  const pos: number[] = [], sca: number[] = [], col: number[] = [], seed: number[] = [], size: number[] = [], isl: number[] = []
  const shore = new THREE.Color('#f6e9c8'), inland = new THREE.Color('#9aa08f'), warm = new THREE.Color('#dcbb86')
  const deep = new THREE.Color('#1b3350'), shallow = new THREE.Color('#2f5a77')
  const rand = mulberry(7)
  for (let i = 0; i < samples; i++) {
    const y = 1 - (i / (samples - 1)) * 2
    const rad = Math.sqrt(Math.max(0, 1 - y * y))
    const th = i * golden
    const lat = Math.asin(y) * 180 / Math.PI
    const lon = Math.atan2(Math.sin(th) * rad, Math.cos(th) * rad) * 180 / Math.PI
    const land = isLand(lat, lon)
    const near = land ? coastDistance(lat, lon, 3) : 0        // 1 = shoreline, 4 = deep inland
    const keep = !land ? .2 : near <= 1 ? 1 : near === 2 ? .94 : near === 3 ? .8 : .64
    if (rand() > keep) continue
    // a little height on the land, so the surface has grain rather than sitting on one shell
    const v = toSphere(lat, lon, R * (land ? 1.0015 + rand() * .004 : .999))
    pos.push(v.x, v.y, v.z)
    const s = v.clone().multiplyScalar(1.7 + rand() * 2.6)
    sca.push(s.x, s.y, s.z)
    let c: THREE.Color
    if (land) {
      const t = Math.min(1, (near - 1) / 3)
      c = shore.clone().lerp(inland, t * .68).lerp(warm, rand() * .2)
      size.push(near <= 1 ? .95 + rand() * .55 : .68 + rand() * .5)
    } else {
      // a hint of shelf near the coast, so the sea is not one flat colour
      c = deep.clone().lerp(shallow, Math.pow(rand(), 2.2))
      size.push(.34 + rand() * .3)
    }
    col.push(c.r, c.g, c.b)
    seed.push(rand())
    isl.push(land ? 1 : 0)
  }
  return {
    position: new Float32Array(pos), scatter: new Float32Array(sca), colour: new Float32Array(col),
    seed: new Float32Array(seed), size: new Float32Array(size), land: new Float32Array(isl),
  }
}

/* -------------------------------------------------------------- the land */

const VERT = /* glsl */`
  attribute vec3 aScatter; attribute vec3 aColour; attribute float aSeed; attribute float aSize; attribute float aLand;
  uniform float uTime, uReveal, uSize, uPx, uGlow, uWave;
  uniform vec3 uCity, uSun;
  varying vec3 vColour; varying float vAlpha; varying float vHeat; varying float vLight; varying float vLand;
  void main() {
    float e = 1.0 - pow(1.0 - clamp(uReveal, 0.0, 1.0), 3.0);
    float st = clamp((e - aSeed * 0.4) / 0.6, 0.0, 1.0);
    vec3 p = mix(aScatter, position, 1.0 - pow(1.0 - st, 2.0));
    vec3 n = normalize(position);

    float d = acos(clamp(dot(n, normalize(uCity)), -1.0, 1.0));
    float near = uGlow * smoothstep(0.34, 0.0, d);
    float wave = uGlow * exp(-pow((d - uWave * 1.9) * 9.0, 2.0)) * (1.0 - uWave);
    vHeat = clamp(near * 1.5 + wave, 0.0, 1.0);

    /* The sun is fixed in view space, so the terminator stays where the light
       is while the planet turns under it. */
    vec3 nv = normalize(normalMatrix * n);
    float day = smoothstep(-0.55, 0.55, dot(nv, normalize(uSun)));
    float lamps = aLand * step(0.984, aSeed) * (1.0 - day);   // lit cities on the dark side
    vLight = day + lamps * 1.7;
    vLand = aLand;

    float tw = 0.9 + 0.1 * sin(uTime * 1.8 + aSeed * 60.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // dim what is on the far side of the sphere; it is still there, just not competing
    vAlpha = mix(0.04, 1.0, smoothstep(-0.12, 0.34, nv.z)) * tw * st * (0.62 + 0.38 * day + lamps);
    vColour = aColour;
    gl_PointSize = uSize * uPx * aSize * (1.0 + vHeat * 2.0 + lamps * 1.0) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`

const FRAG = /* glsl */`
  varying vec3 vColour; varying float vAlpha; varying float vHeat; varying float vLight; varying float vLand;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.06, r);
    vec3 amber = vec3(1.0, 0.72, 0.32);
    vec3 night = vColour * vec3(0.42, 0.56, 0.9);
    float lamp = max(0.0, vLight - 1.0);
    vec3 base = mix(night, vColour, clamp(vLight, 0.0, 1.0));
    vec3 col = mix(base, amber, clamp(vHeat + lamp, 0.0, 1.0)) * (0.95 + 0.45 * vLand + vHeat * 1.6 + lamp * 1.8);
    gl_FragColor = vec4(col, vAlpha * soft * (0.5 + 0.5 * vLand));
  }`

/* ------------------------------------------------------------- the dust */

const DUST_VERT = /* glsl */`
  attribute float aSeed; attribute float aSize;
  uniform float uTime, uPx, uPulse, uReveal;
  varying float vA; varying float vSeed;
  void main() {
    float w = uTime * (0.06 + aSeed * 0.07);
    vec3 p = position + vec3(sin(w + aSeed * 6.3), cos(w * 0.8 + aSeed * 3.1), sin(w * 1.3 + aSeed * 1.7)) * 0.035;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float tw = 0.35 + 0.65 * abs(sin(uTime * (0.5 + aSeed * 1.6) + aSeed * 40.0));
    vA = tw * (0.42 + 0.4 * uPulse) * uReveal;
    vSeed = aSeed;
    gl_PointSize = uSize * uPx * 0.0075 / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`

const DUST_FRAG = /* glsl */`
  varying float vA; varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, r);
    vec3 col = mix(vec3(1.0, 0.78, 0.44), vec3(0.55, 0.68, 1.0), step(0.55, vSeed));
    gl_FragColor = vec4(col, vA * soft * 0.9);
  }`

/** A shell of drifting motes around the planet, and a thin tilted ring of them. */
function dustGeometry(count: number, mode: 'shell' | 'ring', seedBase: number) {
  const rand = mulberry(seedBase)
  const pos: number[] = [], seed: number[] = [], size: number[] = []
  for (let i = 0; i < count; i++) {
    let x: number, y: number, z: number
    if (mode === 'shell') {
      const u = rand() * 2 - 1, a = rand() * Math.PI * 2, s = Math.sqrt(Math.max(0, 1 - u * u))
      const r = 1.18 + Math.pow(rand(), .6) * 1.5
      x = Math.cos(a) * s * r; y = u * r; z = Math.sin(a) * s * r
    } else {
      const a = rand() * Math.PI * 2, r = 1.26 + Math.pow(rand(), 1.6) * .42
      x = Math.cos(a) * r; z = Math.sin(a) * r; y = (rand() - .5) * .05
    }
    pos.push(x, y, z); seed.push(rand()); size.push(.5 + rand() * (mode === 'ring' ? 1.1 : 1.6))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1))
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1))
  return g
}

/* ------------------------------------------------------------- the arcs */

const ARC_VERT = /* glsl */`
  attribute float aT; attribute float aArc;
  uniform float uTime, uGlow, uReveal;
  varying float vA;
  void main() {
    float head = fract(uTime * 0.09 + aArc * 0.137) * 1.5 - 0.25;
    float d = head - aT;
    float trail = smoothstep(0.4, 0.0, d) * step(0.0, d);
    vA = trail * smoothstep(0.0, 0.05, aT) * smoothstep(1.0, 0.95, aT) * (0.45 + 0.55 * uGlow) * uReveal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`

const ARC_FRAG = /* glsl */`
  varying float vA;
  void main() { gl_FragColor = vec4(1.0, 0.78, 0.45, vA * 0.8); }`

/** Great-circle hops between real land, lifted off the surface. Half of them
    end at the city once there is one, so the world leans towards it. */
function arcGeometry(city: THREE.Vector3 | null) {
  const rand = mulberry(19)
  const SEG = 56, LINES = 18
  const pos: number[] = [], ts: number[] = [], ids: number[] = []
  const landPoint = () => {
    for (let i = 0; i < 500; i++) {
      const lat = rand() * 150 - 70, lon = rand() * 360 - 180
      if (isLand(lat, lon)) return toSphere(lat, lon, 1)
    }
    return toSphere(0, 0, 1)
  }
  for (let a = 0; a < LINES; a++) {
    const from = landPoint()
    const to = city && a % 2 === 0 ? city.clone().normalize() : landPoint()
    const span = from.angleTo(to)
    if (span < .45) continue
    const lift = .06 + Math.min(.26, span * .12)
    const at = (t: number) => from.clone().lerp(to, t).normalize().multiplyScalar(1 + lift * Math.sin(Math.PI * t))
    let prev = at(0)
    for (let i = 1; i <= SEG; i++) {
      const t = i / SEG, p = at(t)
      pos.push(prev.x, prev.y, prev.z, p.x, p.y, p.z)
      ts.push((i - 1) / SEG, t); ids.push(a, a)
      prev = p
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aT', new THREE.Float32BufferAttribute(ts, 1))
  g.setAttribute('aArc', new THREE.Float32BufferAttribute(ids, 1))
  return g
}

/* -------------------------------------------------------- the atmosphere */

const ATMO_VERT = /* glsl */`
  varying vec3 vN; varying vec3 vV;
  void main() { vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`
const ATMO_FRAG = /* glsl */`
  varying vec3 vN; varying vec3 vV; uniform float uPulse; uniform vec3 uSun;
  void main() {
    float e = 1.0 - abs(dot(vN, vV));
    float rim = pow(e, 3.4);
    float lit = smoothstep(-0.5, 0.6, dot(vN, normalize(uSun)));
    vec3 cool = vec3(0.32, 0.54, 1.0), warm = vec3(1.0, 0.72, 0.36);
    vec3 col = mix(cool, warm, 0.2 + 0.3 * uPulse + 0.35 * lit);
    gl_FragColor = vec4(col, rim * (0.75 + 0.45 * uPulse) * (0.3 + 0.7 * lit));
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

/* Sunlight, in view space: up and to the left of the camera, a little behind
   the limb, which is the angle that gives a planet a crescent worth looking at. */
const SUN = new THREE.Vector3(-0.55, 0.42, 0.62).normalize()

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
  const shell = useRef<THREE.Points>(null)
  const halo = useRef<THREE.Points>(null)
  /* Dense enough that the continents have a surface. Machines with few cores
     are usually the ones with a weak GPU as well, so they get half of it. */
  const land = useMemo(() => stipple((navigator.hardwareConcurrency ?? 8) <= 4 ? 150000 : 330000), [])
  const cityDir = useRef(new THREE.Vector3(0, 0, 1))
  const s = useRef({ reveal: 0, glow: 0, wave: 1, lit: false, waveHold: 0, pulse: 0 })
  const tex = useMemo(() => glow(), [])

  const points = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(land.position, 3))
    geo.setAttribute('aScatter', new THREE.BufferAttribute(land.scatter, 3))
    geo.setAttribute('aColour', new THREE.BufferAttribute(land.colour, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(land.seed, 1))
    geo.setAttribute('aSize', new THREE.BufferAttribute(land.size, 1))
    geo.setAttribute('aLand', new THREE.BufferAttribute(land.land, 1))
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uReveal: { value: 0 }, uSize: { value: .0235 }, uPx: { value: 800 },
        uGlow: { value: 0 }, uWave: { value: 1 }, uCity: { value: new THREE.Vector3(0, 0, 1) }, uSun: { value: SUN },
      },
    })
    return { geo, mat }
  }, [land])

  const dust = useMemo(() => ({
    shell: dustGeometry(4200, 'shell', 31),
    ring: dustGeometry(2600, 'ring', 53),
    mat: new THREE.ShaderMaterial({
      vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPx: { value: 800 }, uPulse: { value: 0 }, uReveal: { value: 0 } },
    }),
  }), [])

  const arcs = useMemo(() => ({
    mat: new THREE.ShaderMaterial({
      vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uGlow: { value: 0 }, uReveal: { value: 0 } },
    }),
  }), [])
  const arcGeo = useMemo(() => arcGeometry(city ? toSphere(city.lat, city.lon, 1) : null), [city])

  const atmo = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPulse: { value: 0 }, uSun: { value: SUN } },
  }), [])

  const graticule = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 4) { pts.push(toSphere(lat, lon, 1.001), toSphere(lat, lon + 4, 1.001)) }
    for (let lon = -180; lon < 180; lon += 30) for (let lat = -88; lat < 88; lat += 4) { pts.push(toSphere(lat, lon, 1.001), toSphere(lat + 4, lon, 1.001)) }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [])

  useEffect(() => () => { arcGeo.dispose() }, [arcGeo])

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
    const px = gl.domElement.height * .5
    const u = points.mat.uniforms
    u.uTime.value = t; u.uReveal.value = st.reveal; u.uGlow.value = st.glow; u.uWave.value = Math.min(1, st.wave)
    u.uPx.value = px
    dust.mat.uniforms.uTime.value = t; dust.mat.uniforms.uPx.value = px
    dust.mat.uniforms.uPulse.value = st.pulse; dust.mat.uniforms.uReveal.value = st.reveal
    arcs.mat.uniforms.uTime.value = t; arcs.mat.uniforms.uGlow.value = st.glow; arcs.mat.uniforms.uReveal.value = st.reveal
    atmo.uniforms.uPulse.value = .35 + .65 * st.pulse

    // the dust turns the other way from the planet, which is what makes it read as separate
    if (shell.current) { shell.current.rotation.y -= dt * .012; shell.current.rotation.x = .18 }
    if (halo.current) halo.current.rotation.y += dt * .05

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
          <sphereGeometry args={[R * .992, 64, 48]} />
          <meshBasicMaterial color="#060810" />
        </mesh>
        <lineSegments geometry={graticule}>
          <lineBasicMaterial color="#8d7a55" transparent opacity={.12} depthWrite={false} />
        </lineSegments>
        <points geometry={points.geo} material={points.mat} />
        <lineSegments geometry={arcGeo} material={arcs.mat} />

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

      {/* dust: a slow shell all round, and a tilted ring in the plane of the astrolabe */}
      <points ref={shell} geometry={dust.shell} material={dust.mat} frustumCulled={false} />
      <group rotation={[.41, 0, 0]}>
        <points ref={halo} geometry={dust.ring} material={dust.mat} frustumCulled={false} />
      </group>

      <mesh material={atmo} scale={1.13}><sphereGeometry args={[R, 48, 32]} /></mesh>
      {/* one thin astrolabe ring, and nothing else: an accessory, not a diagram */}
      <mesh rotation={[Math.PI / 2 + .41, 0, 0]}>
        <torusGeometry args={[1.34, .004, 6, 160]} />
        <meshBasicMaterial color="#c8873a" transparent opacity={.4} depthWrite={false} />
      </mesh>
    </group>
  )
}
