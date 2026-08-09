// ============================================================================
// LandingScreen — a compact, mobile-first game launcher. Mode descriptions
// remain outside the buttons so their visible and accessible names stay terse.
// ============================================================================
import { useEffect, useRef, useState } from 'react'
import { RulesSheet } from './RulesSheet'
import { LegalSheet, type LegalSheetKind } from './LegalSheet'

export function LandingScreen({ onPlayOnline, onPassAndPlay }: { onPlayOnline: () => void; onPassAndPlay: () => void }) {
  const [rulesOpen, setRulesOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [legalOpen, setLegalOpen] = useState<LegalSheetKind | null>(null)
  const aboutDialogRef = useRef<HTMLDivElement>(null)
  const aboutCloseRef = useRef<HTMLButtonElement>(null)
  const aboutTriggerRef = useRef<HTMLButtonElement>(null)
  const commit = document.querySelector('meta[name="build-commit"]')?.getAttribute('content')
  const stamp = commit && commit !== 'local' ? commit.slice(0, 7) : 'v0.2.0'

  useEffect(() => {
    if (!aboutOpen) return

    aboutCloseRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setAboutOpen(false)
        return
      }

      if (event.key !== 'Tab') return
      const controls = aboutDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!controls?.length) return

      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      aboutTriggerRef.current?.focus()
    }
  }, [aboutOpen])

  return (
    <div className="app-viewport landing-screen bg-felt text-cream flex flex-col">
      <main className="landing-content">
        <header className="landing-masthead">
          <div className="landing-lockup">
            <div className="brand-mark" aria-hidden="true">
              <span className="brand-mark__back" />
              <span className="brand-mark__front">S</span>
            </div>
            <div>
              <span className="landing-lockup__name">Shithead</span>
              <span className="landing-lockup__meta">The shedding game</span>
            </div>
          </div>
          <span className="landing-ready"><span aria-hidden="true" />Ready to deal</span>
        </header>

        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero__copy">
            <p className="landing-kicker">Play dirty. Finish clean.</p>
            <h1 id="landing-title" className="brand-wordmark">
              <span>SHIT</span><span>HEAD</span>
            </h1>
            <p className="landing-copy">Empty your hand. Break the order. Don’t finish last.</p>
          </div>
          <div className="landing-card-stage" aria-hidden="true">
            <span className="landing-show-card landing-show-card--back" />
            <span className="landing-show-card landing-show-card--seven"><b>7</b><i>♣</i></span>
            <span className="landing-show-card landing-show-card--ten"><b>10</b><i>♦</i></span>
          </div>
        </section>

        <section className="landing-modes" aria-labelledby="game-mode-title">
          <div className="landing-modes__heading">
            <div>
              <p className="landing-section-label">Pick your table</p>
              <h2 id="game-mode-title">Choose game mode</h2>
            </div>
            <span aria-hidden="true">01 / 02</span>
          </div>
          <div className="landing-mode-grid">
            <article className="landing-mode-choice landing-mode-choice--online">
              <button
                type="button"
                onClick={onPlayOnline}
                className="landing-mode-button"
                aria-describedby="online-mode-description"
              >
                <span className="landing-mode-icon landing-mode-icon--online" aria-hidden="true" />
                <span>Online</span>
              </button>
              <p id="online-mode-description">Private rooms · 2–5 players</p>
            </article>
            <article className="landing-mode-choice landing-mode-choice--offline">
              <button
                type="button"
                onClick={onPassAndPlay}
                className="landing-mode-button"
                aria-describedby="offline-mode-description"
              >
                <span className="landing-mode-icon landing-mode-icon--offline" aria-hidden="true" />
                <span>Offline</span>
              </button>
              <p id="offline-mode-description">Pass &amp; play · or vs computer</p>
            </article>
          </div>
        </section>
      </main>
      <footer className="app-bottom-zone landing-footer">
        <nav className="landing-links" aria-label="Information">
          <button type="button" onClick={() => setRulesOpen(true)}>Rules</button>
          <button ref={aboutTriggerRef} type="button" onClick={() => setAboutOpen(true)}>About</button>
          <button type="button" onClick={() => setLegalOpen('privacy')}>Privacy</button>
          <button type="button" onClick={() => setLegalOpen('imprint')}>Impressum</button>
        </nav>
        <span className="landing-build" aria-label={`Build ${stamp}`}>{stamp}</span>
      </footer>

      <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} />
      <LegalSheet kind="privacy" open={legalOpen === 'privacy'} onClose={() => setLegalOpen(null)} />
      <LegalSheet kind="imprint" open={legalOpen === 'imprint'} onClose={() => setLegalOpen(null)} />
      {aboutOpen && (
        <div
          ref={aboutDialogRef}
          className="fixed inset-0 z-scrim bg-scrim flex items-center justify-center p-s4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="about-title"
        >
          <div className="surface-panel w-full max-w-[340px] bg-cream text-ink rounded-button p-s5 text-center">
            <h2 id="about-title" className="font-display text-title font-semibold mb-s2">Shithead</h2>
            <p className="text-body text-ink-soft">
              The classic shedding card game. Pass &amp; play with friends, take on the
              computer, or play online in a room of up to five.
            </p>
            <button
              ref={aboutCloseRef}
              type="button"
              onClick={() => setAboutOpen(false)}
              className="primary-action mt-s4 w-full px-s5 text-button font-bold tracking-button uppercase"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
