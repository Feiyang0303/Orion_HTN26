import { useEffect, useRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { TilesHandle } from './GoogleTiles'
import { GroundPlacer } from './ground'
import { anchorsFor } from './anchors'
import { buildTimeline } from './timeline'
import { Shots, routeOn } from './shots'
import { VisionDirector } from './director.vision'
import { TARGET } from './quality'
import { nextJob, openDesk, type DeskJob } from './directing'
import { report } from '../telemetry'

/* The Director's desk, in the city. While the crew plans, this canvas is already behind them with the real city
 * loading in it; this takes each day the planner leaves (directing.ts), puts its places on the ground exactly as a
 * flight would, and lets the Director walk round them. One day at a time: the pictures of a place need the tiles
 * round it, and two days' worth of cameras spread over a city would only starve each other.
 *
 * It draws nothing. The pictures are rendered off to one side of the frame the map is drawn in, and nobody is
 * looking at this canvas anyway: the crew and the globe are in front of it.
 */

// Sharper than the map is drawn (30), since these pictures are judged; coarser than a flight holds still at, since the
// crew in front is animated on the same thread that parses tiles, and the pictures are small.
const LOOKING_TARGET = 10

type Work = { job: DeskJob; ground: GroundPlacer; shots: Shots; director: VisionDirector; moved: number }

export default function DirectorDesk({ tiles, loadTick }: { tiles: MutableRefObject<TilesHandle | null>; loadTick: number }) {
  const gl = useThree(st => st.gl), scene = useThree(st => st.scene), camera = useThree(st => st.camera)
  const work = useRef<Work | null>(null)

  const close = (w: Work, failed = false) => {
    w.director.dispose(tiles.current)
    if (tiles.current) tiles.current.errorTarget = TARGET.map
    const d = w.director.direction
    w.job.finish(failed || !Object.keys(d.choices).length ? null : d)
    work.current = null
  }

  useEffect(() => {
    const leave = openDesk()
    return () => { leave(); if (work.current) close(work.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { work.current?.ground.requeue() }, [loadTick])

  useFrame(() => {
    const t = tiles.current
    if (!t) return
    let w = work.current
    if (!w) {
      const job = nextJob()
      if (!job) return
      const ground = new GroundPlacer()
      ground.setAnchors(anchorsFor(job.plan))
      const shots = new Shots(ground, tiles)
      const director = new VisionDirector(job.plan, buildTimeline(job.plan), shots, ground, { widesFirst: true })
      director.onLook = (subject, nth) => job.note(subject, nth, director.total)
      w = work.current = { job, ground, shots, director, moved: 0 }
    }
    try {
      // The places go on the ground as the tiles under them arrive, and the route (which says which way a stop is
      // arrived at, and so which side is "behind") is laid again as they do.
      const changed = w.ground.step(t)
      if (changed) { w.moved += changed; if (!w.ground.pending || w.moved >= 20) { w.moved = 0; w.shots.route = routeOn(w.job.plan, w.ground) } }
      if (w.job.called || !w.director.waiting) return close(w)
      t.errorTarget = LOOKING_TARGET
      const now = performance.now() / 1000
      w.director.step(gl, scene, t, camera as THREE.PerspectiveCamera, now, now, true, null)
    } catch (e) {
      report(e, 'fly.director', { level: 'warning' })
      close(w, true)
    }
  })

  return null
}
