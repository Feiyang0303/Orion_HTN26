import { createRoot } from 'react-dom/client'
import App from './App'
import './theme.css'
import { initTelemetry } from './telemetry'

// No StrictMode: its dev double-mount opens two Google tile sessions on one
// renderer and the second one 400s. Production never double-mounts anyway.
// Before anything renders, so an error during the first render is captured too.
initTelemetry()
createRoot(document.getElementById('root')!).render(<App />)
