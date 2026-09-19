import type { Stop } from '../types'

/** What the book UI listens to while the crew works. `tool` = plain code
    (Geocode, Router, Timekeeper), `agent` = an LLM call. The UI labels them
    that way, because a person deserves to know which sentences on the page
    were written by a model and which were counted by a machine. */
export type Agent = 'Geocode' | 'Scout' | 'Router' | 'Timekeeper' | 'Critic' | 'Narrator' | 'Voice'

export type CrewEvent =
  | { type: 'crew'; agent: Agent; kind: 'tool' | 'agent'
      state: 'working' | 'done' | 'reworking' | 'failed'; detail: string }
  | { type: 'stop'; index: number; stop: Stop }   // a page is ready to show; index is its final position
  | { type: 'plan'; plan: import('../types').Plan }  // the whole book, restated as it settles
