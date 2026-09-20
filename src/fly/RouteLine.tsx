import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { LegStep, Transport } from '../types'
import Icon from '../ui/Icon'
import { legStyle, type LegStyle } from './legStyle'

/* One leg of a journey, drawn on the city as light laid along the street.
 *
 * It is a ribbon, not a line: flat on the ground, as wide as the street it follows (and
 * never thinner on screen than a line would be, so it still reads from two kilometres up),
 * soft at its edges, with light flowing slowly along it the way the leg is travelled. Nothing
 * rides it for show. When the flight is on a leg, the ribbon itself says where: it burns
 * brightest just behind the traveller and cools to an ember where they have already been,
 * so the way ahead is the bright part. Each way of travelling has its own manner (legStyle),
 * and a leg by transit is drawn as what it is made of: a walk to the platform, the ride in
 * the line's own colour between two marked stations, a walk out. Where a roof or a tree
 * stands over the street the ribbon shows through it faintly rather than breaking, and a
 * leg nobody could route is an arc over the city, broken and faint, that does not pretend
 * to be a street.
 */

const noHit = () => null
const WARM = new THREE.Color('#fff3d6')
const RIDE = '#fff3d6'           // a ride whose line has no colour of its own on Google's map: still plainly not a walk

const vertexShader = /* glsl */`
  attribute vec3 side;
  attribute float edge;
  attribute float along;
  uniform float widthM, minPx, pxScale, lift;
  varying float vEdge, vAlong;
  void main() {
    // From high up the city under it is a coarser model than the one its heights were read from, and
    // stands metres off it, so the ribbon rides a little higher the farther away it is seen from.
    float far = -(modelViewMatrix * vec4(position, 1.)).z;
    vec3 c = position + vec3(0., lift + far * .006, 0.);
    float depth = -(modelViewMatrix * vec4(c, 1.)).z;
    float halfWidth = max(widthM, minPx * depth * pxScale) * .5;
    vEdge = edge; vAlong = along;
    vec4 mv = modelViewMatrix * vec4(c + side * edge * halfWidth, 1.);
    gl_Position = projectionMatrix * mv;
    // It is drawn where it is, but tested for depth as if it were some metres nearer the eye. A ribbon two metres over
    // photogrammetry is forever being poked through by it (a kerb, a parked car, the camber of a road, and every
    // refinement of the tiles, which moves the surface by metres): stretches of it went faint and came back as the
    // camera moved, which read as lines appearing and disappearing. A building is tens of metres of wall in the way and
    // still hides it; the ground it lies on no longer can. More is allowed far off, where the model is coarser.
    float toward = min(length(mv.xyz) * .5, 9. + far * .02);
    vec4 nearer = projectionMatrix * vec4(mv.xyz * (1. - toward / max(length(mv.xyz), 1.)), 1.);
    gl_Position.z = nearer.z / nearer.w * gl_Position.w;
  }`

const fragmentShader = /* glsl */`
  uniform vec3 colour, warm;
  uniform float opacity, time, flowMps, dashOn, dashOff, between, head, trail, soft;
  varying float vEdge, vAlong;
  void main() {
    float across = abs(vEdge);
    float body = 1. - smoothstep(1. - soft, 1., across);
    float core = 1. - smoothstep(0., .45, across);

    // Light moving along it, in the direction of travel.
    float ph = fract((vAlong - time * flowMps) / 140.);
    float flow = smoothstep(0., .5, ph) * (1. - smoothstep(.5, 1., ph));

    // Footsteps and long dashes, as brighter marks on a ribbon that stays whole between them (only a
    // guess is truly broken); from far enough up that they would shimmer, an even tone instead.
    float marks = 1.;
    if (dashOn > 0.) {
      float period = dashOn + dashOff, m = mod(vAlong, period);
      float mark = smoothstep(0., 1., m) * (1. - smoothstep(dashOn - 1., dashOn, m));
      marks = mix(between, 1., mix(mark, dashOn / period, clamp(fwidth(vAlong) / period * 2.5, 0., 1.)));
    }

    // Where the flight is on this leg, if it is: a wake of light just behind the traveller, cooling to an
    // ember over the ground already covered. Ahead of them the ribbon is as bright as it ever is.
    float behind = head - vAlong;
    float travelled = head >= 0. && behind > 0. ? 1. : 0.;
    float wake = travelled * exp(-behind / trail);
    float ember = mix(1., .38, travelled * smoothstep(0., trail * 2.5, behind));

    vec3 c = colour * (.78 + .3 * flow) + warm * (core * .22 + wake * .9);
    float a = (opacity * body * marks * (.78 + .22 * flow)) * ember + wake * body * .6;
    gl_FragColor = vec4(c, clamp(a, 0., 1.));
    #include <colorspace_fragment>
  }`

/** A flat strip along `pts` between `from` and `to` metres, carrying for every vertex which way is
    sideways and how far along the whole leg it is; the shader gives it its width. */
