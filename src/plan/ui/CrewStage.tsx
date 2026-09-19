import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { fold, MEMBER, type LedgerEntry } from '../../crew/roster'
import type { CrewEvent } from '../events'
import type { DayDraft } from '../session'
import { dayColour } from '../../ui/palette'

/* While the crew works: the crew, in the middle, doing it. Around them, the plan
 * as it takes shape (the places as they are found, grouped by day) and a strip
 * that says which phase of the work this is. Nothing here is decoration: every
 * figure is a real step in the pipeline, every line in the ledger is a real
 * event, and every place that appears was verified before it was shown. */

const PHASES = [
  { id: 'Scout', label: 'Choosing places', agent: 'Scout' },
  { id: 'Router', label: 'Routing the days', agent: 'Router' },
  { id: 'Narrator', label: 'Writing the guide', agent: 'Narrator' },
  { id: 'Auditor', label: 'Checking every line', agent: 'Auditor' },
] as const

export default function CrewStage({ city, events, drafts, error, onRetry, onBack }: {
  city: string
  events: CrewEvent[]
  drafts: DayDraft[]
  error: string
  onRetry: () => void
  onBack: () => void
}) {
  const { status, ledger } = useMemo(() => fold(events), [events])
  const active = PHASES.findIndex(p => status[p.agent].state === 'working')
  const reached = Math.max(active, ...PHASES.map((p, i) => (status[p.agent].state !== 'idle' ? i : -1)))

  return (
    <div className="cw">
      <header className="cw-top">
        <button className="o-btn quiet small" onClick={onBack}>← Start over</button>
        <div className="cw-title">
          <p className="o-eyebrow">The crew is working</p>
          <h1 className="o-title">{city}</h1>
        </div>
        <ol className="cw-phases" aria-label="Progress">
          {PHASES.map((p, i) => {
            const st = status[p.agent].state
            const on = i <= reached
            return (
              <li key={p.id} className={`${on ? 'is-on' : ''} ${i === active ? 'is-now' : ''} ${st === 'done' ? 'is-done' : ''}`} style={{ ['--c' as string]: MEMBER[p.agent].colour }}>
                <i /><span>{p.label}</span>
              </li>
            )
          })}
        </ol>
      </header>

      <div className="cw-body">
        <aside className="cw-ledger o-glass">
          <div className="cw-ledger-head"><span>The ledger</span><b>{ledger.length}</b></div>
          <ul>
            <AnimatePresence initial={false}>
              {ledger.slice(-9).reverse().map(e => <Entry key={e.id} e={e} />)}
            </AnimatePresence>
            {!ledger.length && <li className="cw-empty"><span>Waiting for the crew…</span></li>}
          </ul>
          {error && (
            <div className="cw-error" role="alert">
              <p>{error}</p>
              <div><button className="o-btn primary small" onClick={onRetry}>Try again</button></div>
            </div>
          )}
        </aside>

        {/* the middle is left empty on purpose: the globe and the crew are behind it */}
        <div className="cw-centre" aria-hidden />

        <aside className="cw-found">
          <p className="o-eyebrow">Taking shape</p>
          <div className="cw-found-list">
            <AnimatePresence>
              {drafts.length === 0 && <motion.p key="wait" className="o-muted cw-hint" exit={{ opacity: 0 }}>The first places will appear here as soon as they have been checked against a real source.</motion.p>}
              {drafts.map((d, di) => (
                <motion.section key={di} className="cw-day o-glass" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 * di, duration: .6, ease: [.22, .9, .24, 1] }}
                  style={{ ['--c' as string]: dayColour(di) }}>
                  <h3><i />{drafts.length > 1 ? `Day ${di + 1}` : 'The day'}<span>{d.title}</span></h3>
                  <ul>
                    {d.stops.map((s, k) => (
                      <motion.li key={s.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .08 * k + .2 }}>
                        <b>{k + 1}</b>{s.name}<em>{s.visitMin}′</em>
                      </motion.li>
                    ))}
                  </ul>
                </motion.section>
              ))}
            </AnimatePresence>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Entry({ e }: { e: LedgerEntry }) {
  return (
    <motion.li layout initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: .5, ease: [.22, .9, .24, 1] }}
      className={e.failed ? 'is-failed' : ''} style={{ ['--c' as string]: MEMBER[e.agent].colour }}>
      <i /><span><b>{MEMBER[e.agent].name}</b> {e.text.length > 110 ? e.text.slice(0, 109) + '…' : e.text}</span>
    </motion.li>
  )
}
