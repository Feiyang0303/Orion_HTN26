import type { Stop } from '../types'

/** What the book UI listens to while the crew works. `tool` = plain code
    (Router, Timekeeper), `agent` = an LLM call. The UI labels them that way. */
export type CrewEvent =
  | { type: 'crew'; agent: 'Scout' | 'Router' | 'Timekeeper' | 'Critic' | 'Narrator' | 'Voice'; kind: 'tool' | 'agent'
      state: 'working' | 'done' | 'reworking' | 'failed'; detail: string }
  | { type: 'stop'; index: number; stop: Stop }   // a page is ready to show; index is its final position
