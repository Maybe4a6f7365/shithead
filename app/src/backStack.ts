// ============================================================================
// Back-button stack. The app has no URL routing, so the system Back gesture
// would leave it from any screen. Each open layer (a sheet, a sub-screen, a
// running match) registers one handler and one history entry; Back runs the
// newest handler instead of navigating away.
// ============================================================================
import { useEffect, useRef } from 'react'

type BackHandler = () => void

// One sentinel history entry stands in for the whole stack. Arming and
// disarming are deferred and coalesced, because a history.back() that races a
// pushState is dropped by browsers, which would desynchronise the two.
const handlers: BackHandler[] = []
let listening = false
let sentinelArmed = false
let disarming = false
let syncQueued = false

const hasHistory = () => typeof window !== 'undefined' && typeof window.history?.pushState === 'function'

function arm() {
  if (sentinelArmed || disarming) return
  // Same URL: an invite's ?room= must survive, and a reload stays put.
  window.history.pushState({ shitheadBack: true }, '')
  sentinelArmed = true
}

function sync() {
  syncQueued = false
  if (handlers.length > 0) {
    arm()
  } else if (sentinelArmed && !disarming) {
    disarming = true
    window.history.back()
  }
}

function queueSync() {
  if (syncQueued) return
  syncQueued = true
  setTimeout(sync, 0)
}

function onPopState() {
  sentinelArmed = false
  if (disarming) {
    // Our own back() landed; a layer opened meanwhile gets a fresh sentinel.
    disarming = false
    queueSync()
    return
  }
  handlers.pop()?.()
  queueSync()
}

/**
 * Register the newest Back target. The returned function removes it again
 * when the layer closes by any other means; it is a no-op once Back has
 * already consumed the handler.
 */
export function pushBackHandler(handler: BackHandler): () => void {
  if (!hasHistory()) return () => {}
  if (!listening) {
    window.addEventListener('popstate', onPopState)
    listening = true
    // After a reload the page may already sit on a sentinel entry.
    sentinelArmed = Boolean((window.history.state as { shitheadBack?: boolean } | null)?.shitheadBack)
  }
  handlers.push(handler)
  queueSync()
  return () => {
    const index = handlers.lastIndexOf(handler)
    if (index === -1) return
    handlers.splice(index, 1)
    queueSync()
  }
}

/** Back closes this layer while it is open. */
export function useBackDismiss(open: boolean, onDismiss: () => void, rearmKey: unknown = 0) {
  const latest = useRef(onDismiss)
  latest.current = onDismiss
  useEffect(() => {
    if (!open) return
    return pushBackHandler(() => latest.current())
  }, [open, rearmKey])
}

/** Test seam: forget every registration without touching history. */
export function resetBackStackForTests() {
  handlers.length = 0
  sentinelArmed = false
  disarming = false
}
