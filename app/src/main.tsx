import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { installBrowserAudioBackend } from './components/soundManager'
import './styles/index.css'

const UPDATE_CHECK_MS = 60 * 60 * 1000

// Android browser chrome can leave CSS viewport units taller than the area a
// player can actually see and tap. Keep the clipped app shell tied to the live
// visual viewport so the hand never falls behind the bottom browser controls.
const syncAppViewportHeight = () => {
  const height = window.visualViewport?.height ?? window.innerHeight
  if (height > 0) {
    document.documentElement.style.setProperty('--app-viewport-height', `${Math.floor(height)}px`)
  }
}

syncAppViewportHeight()
window.addEventListener('resize', syncAppViewportHeight)
window.visualViewport?.addEventListener('resize', syncAppViewportHeight)

installBrowserAudioBackend()

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