/** Where `s` metres along the line falls. Past the end is the end: a stretch's far end is a sum of its steps' shares of
    the leg, which rounding can leave a hair over the leg's length, and no point is "at least" that far along. Taken for
    the first segment instead, the stretch's last vertex was the leg's second point, and a straight ribbon ran from the
    end of the leg back to its start: there or not as the rounding fell, each time the ground refined and the line was re-laid. */
function pointAt(pts: THREE.Vector3[], cum: number[], s: number, out: THREE.Vector3): THREE.Vector3 {
  let hi = cum.findIndex(v => v >= s)
  if (hi < 0) hi = cum.length - 1
  if (hi < 1) hi = 1
  return out.lerpVectors(pts[hi - 1], pts[hi], THREE.MathUtils.clamp((s - cum[hi - 1]) / Math.max(1e-6, cum[hi] - cum[hi - 1]), 0, 1))
}

function ribbon(pts: THREE.Vector3[], cum: number[], from: number, to: number): THREE.BufferGeometry {
  const at = (s: number) => pointAt(pts, cum, s, new THREE.Vector3())
  const line: { p: THREE.Vector3; s: number }[] = [{ p: at(from), s: from }]
  pts.forEach((p, i) => { if (cum[i] > from + .5 && cum[i] < to - .5) line.push({ p, s: cum[i] }) })
  line.push({ p: at(to), s: to })

  const position: number[] = [], side: number[] = [], edge: number[] = [], along: number[] = [], index: number[] = []
  const dir = new THREE.Vector3(), out = new THREE.Vector3()
  line.forEach(({ p, s }, i) => {
    dir.subVectors(line[Math.min(i + 1, line.length - 1)].p, line[Math.max(i - 1, 0)].p).setY(0)
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0)
    out.set(-dir.z, 0, dir.x).normalize()
    for (const e of [-1, 1]) { position.push(p.x, p.y, p.z); side.push(out.x, out.y, out.z); edge.push(e); along.push(s) }
    if (i) { const k = i * 2; index.push(k - 2, k - 1, k, k - 1, k + 1, k) }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  g.setAttribute('side', new THREE.Float32BufferAttribute(side, 3))
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1))
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1))
  g.setIndex(index)
  return g
}

type Part = { from: number; to: number; style: LegStyle; colour: string; step?: LegStep }
type Shared = { time: { value: number }; head: { value: number }; pxScale: { value: number } }

/** One stretch of the leg in one manner: the ribbon, the faint ghost of it that shows through
    whatever stands over the street, and for the wide ones a glow underneath. */
function Stretch({ geometry, part, lift, dim, floating, shared }: { geometry: THREE.BufferGeometry; part: Part; lift: number; dim: boolean; floating: boolean; shared: Shared }) {
  const mats = useMemo(() => {
    const o = (dim ? .35 : 1) * part.style.opacity
    const make = (width: number, opacity: number, through: boolean, soft: number, shadow = false) => new THREE.ShaderMaterial({
      vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest: !through, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: {
        colour: { value: new THREE.Color(shadow ? '#000' : part.colour) }, warm: { value: shadow ? new THREE.Color(0, 0, 0) : WARM },
        widthM: { value: part.style.widthM * width }, minPx: { value: part.style.minPx * width * (dim ? .6 : 1) },
        lift: { value: lift }, opacity: { value: opacity }, soft: { value: soft },
        flowMps: { value: dim ? 0 : part.style.flowMps }, trail: { value: 70 },
        dashOn: { value: part.style.dash?.on ?? 0 }, dashOff: { value: part.style.dash?.off ?? 0 }, between: { value: floating ? 0 : .42 },
        time: shared.time, head: shadow ? { value: -1 } : shared.head, pxScale: shared.pxScale,
      },
    })
    return {
      // A city in daylight is a bright, busy thing to draw on: a soft dark casing under the ribbon is what lets it read.
      casing: make(1.9, o * .42, true, .7, true),
      main: make(1, o, floating, .3),
      // Seen through a roof or a tree it is fainter, but plainly the same line: at four tenths a travelled leg all but went out.
      ghost: floating ? null : make(1, o * .6, true, .3),
      glow: part.style.glow ? make(3.2, o * .2, floating, 1) : null,
    }
  }, [part.colour, part.style, lift, dim, floating, shared])
  useEffect(() => () => { mats.casing.dispose(); mats.main.dispose(); mats.ghost?.dispose(); mats.glow?.dispose() }, [mats])
  return (
    <>
      <mesh geometry={geometry} material={mats.casing} raycast={noHit} frustumCulled={false} renderOrder={0} />
      {mats.glow && <mesh geometry={geometry} material={mats.glow} raycast={noHit} frustumCulled={false} renderOrder={1} />}
      {mats.ghost && <mesh geometry={geometry} material={mats.ghost} raycast={noHit} frustumCulled={false} renderOrder={2} />}
      <mesh geometry={geometry} material={mats.main} raycast={noHit} frustumCulled={false} renderOrder={3} />
    </>
  )
}

