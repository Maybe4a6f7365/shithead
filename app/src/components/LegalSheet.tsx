import { useEffect, useRef } from 'react'

export type LegalSheetKind = 'privacy' | 'imprint'

export interface LegalSheetProps {
  kind: LegalSheetKind
  open: boolean
  onClose: () => void
}

export function LegalSheet({ kind, open, onClose }: LegalSheetProps) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    returnFocus.current = document.activeElement as HTMLElement | null
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('*') ?? [])
        .filter(element => (
          element.matches('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
          && !element.hasAttribute('hidden')
        ))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      returnFocus.current?.focus()
    }
    // The sheet lifetime is keyed only by `open`; callers commonly pass an
    // inline close callback, which must not restart focus management.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const title = kind === 'privacy' ? 'Privacy' : 'Impressum'
  return (
    <div className="sheet-scrim legal-scrim fixed inset-0 z-scrim bg-scrim flex items-end sm:items-center justify-center p-s3 sm:p-s4" role="presentation" data-sheet={kind} onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        ref={dialog}
        className="sheet-panel legal-sheet surface-panel w-full max-w-[520px] max-h-[min(86dvh,720px)] overflow-y-auto bg-cream text-ink rounded-[24px] p-s5"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`legal-${kind}-title`}
      >
        <header className="sheet-header legal-sheet__header flex items-start justify-between gap-s3">
          <div>
            <p className="sheet-kicker text-label font-bold tracking-label uppercase text-ink-soft">Shithead demo</p>
            <h2 id={`legal-${kind}-title`} className="sheet-title font-display text-title font-semibold mt-s1">{title}</h2>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            className="sheet-close legal-close"
            aria-label={`Close ${title}`}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="sheet-body legal-sheet__body">
          {kind === 'privacy' ? <PrivacyNotice /> : <Imprint />}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="sheet-action phase-action phase-action--primary primary-action mt-s5 w-full px-s5 text-button font-bold tracking-button uppercase"
        >
          Close
        </button>
      </section>
    </div>
  )
}

function PrivacyNotice() {
  return (
    <div className="legal-copy mt-s4 text-body text-ink-soft">
      <p className="text-small">Effective: 9 August 2026</p>
      <p>
        This demo processes only the information needed to run a game and restore an online seat. Do not use sensitive personal information as a player name.
      </p>

      <h3>On this device</h3>
      <p>
        Your player name, sound preference, and online-room session are stored in your browser. The room session contains the room code, player ID, rotating resume token, and player name. The installed PWA also caches static app files for offline loading. You can remove these items by clearing this site’s browser data.
      </p>

      <h3>During online play</h3>
      <p>
        The Cloudflare-hosted game service receives your room code, player name, game actions, and connection messages. A room stores its roster, authoritative game state and recent game log, plus hashes of resume tokens. Emote events are delivered live and are not stored with the room.
      </p>

      <h3>Hosting and retention</h3>
      <p>
        Cloudflare may process standard network and security data, including IP-address and request metadata, to deliver and protect the service. See the{' '}
        <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">Cloudflare privacy policy</a>.
        Room data is scheduled for deletion after 24 hours without activity once nobody remains connected. A successful explicit Leave while connected removes your seat and its resume credential; clearing browser data removes the local copy.
      </p>

      <h3>No tracking</h3>
      <p>
        This app does not include advertising, analytics, or user-tracking code and does not set advertising cookies.
      </p>

      <h3>Contact</h3>
      <p>
        Privacy questions: <a href="mailto:kontakt@schalt-werk.com">kontakt@schalt-werk.com</a>
      </p>
    </div>
  )
}

function Imprint() {
  return (
    <div className="legal-copy mt-s4 text-body text-ink-soft">
      <h3>Angaben gemäß § 5 DDG</h3>
      <p>
        José Manuel Matas Villavicencio<br />
        Muffendorferstr 32<br />
        53177 Bonn<br />
        Deutschland
      </p>
      <p>
        E-Mail: <a href="mailto:kontakt@schalt-werk.com">kontakt@schalt-werk.com</a><br />
        Webseite:{' '}
        <a href="https://schalt-werk.com" target="_blank" rel="noreferrer">schalt-werk.com</a>
      </p>

      <h3>Verantwortlich nach § 18 Abs. 2 MStV</h3>
      <p>José Manuel Matas Villavicencio, Anschrift wie oben.</p>
    </div>
  )
}
