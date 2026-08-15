const TAKE_IT_STORAGE_KEY = 'shithead:feature:take-it'

/**
 * Runtime kill switch for the Take it affordance. Query-string values win so
 * a release can be checked (or disabled) without rebuilding the application.
 * Persist `off` under the key below to disable it for subsequent visits.
 */
export function takeItFeatureEnabled(): boolean {
  if (typeof window === 'undefined') return true
  const queryValue = new URLSearchParams(window.location.search).get('takeIt')
  if (queryValue !== null) return queryValue !== '0' && queryValue !== 'off'
  try {
    return window.localStorage.getItem(TAKE_IT_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export { TAKE_IT_STORAGE_KEY }
