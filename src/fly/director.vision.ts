import * as THREE from 'three'
import type { Plan } from '../types'
import type { TilesHandle } from './GoogleTiles'
import type { GroundPlacer } from './ground'
import { keyStop } from './anchors'
import type { Timeline } from './timeline'
import { CANDIDATE_SIDES, shotKey, type Shots } from './shots'
import { postJson } from '../plan/net'
import { log, report } from '../telemetry'

/* THE DIRECTOR, WITH EYES. director.ts frames a shot by arithmetic: how tall the thing is, how
 * far back that puts the camera, whether a ray from there reaches it. What it cannot know is
 * what the shot looks like: which side of a cathedral is its face, whether the clear line of
 * sight is a clear view of a car park, whether the model is a smear from that angle. A person
 * choosing a camera position would walk round the thing and look.
 *
 * So this does. While the book is being read and the tiles are arriving anyway, for each thing
 * the guide will talk about it poses the camera on every side a shot could be taken from (each
 * still framed and checked for line of sight by the arithmetic), renders a small picture from
 * each, and shows them to a model that can see, with the line the guide will be saying. The
 * model ranks them. The best is the side the shot is taken from; a second line about the same
 * thing takes the next best, so the camera still moves. The choice is remembered with the trip,
 * because it costs a call and depends on nothing that changes.
 *
 * Nothing here can make the flight worse than it was: it only ever chooses between positions
 * the arithmetic already allows, a place nobody has looked at yet is shot the old way, and a
 * place the flight is already at is left alone rather than moved under the viewer.
 */

const W = 448, H = 288                        // a picture a model is shown: enough to judge a view, small enough to send six
const SETTLE_MIN_SEC = 1.2, SETTLE_MAX_SEC = 4.5, SETTLED_AT = 25
const ASKING_AT_ONCE = 2, SIDES_USED = 3      // lines about one thing share out its best few sides, not its worst

const SYSTEM = `You are the cinematographer for a guided aerial tour flown over a photorealistic 3D model of a real city.
You are shown several candidate camera views of the SAME subject, numbered from 0 in the order given. The subject is at
the centre of every view. Rank the views for the moment described, best first. Reply with JSON:
{"ranking": [indices, best first, every index exactly once], "reason": "one short plain sentence on why the best view is best"}

Judge only what you can see:
- The subject should be clearly visible and unobstructed, recognisable, and a good size in the frame.
- Prefer the side that shows its face or most characteristic form, and a pleasing composition with some context.
- Mark down views where a nearer building, trees or terrain block it, where it is tiny or cut off, where the 3D model
  looks melted, smeared or broken from that side, or where the picture is mostly blank or black.
Do not describe the city or add facts. The reason is about the picture.`

type Job = { key: string; stop: number; target?: string; beats: (number | null)[]; name: string; about: string; line: string }
type Pose = { eye: THREE.Vector3; look: THREE.Vector3 }
type Verdict = { ranking: number[]; reason: string }

export class VisionDirector {
  /** Why each chosen shot was chosen, keyed like the shot: shown with the shot, so the choice can be seen being made. */
  readonly reasons = new Map<string, string>()
  /** Called when a choice lands, so whatever was worked out from the old positions can be worked out again. */
  onChoice: () => void = () => {}

  private jobs: Job[]
  private staged: { job: Job; poses: Pose[]; cams: THREE.PerspectiveCamera[]; at: number } | null = null
  private asking = 0
  private at: number | null = null
  private readonly store: string
  private readonly target = new THREE.WebGLRenderTarget(W, H)
  private readonly pixels = new Uint8Array(W * H * 4)
  private readonly canvas = Object.assign(document.createElement('canvas'), { width: W, height: H })
  private readonly toSrgb = Uint8ClampedArray.from({ length: 256 }, (_, v) => { const c = v / 255; return 255 * (c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055) })

  constructor(private plan: Plan, tl: Timeline, private shots: Shots, private ground: GroundPlacer) {
    // One job per thing the camera will look at: each stop seen whole, then each thing at it the guide speaks about.
    this.jobs = []
    for (const seg of tl.segments) {
      if (seg.kind !== 'dwell') continue
      const stop = plan.stops[seg.stop]
      this.jobs.push({ key: `${seg.stop}:wide`, stop: seg.stop, beats: [null], name: stop.name, about: stop.blurb ?? '', line: seg.beats[0]?.beat.text ?? '' })
      for (const b of seg.beats) {
        const key = `${seg.stop}:${b.beat.targetId ?? 'stop'}`, job = this.jobs.find(j => j.key === key)
        if (job) { job.beats.push(b.index); continue }
        const t = stop.targets.find(x => x.id === b.beat.targetId)
        this.jobs.push({ key, stop: seg.stop, target: b.beat.targetId, beats: [b.index], name: t?.name ?? stop.name, about: t?.summary ?? stop.blurb ?? '', line: b.beat.text })
      }
    }
    // What was chosen for this day before is chosen still.
    this.store = `orion.director:${plan.id}:${plan.stops.map(s => s.id).join(',')}`
    try {
      const kept = JSON.parse(localStorage.getItem(this.store) ?? '{}') as Record<string, Verdict>
      this.jobs = this.jobs.filter(job => { const v = kept[job.key]; if (v) this.apply(job, v); return !v })
    } catch { /* nothing kept, or nowhere to keep it */ }
  }

