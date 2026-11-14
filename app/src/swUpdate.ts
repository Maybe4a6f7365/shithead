// ============================================================================
// Service-worker registration and the one automatic reload an update may
// cause. The reload is owned here, not by the PWA plugin's client, so it can
// be bounded: a browser that keeps reporting a "new" worker (for example while
// a deploy is still propagating and old and new sw.js are served alternately)
// must never be able to refresh the page in a loop.
// ============================================================================

export const AUTO_RELOAD_COOLDOWN_MS = 60_000
export const AUTO_RELOAD_STORAGE_KEY = 'shithead:sw-auto-reload-at'
const UPDATE_CHECK_MS = 60 * 60 * 1000

/**
 * Reload for a new worker only when this page was already controlled at
 * startup (a real update, not a first install), at most once per page load,
 * and never again within the cooldown of the previous automatic reload.
 */
export function shouldAutoReload(
  hadControllerAtStartup: boolean,
  reloadedThisPageLoad: boolean,
  lastAutoReloadAt: number | null,
  now: number,
  cooldownMs = AUTO_RELOAD_COOLDOWN_MS,
): boolean {
  if (!hadControllerAtStartup || reloadedThisPageLoad) return false
  if (lastAutoReloadAt === null || !Number.isFinite(lastAutoReloadAt)) return true
  const elapsed = now - lastAutoReloadAt
  // A clock that moved backwards must not disable updates forever.
  return elapsed < 0 || elapsed >= cooldownMs
}

function readLastAutoReload(): number | null {
  try {
    const raw = window.sessionStorage.getItem(AUTO_RELOAD_STORAGE_KEY)
    if (raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

/** False when the timestamp could not be stored; the caller then stays put. */
function writeLastAutoReload(now: number): boolean {
  try {
    window.sessionStorage.setItem(AUTO_RELOAD_STORAGE_KEY, String(now))
    return window.sessionStorage.getItem(AUTO_RELOAD_STORAGE_KEY) === String(now)
  } catch {
    return false
  }
}

export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const container = navigator.serviceWorker
  const hadControllerAtStartup = Boolean(container.controller)
  let reloaded = false

  container.addEventListener('controllerchange', () => {
    const now = Date.now()
    if (!shouldAutoReload(hadControllerAtStartup, reloaded, readLastAutoReload(), now)) return
    // Without a stored timestamp the next page load could not tell that it
    // was just reloaded. Keep running the loaded bundle instead of risking a
    // loop; the next manual launch picks up the new shell.
    if (!writeLastAutoReload(now)) return
    reloaded = true
    window.location.reload()
  })

  // Startup, hourly, and on return to the tab: stale installed bundles stay
  // short-lived without polling.
  void container.register('/sw.js', { scope: '/' }).then(registration => {
    const checkForUpdate = () => { void registration.update().catch(() => undefined) }
    checkForUpdate()
    window.setInterval(checkForUpdate, UPDATE_CHECK_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    })
  }).catch(() => undefined)
}
