import type { Agent, CrewEvent, Issue } from '../plan/events'

/* The crew, as it is drawn. Kept apart from the scene so the same roster names
   the figures, colours their work in every other screen, and says which of them
   are agents (a model wrote the sentence) and which are tools (code counted it):
   a person deserves to know which is which. */

export type Prop = 'globe' | 'spyglass' | 'compass' | 'clock' | 'lens' | 'quill' | 'stamp' | 'mic' | 'camera'
export type Hat = 'cap' | 'hood' | 'beret' | 'bun' | 'band' | 'none'

export type Member = {
  id: Agent
  name: string
  kind: 'agent' | 'tool'
  colour: string
  role: string          // what it is doing, in a phrase, when it has nothing more specific to say
  prop: Prop
  hat: Hat
  skin: string
}

export const CREW: Member[] = [
  { id: 'Geocode',    name: 'Surveyor',     kind: 'tool',  colour: '#8ab4ff', role: 'Fixing the city on the map',          prop: 'globe',    hat: 'cap',   skin: '#e8cdb0' },
  { id: 'Scout',      name: 'Scout',        kind: 'agent', colour: '#6fe0b5', role: 'Naming places worth flying to',        prop: 'spyglass', hat: 'hood',  skin: '#c99a76' },
  { id: 'Router',     name: 'Router',       kind: 'tool',  colour: '#5cc8ff', role: 'Measuring real streets',               prop: 'compass',  hat: 'beret', skin: '#f0d9c2' },
  { id: 'Timekeeper', name: 'Timekeeper',   kind: 'tool',  colour: '#ffc266', role: 'Fitting the day to the clock',         prop: 'clock',    hat: 'band',  skin: '#b98764' },
  { id: 'Critic',     name: 'Judger',       kind: 'agent', colour: '#ff8f8f', role: 'Finding what is wrong, sending others back', prop: 'lens',     hat: 'bun',   skin: '#e4bf9f' },
  { id: 'Narrator',   name: 'Narrator',     kind: 'agent', colour: '#c8a2ff', role: 'Writing what the guide will say',      prop: 'quill',    hat: 'beret', skin: '#d9ad86' },
  { id: 'Voice',      name: 'Voice',        kind: 'agent', colour: '#ff9ad5', role: 'Recording the narration',              prop: 'mic',      hat: 'none',  skin: '#c08d69' },
  { id: 'Director',   name: 'Director',     kind: 'agent', colour: '#ff9a4d', role: 'Walking round each place to choose the shot', prop: 'camera', hat: 'beret', skin: '#e0b892' },
]
export const MEMBER = Object.fromEntries(CREW.map(m => [m.id, m])) as Record<Agent, Member>

export type Status = { state: 'idle' | 'working' | 'done' | 'failed'; detail: string; serial: number }
export type LedgerEntry = { id: number; agent: Agent; text: string; failed: boolean }
export type BoardItem = Issue & { judge: Agent; open: boolean; fixing: boolean }

/** Fold the crew's event stream into what each figure is doing, the ledger, and
    the Judger's board: objections that are still open, and who is fixing them. */
export function fold(events: CrewEvent[]): { status: Record<Agent, Status>; ledger: LedgerEntry[]; board: BoardItem[] } {
  const status = Object.fromEntries(CREW.map(m => [m.id, { state: 'idle', detail: '', serial: 0 }])) as Record<Agent, Status>
  const ledger: LedgerEntry[] = []
  const scopes = new Map<string, BoardItem[]>()
  let n = 0
  for (const e of events) {
    if (e.type === 'crew') {
      const s = status[e.agent]
      if (!s) continue
      s.state = e.state === 'done' ? 'done' : e.state === 'failed' ? 'failed' : 'working'
      s.detail = e.detail
      s.serial = ++n
      if (e.state === 'done' || e.state === 'failed') ledger.push({ id: n, agent: e.agent, text: e.detail, failed: e.state === 'failed' })
    } else if (e.type === 'verdict') {
      const key = `${e.judge}:${e.scope}`
      scopes.set(key, e.ok && !e.issues.length
        ? (scopes.get(key) ?? []).map(i => ({ ...i, open: false }))
        : e.issues.map(i => ({ ...i, judge: e.judge, open: !e.ok, fixing: false })))
      if (!e.ok || e.issues.length) {
        ledger.push({
          id: ++n, agent: e.judge,
          text: e.ok ? 'Approved' : e.issues.map(i => i.text).join(' · '),
          failed: !e.ok,
        })
      }
    } else if (e.type === 'stop') {
      ledger.push({ id: ++n, agent: 'Narrator', text: `Page written: ${e.stop.name}`, failed: false })
    }
  }
  const busy = new Set(CREW.filter(m => status[m.id].state === 'working').map(m => m.id))
  const board = [...scopes.values()].flat().map(i => ({ ...i, fixing: i.open && busy.has(i.owner) }))
  return { status, ledger, board }
}
