import { useState } from 'react'
import ErrorBoundary from './ui/ErrorBoundary'
import FlyDev from './fly/dev/FlyDev'

/* The shell. One canvas (tiles, owned by src/fly) sits behind one overlay
 * (the book, owned by src/plan) from the first frame, so tiles preload while
 * the user reads. Ownership hands over at "Begin tour".
 *
 *   ask  ->  planning  ->  reading  ->  flying  ->  done
 *   A owns everything up to and including reading; B owns flying.
 */
export type Phase = 'ask' | 'planning' | 'reading' | 'flying' | 'done'

export default function App() {
  // Dev-only harness for the flythrough (src/fly), independent of the book.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('fly-dev')) return <ErrorBoundary><FlyDev /></ErrorBoundary>
  const [phase] = useState<Phase>('ask')
  return (
    <ErrorBoundary>
      <main data-ground="parchment" style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--ground)' }}>
        <p style={{ fontFamily: 'var(--display)', fontSize: 28 }}>Orion — scaffold ({phase})</p>
      </main>
    </ErrorBoundary>
  )
}
