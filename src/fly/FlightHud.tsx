import { useMemo, type MutableRefObject } from 'react'
import type { Quality } from './quality'
import type { Transport } from '../types'

/* The only chrome during the flight: where you are, what the guide is saying,
   and three controls. Everything else stays out of the way of the city. */

export type Hud = {
  phase: 'idle' | 'hold' | 'dive' | 'dwell' | 'travel' | 'done'
  stopIndex: number; stopCount: number; stopName: string
  caption: string; captionProgress: number; targetName: string; targetSource: string
  /** Why this shot is taken from where it is, when the director that looks chose it. */
  direction: string
  paused: boolean; progress: number
  /** How the leg being flown is travelled, while one is. */
  transport?: Transport
}

/** It said "Walking to" whatever the leg was, over a caption telling you which bus to catch. */
const GOING: Record<Transport, string> = { walk: 'Walking', cycle: 'Cycling', transit: 'Riding', drive: 'Driving' }
export type Control = { paused: boolean; skip: boolean; restart: boolean }

export default function FlightHud({ hud, control, quality, onQuality, onExit, onAsk }: {
  hud: Hud; control: MutableRefObject<Control>; onExit?: () => void
  /** How sharp the city is asked to be (see quality.ts), and the switch for it. */
  quality: Quality; onQuality: () => void
  /** Hold the flight and talk to the guide. */
  onAsk?: () => void
}) {
  const done = hud.phase === 'done'
  /** Questions belong to a stop: the guide is only asked about what is under them. */
  const atAPlace = hud.phase === 'dwell'
  const label = hud.phase === 'hold' ? (hud.stopIndex ? 'That was the day' : 'Before we set off')
    : hud.phase === 'dive' ? 'Beginning the tour' : done ? 'Tour complete'
    : hud.phase === 'travel' ? `${GOING[hud.transport ?? 'walk'] ?? 'On the way'} to stop ${hud.stopIndex + 1} of ${hud.stopCount}` : `Stop ${hud.stopIndex + 1} of ${hud.stopCount}`
  /* Long narration is read as short subtitle cues. Word count tracks speech
     closely enough to keep the visible phrase near what is being heard, while
     punctuation prevents a sentence from being split at an awkward moment. */
  const captionCues = useMemo(() => {
    const words = hud.caption.trim().split(/\s+/).filter(Boolean)
    const cues: string[] = []; let cue: string[] = []
    for (const word of words) {
      cue.push(word)
      if (cue.length >= 14 || (cue.length >= 8 && /[.!?][”"']?$/.test(word))) { cues.push(cue.join(' ')); cue = [] }
    }
    if (cue.length) cues.push(cue.join(' '))
    return cues
  }, [hud.caption])
  const cueIndex = Math.min(captionCues.length - 1, Math.max(0, Math.floor(hud.captionProgress * captionCues.length)))
  const captionCue = captionCues[cueIndex] ?? hud.caption
  return (
    <>
      <div className="hud-top">
        <small>{label}</small>
        <b>{hud.phase === 'dive' || hud.phase === 'hold' ? '' : hud.stopName}</b>
      </div>
      {hud.caption && (
        <div className="hud-caption" aria-live="polite" title={hud.direction || undefined}>
          {hud.targetName && <small>Look at · {hud.targetName}</small>}
          <p key={`${hud.caption}:${cueIndex}`}>{captionCue}</p>
        </div>
      )}
      <div className="hud-controls">
        {!done && <button onClick={() => { control.current.paused = !control.current.paused }}>{hud.paused ? 'Resume' : 'Pause'}</button>}
        {!done && <button onClick={() => { control.current.skip = true }} disabled={hud.stopIndex >= hud.stopCount - 1 && hud.phase === 'dwell'}>Next stop</button>}
        {/* Asking holds the flight itself — a guide you have to pause first,
            then find a button for, is not one you would interrupt.

            Only over a place, never on the way. "What is that?" has an answer
            when there is a thing under you and the guide has just been talking
            about it; halfway down a street between two stops there is nothing
            for the question to be about, and the guide would be answering
            about a place they have already left. The button stays visible and
            says why, because one that appears and disappears is worse than one
            that waits. */}
        {!done && onAsk && (
          <button onClick={onAsk} disabled={!atAPlace}
            title={atAPlace ? undefined : 'You can ask once you are over a place'}>
            Ask the guide
          </button>
        )}
        {done && <button onClick={() => { control.current.restart = true }}>Fly it again</button>}
        <button className="quiet" onClick={onQuality} aria-pressed={quality === 'high'}
          title={quality === 'high' ? 'The sharpest the map has, and more of it kept in memory. Switch to standard if the flight stutters.' : 'Lighter on the machine. Switch to high for the sharpest the map has.'}>
          Detail · {quality === 'high' ? 'high' : 'standard'}
        </button>
        {onExit && <button className="quiet" onClick={onExit}>{done ? 'Back to the book' : 'End tour'}</button>}
      </div>
      <div className="hud-progress" style={{ ['--p' as string]: hud.progress }} />
    </>
  )
}
