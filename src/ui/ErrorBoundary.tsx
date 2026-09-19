import { Component, type ErrorInfo, type ReactNode } from 'react'
import { lastEventId, report } from '../telemetry'
import Fault from './Fault'

/** A crash anywhere below shows a message and a retry, never a white screen,
    and goes to Sentry with the component stack that caused it. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; eventId?: string }> {
  state = { error: null as Error | null, eventId: undefined as string | undefined }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    const eventId = report(error, 'react.boundary', { level: 'fatal', extra: { componentStack: info.componentStack } })
    this.setState({ eventId: eventId ?? lastEventId() })
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ padding: 32, maxWidth: 520 }}>
        <h2 style={{ fontFamily: 'var(--display)', fontWeight: 400, color: 'var(--ink)' }}>Something went wrong</h2>
        <Fault
          message={this.state.error.message}
          eventId={this.state.eventId}
          where="react.boundary"
          onRetry={() => this.setState({ error: null, eventId: undefined })}
        />
      </div>
    )
  }
}
