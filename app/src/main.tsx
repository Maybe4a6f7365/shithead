import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { installBrowserAudioBackend } from './components/soundManager'
import { registerServiceWorker } from './swUpdate'
import './styles/index.css'
import './styles/performance.css'

// Android browser chrome can leave CSS viewport units taller than the area a
// player can actually see and tap. Keep the clipped app shell tied to the live
// visual viewport so the hand never falls behind the bottom browser controls.
let viewportSyncFrame = 0
const syncAppViewportHeight = () => {
  const height = window.visualViewport?.height ?? window.innerHeight
  if (height > 0) {
    document.documentElement.style.setProperty('--app-viewport-height', `${Math.floor(height)}px`)
  }
}
const scheduleAppViewportHeightSync = () => {
  if (viewportSyncFrame) return
  viewportSyncFrame = window.requestAnimationFrame(() => {
    viewportSyncFrame = 0
    syncAppViewportHeight()
  })
}

syncAppViewportHeight()
window.addEventListener('resize', scheduleAppViewportHeightSync, { passive: true })
window.visualViewport?.addEventListener('resize', scheduleAppViewportHeightSync, { passive: true })

installBrowserAudioBackend()

// The service worker only exists in production builds. Registration and the
// single, bounded reload after an update live in swUpdate.ts.
if (import.meta.env.PROD) registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
