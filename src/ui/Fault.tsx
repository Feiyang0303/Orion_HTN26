import { openFeedback, telemetryOn, type Fault } from '../telemetry'

/** The error the person can read. Message first, then a Sentry event id they
    can quote, then a way to send a note that carries the replay with it. */
export default function Fault({
  message, eventId, where, onRetry, retryLabel = 'Try again',
}: {
  message: string
  eventId?: string
  where?: Fault['where']
  onRetry?: () => void
  retryLabel?: string
}) {
  return (
    <div className="fault" role="alert">
      <p>{message}</p>
      {(eventId || where) && (
        <p className="fault-ref">
          {where && <span>{where}</span>}
          {eventId && <code title="Sentry event id">{eventId}</code>}
        </p>
      )}
      <div className="fault-actions">
        {onRetry && <button className="o-btn primary small" type="button" onClick={onRetry}>{retryLabel}</button>}
        {telemetryOn && <button className="o-btn small" type="button" onClick={() => void openFeedback(eventId)}>Send a note</button>}
      </div>
    </div>
  )
}
