// ============================================================================
// NameField (§7.6) — single field, visible <label>, max 12 chars, persisted.
// ============================================================================
import clsx from 'clsx'

export interface NameFieldProps {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onDark?: boolean
}

export const NAME_STORAGE_KEY = 'shithead:name'

export function loadSavedName(fallback: string): string {
  try { return localStorage.getItem(NAME_STORAGE_KEY) || fallback } catch { return fallback }
}

export function saveName(name: string): void {
  try { if (name.trim()) localStorage.setItem(NAME_STORAGE_KEY, name.trim()) } catch { /* ignore */ }
}

export function NameField({ id, label, value, onChange, placeholder = 'Your name', onDark }: NameFieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className={clsx(
          'block text-label font-bold tracking-label uppercase mb-s1',
          onDark ? 'text-cream-dim' : 'text-ink-soft',
        )}
      >
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value.slice(0, 12))}
        placeholder={placeholder}
        maxLength={12}
        autoComplete="off"
        className={clsx(
          'w-full min-h-[48px] px-s3 rounded-button text-body',
          onDark
            ? 'bg-felt-deep text-cream placeholder:text-cream-dim border border-hairline'
            : 'bg-cream text-ink placeholder:text-ink-soft border border-card-edge',
        )}
      />
    </div>
  )
}
