import type { Stop } from '../types'

/** What the book UI listens to while the crew works. `tool` = plain code
    (Geocode, Router, Timekeeper), `agent` = an LLM call. The UI labels them
    that way, because a person deserves to know which sentences on the page
    were written by a model and which were counted by a machine. */
export type Agent = 'Geocode' | 'Scout' | 'Router' | 'Timekeeper' | 'Critic' | 'Narrator' | 'Auditor' | 'Voice'

/** One objection from a judge (Critic, Timekeeper, Auditor). `owner` is who
    must fix it — Scout re-picks, Narrator rewrites, etc. */
export type Issue = { id: string; text: string; owner: Agent }

export type CrewEvent =
  | { type: 'crew'; agent: Agent; kind: 'tool' | 'agent'
      state: 'working' | 'done' | 'reworking' | 'failed'; detail: string }
  | { type: 'verdict'; judge: Agent; scope: string; ok: boolean; issues: Issue[] }
  | { type: 'stop'; index: number; stop: Stop }   // a page is ready to show; index is its final position
  | { type: 'plan'; plan: import('../types').Plan }  // one day, restated as it settles
  | { type: 'trip'; trip: import('../types').Trip }  // the whole thing, once every day is written

export const verdict = (judge: Agent, scope: string, issues: Issue[]): Extract<CrewEvent, { type: 'verdict' }> =>
  ({ type: 'verdict', judge, scope, ok: issues.length === 0, issues })
