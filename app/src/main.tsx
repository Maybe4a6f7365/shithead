import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import './styles/index.css'

const UPDATE_CHECK_MS = 60 * 60 * 1000

// autoUpdate reloads once when a genuinely new worker activates. Checking on
// startup, hourly, and when the tab becomes visible makes stale installed
// bundles short-lived without a polling/reload loop.
registerSW({
  immediate: true,
  onRegisteredSW(_scriptUrl, registration) {
    if (!registration) return
    const checkForUpdate = () => { void registration.update().catch(() => undefined) }
    checkForUpdate()
    window.setInterval(checkForUpdate, UPDATE_CHECK_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    })
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
