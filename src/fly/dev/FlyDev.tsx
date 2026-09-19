import { useState } from 'react'
import Flythrough from '../Flythrough'
import { mockPlan } from './mockPlan'

/* Dev harness, reached at /?fly-dev. Stands in for the book: shows the mock
   plan under a Begin button so the flight can be worked on in isolation. */
export default function FlyDev() {
  const [begin, setBegin] = useState(false)
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Flythrough
        plan={mockPlan} begin={begin}
        onStopReached={(id, i) => console.log('[fly] reached', i, id)}
        onFinish={() => console.log('[fly] finished')}
        onExit={() => setBegin(false)}
      />
      {!begin && (
        <button onClick={() => setBegin(true)} style={{
          position: 'absolute', left: '50%', bottom: 48, transform: 'translateX(-50%)', padding: '12px 26px',
          background: '#9a6b3f', color: '#f4ead6', border: 0, fontSize: 15, letterSpacing: '.06em',
        }}>Begin tour</button>
      )}
    </div>
  )
}
