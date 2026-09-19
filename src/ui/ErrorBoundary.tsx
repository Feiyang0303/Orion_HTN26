import { Component, type ErrorInfo, type ReactNode } from 'react'
import { lastEventId, report } from '../telemetry'

/** A crash anywhere below shows a message and a retry, never a white screen,
    and goes to Sentry with the component stack that caused it. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; eventId?: string }> {
  state = { error: null as Error | null, eventId: undefined as string | undefined }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    report(error, 'react.boundary', { level: 'fatal', extra: { componentStack: info.componentStack } })
    this.setState({ eventId: lastEventId() })
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{ padding: 32, color: 'var(--ink)' }}>
        <h2 style={{ fontFamily: 'var(--display)', fontWeight: 400 }}>Something went wrong</h2>
        <p style={{ color: 'var(--muted)' }}>{this.state.error.message}</p>
        {this.state.eventId && <p style={{ color: 'var(--faint)', fontSize: 12 }}>Reference {this.state.eventId}</p>}
        <button onClick={() => this.setState({ error: null, eventId: undefined })}>Try again</button>
      </div>
    )
  }
}
