import { Component, type ReactNode } from 'react'

/** Minimal: a crash anywhere below shows a message and a retry, never a white screen. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{ padding: 32, color: 'var(--ink)' }}>
        <h2 style={{ fontFamily: 'var(--display)', fontWeight: 400 }}>Something went wrong</h2>
        <p style={{ color: 'var(--muted)' }}>{this.state.error.message}</p>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    )
  }
}
