import { createRoot } from 'react-dom/client'
import App from './App'
import './theme.css'

// No StrictMode: its dev double-mount opens two Google tile sessions on one
// renderer and the second one 400s. Production never double-mounts anyway.
createRoot(document.getElementById('root')!).render(<App />)
