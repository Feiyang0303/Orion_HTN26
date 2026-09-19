import type { MutableRefObject } from 'react'

/* The only chrome during the flight: where you are, what the guide is saying,
   and three controls. Everything else stays out of the way of the city. */

export type Hud = {
  phase: 'idle' | 'dive' | 'dwell' | 'travel' | 'done'
  stopIndex: number; stopCount: number; stopName: string
  caption: string; targetName: string; targetSource: string
  paused: boolean; progress: number
}
export type Control = { paused: boolean; skip: boolean; restart: boolean }

export default function FlightHud({ hud, control, onExit, onAsk }: {
  hud: Hud; control: MutableRefObject<Control>; onExit?: () => void
  /** Hold the flight and talk to the guide. */
  onAsk?: () => void
}) {
  const done = hud.phase === 'done'
  const label = hud.phase === 'dive' ? 'Beginning the tour' : done ? 'Tour complete'
    : hud.phase === 'travel' ? `Walking to stop ${hud.stopIndex + 1} of ${hud.stopCount}` : `Stop ${hud.stopIndex + 1} of ${hud.stopCount}`
  return (
    <>
      <div className="hud-top">
        <small>{label}</small>
        <b>{hud.phase === 'dive' ? '' : hud.stopName}</b>
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
            then find a button for, is not one you would interrupt. */}
        {!done && onAsk && <button onClick={onAsk}>Ask the guide</button>}
        {done && <button onClick={() => { control.current.restart = true }}>Fly it again</button>}
        {onExit && <button className="quiet" onClick={onExit}>{done ? 'Back to the book' : 'End tour'}</button>}
      </div>
      <div className="hud-progress" style={{ ['--p' as string]: hud.progress }} />
    </>
  )
}