export default function RouteLine({ pts: ground, colour, transport, estimated, dim = false, lift = 3, label, steps, head }: {
  /** Already on the ground and smoothed (legStyle.smoothHeights). */
  pts: THREE.Vector3[]
  colour: string
  transport: Transport
  estimated?: boolean
  dim?: boolean
  lift?: number
  label?: string
  /** A transit leg's parts, if the router gave them. */
  steps?: LegStep[]
  /** Where the traveller is, in metres along the leg, while the flight is on it; null or absent otherwise. */
  head?: () => number | null
}) {
  // A leg that could not be routed is two points and a guess. It is lifted into an arc over the
  // city, because a straight line through the buildings reads as a street that is not there.
  const pts = useMemo(() => {
    if (!estimated || ground.length < 2) return ground
    const span = ground[0].distanceTo(ground[ground.length - 1]), rise = Math.min(160, span * .16)
    let run = 0
    return ground.map((p, i) => {
      if (i) run += ground[i].distanceTo(ground[i - 1])
      return new THREE.Vector3(p.x, p.y + Math.sin(Math.PI * Math.min(1, run / Math.max(1, span))) * rise, p.z)
    })
  }, [ground, estimated])

  const cum = useMemo(() => {
    const c = [0]
    for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + pts[i].distanceTo(pts[i - 1]))
    return c
  }, [pts])
  const total = cum[cum.length - 1] ?? 0

  // The leg as stretches, each in its own manner. The steps' own distances share the line out between them.
  const parts = useMemo<Part[]>(() => {
    const whole = [{ from: 0, to: total, style: legStyle(transport, estimated), colour }]
    const said = steps?.reduce((m, s) => m + s.distanceM, 0) ?? 0
    if (!steps || estimated || said <= 0 || total <= 0) return whole
    let at = 0
    return steps.map(step => {
      const from = at; at += step.distanceM / said * total
      return step.mode === 'transit'
        ? { from, to: at, style: legStyle('transit'), colour: step.line?.colour ?? RIDE, step }
        : { from, to: at, style: legStyle('walk'), colour, step }
    }).filter(p => p.to - p.from > 1)
  }, [steps, estimated, total, transport, colour])

  const geometries = useMemo(() => pts.length < 2 ? [] : parts.map(p => ribbon(pts, cum, p.from, p.to)), [pts, cum, parts])
  useEffect(() => () => geometries.forEach(g => g.dispose()), [geometries])

  const shared = useMemo<Shared>(() => ({ time: { value: 0 }, head: { value: -1 }, pxScale: { value: .001 } }), [])
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera
  const height = useThree(s => s.size.height)

  const where = (s: number, out: THREE.Vector3) => pointAt(pts, cum, s, out)

  useFrame(({ clock }) => {
    shared.time.value = clock.elapsedTime
    shared.pxScale.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / height
    shared.head.value = dim ? -1 : head?.() ?? -1
  })

  if (pts.length < 2) return null
  const mid = pts[pts.length >> 1]
  return (
    <>
      {parts.map((part, i) => geometries[i] && <Stretch key={i} geometry={geometries[i]} part={part} lift={lift} dim={dim} floating={!!estimated} shared={shared} />)}

      {/* the two stations of a ride */}
      {!dim && parts.map((part, i) => part.step?.mode === 'transit' && [part.from, part.to].map((s, end) => {
        const p = where(s, new THREE.Vector3()), name = end ? part.step!.to : part.step!.from
        return (
          <group key={`${i}:${end}`} position={[p.x, p.y + lift + .5, p.z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={noHit} renderOrder={4}>
              <circleGeometry args={[14, 40]} /><meshBasicMaterial color={part.colour} transparent opacity={.95} depthTest={false} toneMapped={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .2, 0]} raycast={noHit} renderOrder={5}>
              <circleGeometry args={[8.5, 40]} /><meshBasicMaterial color="#0c0a08" transparent opacity={.92} depthTest={false} />
            </mesh>
            {name && (
              <Html position={[0, 16, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
                <div className="route-pill route-stop" style={{ ['--c' as string]: part.colour }}>{name}</div>
              </Html>
            )}
          </group>
        )
      }))}

      {/* and the line's own sign, worn along the ride the way it is worn on the train: its number, on its colour */}
      {!dim && parts.map((part, i) => {
        const line = part.step?.mode === 'transit' ? part.step.line : undefined
        if (!line?.name) return null
        const signs = THREE.MathUtils.clamp(Math.round((part.to - part.from) / 900), 1, 3)
        return Array.from({ length: signs }, (_, k) => {
          const p = where(part.from + (part.to - part.from) * (k + 1) / (signs + 1), new THREE.Vector3())
          return (
            <Html key={`${i}:sign:${k}`} position={[p.x, p.y + lift + 6, p.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
              <div className="route-line" style={{ background: part.colour, color: line.textColour ?? '#14100c' }} title={`${line.vehicle} ${line.name}`}>
                <Icon name="transit" size={12} />{line.name}
              </div>
            </Html>
          )
        })
      })}

      {label && !dim && (
        <Html position={[mid.x, mid.y + lift + 14, mid.z]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div className="route-pill" style={{ ['--c' as string]: colour }}><Icon name={transport} size={13} />{label}{estimated ? ' · est.' : ''}</div>
        </Html>
      )}
    </>
  )
}
