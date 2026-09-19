import { useCallback, useMemo, type ReactNode } from 'react'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { TilesRenderer, TilesPlugin, TilesAttributionOverlay } from '3d-tiles-renderer/r3f'
import { GoogleCloudAuthPlugin, GLTFExtensionsPlugin, ReorientationPlugin, TileCompressionPlugin, TilesFadePlugin } from '3d-tiles-renderer/plugins'
import type { Intersection, Object3D, Raycaster, Vector3 } from 'three'
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
    return { ok: false, why: res.status === 403 || res.status === 400
      ? `Google rejected the tiles key (${res.status}). Check that the Map Tiles API is enabled and the key's referrer allows this origin.`
      : `Google's tile server answered ${res.status}.` }
  } catch {
    return { ok: false, why: "Couldn't reach Google's tile server. Check the connection." }
  }
}

/** The part of the renderer we use. `raycast` exists at runtime but not in its typings. */
export type TilesHandle = {
  raycast: (raycaster: Raycaster, intersects: Intersection[]) => void
  ellipsoid: { getCartographicToPosition: (lat: number, lon: number, height: number, target: Vector3) => Vector3 }
  group: Object3D
}

export default function GoogleTiles({ lat, lon, onLoadEnd, tilesRef, children }: {
  lat: number; lon: number; onLoadEnd: () => void          // onLoadEnd must be a stable (useCallback) function
  tilesRef: (t: TilesHandle | null) => void; children?: ReactNode
}) {
  const apiToken = tilesKey()
  // Plugin args are compared by value one level deep, so they must keep their
  // identity: a fresh literal each render tears the plugin down, and for the
  // auth plugin that means a new session and a 400 on the next tile.
  const dracoLoader = useMemo(() => new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/'), [])
  const authArgs = useMemo(() => [{ apiToken }], [apiToken])
  const gltfArgs = useMemo(() => [{ dracoLoader }], [dracoLoader])
  const orientArgs = useMemo(() => [{ lat: lat * DEG, lon: lon * DEG, height: 0, up: '+y' as const, recenter: true }], [lat, lon])
  const setRef = useCallback((t: unknown) => tilesRef(t as TilesHandle | null), [tilesRef])
  if (!apiToken) return null
  return (
    <TilesRenderer ref={setRef} onTilesLoadEnd={onLoadEnd}>
      <TilesPlugin plugin={GoogleCloudAuthPlugin} args={authArgs} />
      <TilesPlugin plugin={GLTFExtensionsPlugin} args={gltfArgs} />
      <TilesPlugin plugin={TileCompressionPlugin} />
      <TilesPlugin plugin={TilesFadePlugin} />
      <TilesPlugin plugin={ReorientationPlugin} args={orientArgs} />
      <TilesAttributionOverlay style={{ color: '#cdbfa6', fontSize: 11, right: 10, bottom: 6, left: 'auto' }} />
      {children}
    </TilesRenderer>
  )
}
