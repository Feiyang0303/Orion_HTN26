import { useEffect, useState } from 'react'
import Flythrough from '../Flythrough'
import type { Plan } from '../../types'

/* Test tab for generated plans, reached at /?plan-test=<planId> (default
   paris-short-v1). Loads /plans/<id>/plan.json, lists what the crew wrote, and
   flies it. Separate from /?fly-dev, which stays on the mock for demos. */
export default function PlanTest({ id }: { id: string }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')
  const [begin, setBegin] = useState(false)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    fetch(`/plans/${id}/plan.json`).then(r => r.ok ? r.json() : Promise.reject(new Error(`no plan at /plans/${id}/plan.json (${r.status})`)))
      .then(setPlan).catch(e => setError(String(e.message ?? e)))
  }, [id])

  if (error) return <p style={{ color: '#cdbfa6', padding: 24 }}>{error}</p>
  const legOf = (i: number) => plan?.legs[i]
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Flythrough plan={plan} begin={begin} onStopReached={(sid, i) => console.log('[plan-test] reached', i, sid)}
        onFinish={() => console.log('[plan-test] finished')} onExit={() => { setBegin(false); setOpen(true) }} />
      {plan && open && (
        <aside style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 340, overflowY: 'auto', padding: '20px 20px 90px',
          background: 'color-mix(in srgb, #0a0806 88%, transparent)', backdropFilter: 'blur(4px)', borderLeft: '1px solid #2b241c', color: '#cdbfa6', fontSize: 13, lineHeight: 1.5 }}>
          <h2 style={{ font: '400 26px var(--display)', margin: 0, color: '#e3d2ac' }}>{plan.city}</h2>
          <small style={{ color: '#9a8763' }}>{plan.mode} tour · {plan.stops.length} stops · generated live, not hardcoded</small>
          {plan.stops.map((s, i) => (
            <section key={s.id} style={{ marginTop: 18 }}>
              <h3 style={{ font: '400 19px var(--display)', margin: 0, color: '#e3d2ac' }}>{i + 1}. {s.name}</h3>
              <div style={{ color: '#9a8763' }}>{s.blurb}</div>
              {s.beats.map((b, j) => (
                <p key={j} style={{ margin: '8px 0 0' }}>
                  {b.targetId && <em style={{ color: '#f0b45e', fontStyle: 'normal' }}>→ {s.targets.find(t => t.id === b.targetId)?.name}: </em>}{b.text}
                </p>
              ))}
              {legOf(i) && <div style={{ marginTop: 10, color: '#9a8763' }}>↓ {Math.round(legOf(i)!.distanceM)} m · {Math.round(legOf(i)!.durationSec / 60)} min walk (Google Routes)</div>}
            </section>
          ))}
        </aside>
      )}
      {plan && (
        <button onClick={() => { setBegin(true); setOpen(false) }} disabled={begin} style={{ position: 'absolute', left: begin ? -999 : '50%', bottom: 48, transform: 'translateX(-50%)',
          padding: '12px 26px', background: '#9a6b3f', color: '#f4ead6', border: 0, fontSize: 15, letterSpacing: '.06em' }}>Begin tour</button>
      )}
      {begin && <button onClick={() => setOpen(o => !o)} style={{ position: 'absolute', left: 24, bottom: 26, background: 'none', border: '1px solid #3a3024', color: '#9a8763', padding: '8px 14px' }}>{open ? 'Hide' : 'Show'} plan</button>}
    </div>
  )
}
