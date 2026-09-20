import type { Direction, Plan } from '../types'

/* How the crew's Director gets to look at the city.
 *
 * The Director is one of the crew, and works in the planning stage with the rest of them. But what it does is look,
 * and the only thing that can show it a place is the canvas the real city is drawn in, which is a long way from the
 * code that plans a trip. So there is a desk between them. The planner leaves a day at the desk and waits; the city's
 * canvas, which is already there behind the crew loading the places as they are found, takes it up (DirectorDesk),
 * walks round each thing the guide will talk about, and hands back where each shot should be taken from.
 *
 * The planner never waits on this for long. It says when it wants the day back (`until`), and gets whatever has been
 * chosen by then; if nothing ever comes to the desk (no map key, no WebGL) it is told so almost at once. Whatever
 * was not looked at in time is looked at when the day is first flown, as every shot used to be.
 *
 * Nothing here knows about three.js, so the planner can import it without dragging the renderer along.
 */

export type DeskJob = {
  plan: Plan
  /** What is being looked at now, and which of how many it is (from 1). */
  note: (subject: string, nth: number, total: number) => void
  /** Hand the day back. Null if nothing could be looked at. */
  finish: (d: Direction | null) => void
  /** Set when the planner has stopped waiting: whoever has the job should hand back what it has. */
  called: boolean
}

const NOBODY_THERE_SEC = 12

const waiting: DeskJob[] = []
let open = 0

/** The canvas's side: is there a day waiting? */
export const nextJob = () => waiting.shift() ?? null
/** The canvas's side: someone is at the desk from now until the returned function is called. */
export function openDesk() { open++; return () => { open-- } }

/** The planner's side. Resolves with the Director's choices for this day: all of them, or those made by the time
    `until` settles, or null if the city could not be looked at. Never rejects. */
export function direct(plan: Plan, opts: { until: Promise<unknown>; note?: DeskJob['note'] }): Promise<Direction | null> {
  return new Promise(resolve => {
    let settled = false
    const job: DeskJob = {
      plan, called: false, note: opts.note ?? (() => {}),
      finish: d => { if (!settled) { settled = true; clearTimeout(nobody); resolve(d) } },
    }
    waiting.push(job)
    const leave = () => { const i = waiting.indexOf(job); if (i >= 0) { waiting.splice(i, 1); job.finish(null) } else job.called = true }
    const nobody = setTimeout(() => { if (!open) leave() }, NOBODY_THERE_SEC * 1000)
    void opts.until.then(leave, leave)
  })
}
