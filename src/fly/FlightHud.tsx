import type { MutableRefObject } from 'react'
import type { Quality } from './quality'

/* The only chrome during the flight: where you are, what the guide is saying,
   and three controls. Everything else stays out of the way of the city. */

export type Hud = {
  phase: 'idle' | 'hold' | 'dive' | 'dwell' | 'travel' | 'done'
  stopIndex: number; stopCount: number; stopName: string
  caption: string; targetName: string; targetSource: string
  paused: boolean; progress: number
}
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
    : hud.phase === 'travel' ? `Walking to stop ${hud.stopIndex + 1} of ${hud.stopCount}` : `Stop ${hud.stopIndex + 1} of ${hud.stopCount}`
  return (
    <>
      <div className="hud-top">
        <small>{label}</small>
        <b>{hud.phase === 'dive' || hud.phase === 'hold' ? '' : hud.stopName}</b>
      </div>
      {hud.caption && (
        <div className="hud-caption" aria-live="polite">
          {hud.targetName && <small>Look at · {hud.targetName}</small>}
          <p>{hud.caption}</p>
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
