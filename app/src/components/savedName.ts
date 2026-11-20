// ============================================================================
// The player's name, remembered between visits so no lobby asks for it twice.
// ============================================================================
const NAME_STORAGE_KEY = 'shithead:name'

export function loadSavedName(fallback: string): string {
  try { return localStorage.getItem(NAME_STORAGE_KEY) || fallback } catch { return fallback }
}

export function saveName(name: string): void {
  try { if (name.trim()) localStorage.setItem(NAME_STORAGE_KEY, name.trim()) } catch { /* ignore */ }
}
