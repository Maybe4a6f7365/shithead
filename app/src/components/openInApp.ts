// ============================================================================
// Android hand-off. A Chrome-installed PWA is a real Android package (a
// WebAPK) whose intent filter claims every URL in the manifest scope, so an
// invite normally opens the installed app. In-app browsers (WhatsApp and
// friends) render the link in their own WebView and never let Android resolve
// it, which is where the hand-off is lost. An intent: URL asks Android to
// resolve the same https invite itself: the installed app takes it, and
// browser_fallback_url covers the case where nothing is installed.
// iOS has no equivalent — home-screen web apps cannot claim links at all — so
// this is deliberately Android-only.
// ============================================================================

/** Android intent: URL for an https invite, with the invite as its fallback. */
export function androidIntentUrl(httpsUrl: string): string {
  const url = new URL(httpsUrl)
  const fallback = encodeURIComponent(url.toString())
  return [
    `intent://${url.host}${url.pathname}${url.search}#Intent`,
    'scheme=https',
    'action=android.intent.action.VIEW',
    `S.browser_fallback_url=${fallback}`,
    'end',
  ].join(';')
}

/**
 * Only offer the hand-off where it can do something: Android, in a browser
 * tab. Standalone means the player is already in the installed app.
 */
export function canHandOffToAndroidApp(
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  standalone = typeof window !== 'undefined'
    && (window.matchMedia?.('(display-mode: standalone)').matches ?? false),
): boolean {
  if (standalone) return false
  return /android/i.test(userAgent)
}
