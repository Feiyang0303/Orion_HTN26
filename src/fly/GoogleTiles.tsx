import { report } from '../telemetry'
import { useCallback, useMemo, type ReactNode } from 'react'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { TilesRenderer, TilesPlugin, TilesAttributionOverlay } from '3d-tiles-renderer/r3f'
import { GoogleCloudAuthPlugin, GLTFExtensionsPlugin, ReorientationPlugin, TileCompressionPlugin, TilesFadePlugin } from '3d-tiles-renderer/plugins'
import { MeshBasicMaterial } from 'three'
import type { Camera, Intersection, Mesh, MeshStandardMaterial, Object3D, Raycaster, Vector3 } from 'three'
import type * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { DEG } from './geo'

/* Google Photorealistic 3D Tiles. Reoriented so the search point is the
 * origin with +Y up and units in metres; everything else in src/fly works in
 * that frame. Attribution is required by Google's terms, so the overlay is
 * always mounted. */

const ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json'
export const tilesKey = () => import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined

/** One cheap request against the root tileset. A key that exists but whose
    project lacks the Map Tiles API fails here with a clear status, instead of
    as a blank canvas later. */
export async function probeTiles(): Promise<{ ok: true } | { ok: false; why: string }> {
  const key = tilesKey()
  if (!key) return { ok: false, why: 'VITE_GOOGLE_MAPS_KEY is not set. Add it to .env and restart the dev server.' }
  try {
    const res = await fetch(`${ROOT}?key=${key}`)
    if (res.ok) return { ok: true }
    report(new Error(`tiles root answered ${res.status}`), 'tiles.probe', { level: 'error', extra: { status: res.status } })
    return { ok: false, why: res.status === 403 || res.status === 400
      ? `Google rejected the tiles key (${res.status}). Check that the Map Tiles API is enabled and the key's referrer allows this origin.`
      : `Google's tile server answered ${res.status}.` }
  } catch (e) {
    report(e, 'tiles.probe', { level: 'error' })
    return { ok: false, why: "Couldn't reach Google's tile server. Check the connection." }
  }
}

/** The part of the renderer we use. `raycast` exists at runtime but not in its typings. */
export type TilesHandle = {
  raycast: (raycaster: Raycaster, intersects: Intersection[]) => void
  ellipsoid: { getCartographicToPosition: (lat: number, lon: number, height: number, target: Vector3) => Vector3 }
  group: Object3D
  // Extra cameras are how tiles get preloaded: the renderer keeps every tile any registered camera needs.
  setCamera: (c: Camera) => boolean
  deleteCamera: (c: Camera) => boolean
  setResolution: (c: Camera, w: number, h: number) => boolean
  stats: { queued: number; downloading: number; parsing: number; loaded: number; visible: number }
  lruCache: { cachedBytes: number; minSize: number; maxSize: number; minBytesSize: number; maxBytesSize: number }
  /** Screen-space error in pixels a tile may have before it is refined: higher means fewer, coarser tiles. */
  errorTarget: number
}

export default function GoogleTiles({ lat, lon, onLoadEnd, tilesRef, plain = false, children }: {
  lat: number; lon: number; onLoadEnd: () => void          // onLoadEnd must be a stable (useCallback) function
  tilesRef: (t: TilesHandle | null) => void; children?: ReactNode
  /** For a headset, where every pixel is shaded twice on a phone's GPU: the tiles are drawn unlit (photogrammetry has its
      light baked in already) and swap between levels of detail without the cross-fade, which draws both at once. */
  plain?: boolean
}) {
  const apiToken = tilesKey()
  const { gl } = useThree()
  // Plugin args are compared by value one level deep, so they must keep their
  // identity: a fresh literal each render tears the plugin down, and for the
  // auth plugin that means a new session and a 400 on the next tile.
  const dracoLoader = useMemo(() => new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/'), [])
  const authArgs = useMemo(() => [{ apiToken }], [apiToken])
  const gltfArgs = useMemo(() => [{ dracoLoader }], [dracoLoader])
  const orientArgs = useMemo(() => [{ lat: lat * DEG, lon: lon * DEG, height: 0, up: '+y' as const, recenter: true }], [lat, lon])
  const setRef = useCallback((t: unknown) => {
    const handle = t as (TilesHandle & { addEventListener: (type: string, fn: (e: never) => void) => void }) | null
    // Tile failures are reported (throttled per message in telemetry). The URL is
    // scrubbed there, because Google's carries the API key and a session token.
    handle?.addEventListener('load-error', ((e: { error?: unknown; url?: string }) => report(e.error ?? new Error('tile failed to load'), 'tiles.load', { level: 'warning', extra: { url: e.url } })) as never)
    // Anisotropic filtering, on every tile texture as it arrives. Streets and facades
    // are seen at a slant from the chase camera, and without it they smear to mush
    // a short way from the lens; this is the cheapest sharpness there is.
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy())
    handle?.addEventListener('load-model', ((e: { scene: THREE.Object3D }) => {
      e.scene.traverse(o => {
        const m = (o as Mesh).material as MeshStandardMaterial | undefined
        if (m?.map) m.map.anisotropy = aniso
        if (m && plain) { (o as Mesh).material = new MeshBasicMaterial({ map: m.map, side: m.side }); m.dispose() }
      })
    }) as never)
    tilesRef(handle)
  }, [tilesRef, gl, plain])
  if (!apiToken) return null
  return (
    // Keyed on the city: the tileset is re-centred on the place once, as it loads, so
    // a different city is a different renderer (and a fresh Google session), not an edit.
    <TilesRenderer key={`${apiToken}:${lat.toFixed(2)},${lon.toFixed(2)}`} ref={setRef} onTilesLoadEnd={onLoadEnd}>
      <TilesPlugin plugin={GoogleCloudAuthPlugin} args={authArgs} />
      <TilesPlugin plugin={GLTFExtensionsPlugin} args={gltfArgs} />
      <TilesPlugin plugin={TileCompressionPlugin} />
      {!plain && <TilesPlugin plugin={TilesFadePlugin} />}
      <TilesPlugin plugin={ReorientationPlugin} args={orientArgs} />
      <TilesAttributionOverlay style={{ color: '#cdbfa6', fontSize: 11, right: 10, bottom: 6, left: 'auto' }} />
      {children}
    </TilesRenderer>
  )
}