  get waiting() { return this.jobs.length + (this.staged ? 1 : 0) + this.asking }

  /** Once a frame. `now` is the wall clock and `flightT` the flight's own (which the shots keep their checks by);
      `quiet` is whether the tile loader has room for this (it is not the flight's own tiles that should wait);
      `at` is the stop the flight is at now, whose shots are not to be moved under the viewer. */
  step(gl: THREE.WebGLRenderer, scene: THREE.Scene, tiles: TilesHandle, main: THREE.PerspectiveCamera, now: number, flightT: number, quiet: boolean, at: number | null) {
    this.at = at
    const s = this.staged
    if (s) {
      const st = tiles.stats, pending = st.queued + st.downloading + st.parsing, waited = now - s.at
      if (waited < SETTLE_MIN_SEC || (pending > SETTLED_AT && waited < SETTLE_MAX_SEC)) return
      const images = s.poses.map(p => this.picture(gl, scene, main, p))
      s.cams.forEach(c => tiles.deleteCamera(c))
      this.staged = null
      void this.ask(s.job, images)
      return
    }
    if (!quiet || this.asking >= ASKING_AT_ONCE) return
    const i = this.jobs.findIndex(j => j.stop !== at && this.ground.get(keyStop(j.stop))?.grounded)
    if (i < 0) return
    const [job] = this.jobs.splice(i, 1)
    // Every side a shot of it could be taken from, each already framed and cleared by the arithmetic. The tile
    // loader is given a camera at each, so that what is photographed is a city and not the blur it starts as.
    const poses = CANDIDATE_SIDES.map(side => {
      const p = { eye: new THREE.Vector3(), look: new THREE.Vector3() }
      this.shots.dwell(job.stop, job.beats[0], job.target, 0, flightT, p.eye, p.look, true, side)
      return p
    })
    const cams = poses.map(p => {
      const c = new THREE.PerspectiveCamera(main.fov, W / H, main.near, main.far)
      c.position.copy(p.eye); c.lookAt(p.look); c.updateMatrixWorld(true)
      tiles.setCamera(c); tiles.setResolution(c, W, H)
      return c
    })
    this.staged = { job, poses, cams, at: now }
  }

  /** Give the loader its cameras back: the flight is over, or the day has changed. */
  dispose(tiles: TilesHandle | null) {
    this.staged?.cams.forEach(c => tiles?.deleteCamera(c))
    this.staged = null; this.jobs = []
    this.target.dispose()
  }

  private picture(gl: THREE.WebGLRenderer, scene: THREE.Scene, main: THREE.PerspectiveCamera, pose: Pose) {
    const cam = new THREE.PerspectiveCamera(main.fov, W / H, main.near, main.far)
    cam.position.copy(pose.eye); cam.lookAt(pose.look); cam.updateMatrixWorld(true)
    const before = gl.getRenderTarget()
    gl.setRenderTarget(this.target); gl.clear(); gl.render(scene, cam)
    gl.readRenderTargetPixels(this.target, 0, 0, W, H, this.pixels)
    gl.setRenderTarget(before)
    // What comes back is upside down and in linear light; a picture is neither.
    const ctx = this.canvas.getContext('2d')!, img = ctx.createImageData(W, H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const from = ((H - 1 - y) * W + x) * 4, to = (y * W + x) * 4
      img.data[to] = this.toSrgb[this.pixels[from]]; img.data[to + 1] = this.toSrgb[this.pixels[from + 1]]; img.data[to + 2] = this.toSrgb[this.pixels[from + 2]]; img.data[to + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    return this.canvas.toDataURL('image/jpeg', .72)
  }

  private async ask(job: Job, images: string[]) {
    this.asking++
    try {
      const user = `City: ${this.plan.city}\nSubject: ${job.name}${job.about ? `\nAbout it: ${job.about}` : ''}${job.line ? `\nThe guide will be saying: "${job.line}"` : ''}\nThere are ${images.length} views, numbered 0 to ${images.length - 1}.`
      const { text } = await postJson<{ text: string }>('llm', { role: 'director', system: SYSTEM, user, images, maxTokens: 300 })
      const said = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Partial<Verdict>
      const ranking = [...new Set((said.ranking ?? []).filter(i => Number.isInteger(i) && i >= 0 && i < images.length))]
      if (!ranking.length) throw new Error('the director ranked nothing')
      const verdict: Verdict = { ranking, reason: String(said.reason ?? '').slice(0, 160) }
      try { localStorage.setItem(this.store, JSON.stringify({ ...JSON.parse(localStorage.getItem(this.store) ?? '{}'), [job.key]: verdict })) } catch { /* it will be asked again next time */ }
      log.info('director chose a side', { stop: job.stop, subject: job.name, side: ranking[0], reason: verdict.reason })
      if (this.at !== job.stop) { this.apply(job, verdict); this.onChoice() }        // never under the viewer: it holds from the next visit
    } catch (e) {
      report(e, 'fly.director', { level: 'warning', extra: { subject: job.name } })   // the shot is simply taken the old way
    } finally { this.asking-- }
  }

  private apply(job: Job, v: Verdict) {
    const best = v.ranking.slice(0, SIDES_USED)
    job.beats.forEach((b, k) => {
      const key = shotKey(job.stop, b)
      this.shots.chosen.set(key, CANDIDATE_SIDES[best[k % best.length]])
      if (k === 0 && v.reason) this.reasons.set(key, v.reason)
    })
  }
}
