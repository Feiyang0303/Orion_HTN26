/* The goose's voice is a cartoon duck's.
 *
 * It is a human voice from ElevenLabs, and the duck is made of it here, in
 * the browser, in two parts.
 *
 * Pitch: an <audio> element played faster with `preservesPitch` off goes up
 * the way a sped-up record does. Faster alone would be a chipmunk reading
 * too quickly to follow, so the proxy asks ElevenLabs for every line spoken
 * slower by the inverse amount (`ELEVENLABS_GOOSE_SPEED`, 1 / QUACK_RATE),
 * and the two cancel: normal pace, small voice. Those two numbers are a
 * pair — change one, change the other.
 *
 * Quack: the thing that makes a cartoon duck a duck rather than a child is
 * the rasp — the voice is spoken through flapping cheeks, which chops it
 * some eighty times a second. That is an amplitude modulation, and the Web
 * Audio graph below does exactly that to the element's output: thins the
 * low end, honks the nasal band, buzzes it at BUZZ_HZ, clips it a little,
 * and takes the top off so it is not painful. Every knob is up here.
 *
 * QUACK_RATE itself lives in plan/pace.ts, which has no DOM in it, because
 * the planning pipeline needs it to work out clip durations and is also run
 * from node scripts. */

import { QUACK_RATE } from '../plan/pace'

const BUZZ_HZ = 82                 // the cheeks: how fast the voice is chopped
const BUZZ_DEPTH = 0.45            // how hard (0 = a clear voice, 0.5 = chopped to nothing at the bottom of each flap)
const HONK_HZ = 1900               // the nasal band that is lifted
const HONK_DB = 8
const THIN_HZ = 320                // everything under this is let go
const DRIVE = 3.5                  // the rasp: how hard the voice is clipped
const CEILING_HZ = 6200            // and how much fizz is allowed through
const MAKEUP = 0.8

export function quack(audio: HTMLAudioElement): HTMLAudioElement {
  audio.playbackRate = QUACK_RATE
  audio.preservesPitch = false
  const a = audio as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean }
  a.mozPreservesPitch = false
  a.webkitPreservesPitch = false
  audio.addEventListener('play', () => rasp(audio), { once: true })
  return audio
}

/* One context for the page, made on the first play — which happens after a
   click, so the browser lets it run. Once an element is wired into the
   graph its sound comes only through the graph, so it is wired only when
   the context is really running; otherwise it is left alone, just pitched. */
let ctx: AudioContext | null = null
let flap: GainNode | null = null          // the cheeks, shaken once for the whole page: every clip's buzz hangs off it
const wired = new WeakSet<HTMLAudioElement>()

async function rasp(el: HTMLAudioElement) {
  if (wired.has(el) || typeof AudioContext === 'undefined') return
  try {
    ctx ??= new AudioContext()
    if (ctx.state !== 'running') await ctx.resume()
    if (ctx.state !== 'running' || wired.has(el)) return
    if (!flap) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'; osc.frequency.value = BUZZ_HZ
      flap = ctx.createGain(); flap.gain.value = BUZZ_DEPTH
      osc.connect(flap); osc.start()
    }
    wired.add(el)
    const source = ctx.createMediaElementSource(el)

    const thin = ctx.createBiquadFilter()
    thin.type = 'highpass'; thin.frequency.value = THIN_HZ; thin.Q.value = 0.7

    const honk = ctx.createBiquadFilter()
    honk.type = 'peaking'; honk.frequency.value = HONK_HZ; honk.Q.value = 1.1; honk.gain.value = HONK_DB

    // the cheeks: a gain that is shaken at BUZZ_HZ, between 1 - 2·depth and 1
    const buzz = ctx.createGain()
    buzz.gain.value = 1 - BUZZ_DEPTH
    flap.connect(buzz.gain)

    const grit = ctx.createWaveShaper()
    grit.curve = softClip(DRIVE); grit.oversample = '2x'

    const ceiling = ctx.createBiquadFilter()
    ceiling.type = 'lowpass'; ceiling.frequency.value = CEILING_HZ; ceiling.Q.value = 0.6

    const out = ctx.createGain()
    out.gain.value = MAKEUP

    // the honk and the clipping together push peaks over full scale; a limiter catches them
    const lid = ctx.createDynamicsCompressor()
    lid.threshold.value = -8; lid.knee.value = 4; lid.ratio.value = 12; lid.attack.value = 0.003; lid.release.value = 0.12

    source.connect(thin).connect(honk).connect(buzz).connect(grit).connect(ceiling).connect(out).connect(lid).connect(ctx.destination)
  } catch {
    // No graph, no rasp: the clip still plays, and still pitched up.
  }
}

function softClip(drive: number) {
  const n = 1024, curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive)
  }
  return curve
}
