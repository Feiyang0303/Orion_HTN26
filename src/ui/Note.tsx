import { useEffect, useState } from 'react'
import { lastFault, openFeedback, subscribeFaults, telemetryOn, type Fault } from '../telemetry'
import FaultView from './Fault'

/** Always on screen when Sentry is configured: a way to send a note (Replay
    attaches automatically) and, if something already failed, the last error
    so they can read it without opening DevTools. */
export default function Note() {
  const [fault, setFault] = useState<Fault | null>(lastFault)
  const [open, setOpen] = useState(false)
  useEffect(() => subscribeFaults(setFault), [])
  if (!telemetryOn && !fault) return null
  return (
    <div className="orion-note">
      {open && fault && (
        <div className="orion-note-card o-glass">
          <FaultView message={fault.message} eventId={fault.eventId} where={fault.where} />
          <button type="button" className="o-btn quiet small" onClick={() => setOpen(false)}>Hide</button>
        </div>
      )}
      <div className="orion-note-bar">
        {fault && !open && (
          <button type="button" className="orion-note-chip" onClick={() => setOpen(true)} title={fault.message}>
            {fault.eventId ? fault.eventId.slice(0, 8) : 'error'}
          </button>
        )}
        {telemetryOn && (
          <button type="button" className="o-btn small" onClick={() => void openFeedback(fault?.eventId)}>
            Something off?
          </button>
        )}
      </div>
    </div>
  )
}
