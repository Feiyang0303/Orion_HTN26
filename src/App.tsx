import { useState } from 'react'
import ErrorBoundary from './ui/ErrorBoundary'

/* The shell. One canvas (tiles, owned by src/fly) sits behind one overlay
 * (the book, owned by src/plan) from the first frame, so tiles preload while
 * the user reads. Ownership hands over at "Begin tour".
 *
 *   ask  ->  planning  ->  reading  ->  flying  ->  done
 *   A owns everything up to and including reading; B owns flying.
 */
export type Phase = 'ask' | 'planning' | 'reading' | 'flying' | 'done'

export default function App() {
  const [phase] = useState<Phase>('ask')
  return (
    <ErrorBoundary>
      <main data-ground="parchment" style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--ground)' }}>
        <p style={{ fontFamily: 'var(--display)', fontSize: 28 }}>Orion — scaffold ({phase})</p>
      </main>
    </ErrorBoundary>
  )
}
