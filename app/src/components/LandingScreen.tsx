import { useRef, useState } from 'react'
import { RulesSheet } from './RulesSheet'
import { LegalSheet, type LegalSheetKind } from './LegalSheet'
import { useModalFocus } from './useModalFocus'

export function LandingScreen({ onPlayOnline, onPassAndPlay }: { onPlayOnline: () => void; onPassAndPlay: () => void }) {
  const [rulesOpen, setRulesOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [legalOpen, setLegalOpen] = useState<LegalSheetKind | null>(null)
  const aboutDialogRef = useRef<HTMLDivElement>(null)
  const aboutTriggerRef = useRef<HTMLButtonElement>(null)
  // Safari does not focus a button on click, so name the trigger outright.
  useModalFocus(aboutDialogRef, {
    open: aboutOpen,
    returnFocus: aboutTriggerRef,
    onEscape: () => setAboutOpen(false),
  })

  return (
    <div className="app-viewport landing-screen flex flex-col">
      <main className="landing-content">
        <section className="landing-brand" aria-labelledby="landing-title">
          <div className="landing-brand__stage">
            <div className="landing-deal" aria-hidden="true">
              <span className="landing-dealt-card landing-dealt-card--back"><i>S</i></span>
              <span className="landing-dealt-card landing-dealt-card--seven"><b>7</b><i>♣</i></span>
              <span className="landing-dealt-card landing-dealt-card--ten"><b>10</b><i>♦</i></span>
            </div>
            <div className="landing-wordmark-lockup">
              <span>Last one loses</span>
              <h1 id="landing-title" className="brand-wordmark">SHITHEAD</h1>
            </div>
          </div>
          <p className="landing-copy">Dump your hand. Last one holding the pile is the Shithead.</p>
        </section>

        <section className="landing-menu" aria-labelledby="game-mode-title">
          <h2 id="game-mode-title">Pick your table</h2>
          <div className="landing-actions">
            <article className="landing-mode-choice landing-mode-choice--online">
              <button
                type="button"
                onClick={onPlayOnline}
                className="landing-mode-button"
                aria-describedby="online-mode-description"
              >
                <span className="landing-mode-suit" aria-hidden="true">♠</span>
                <span className="landing-mode-title">Play Online</span>
                <span className="landing-mode-arrow" aria-hidden="true">→</span>
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
                <span className="landing-mode-suit" aria-hidden="true">♦</span>
                <span className="landing-mode-title">Play Offline</span>
                <span className="landing-mode-arrow" aria-hidden="true">→</span>
              </button>
              <p id="offline-mode-description">Same phone · friends or bots</p>
            </article>
          </div>
          <button type="button" className="landing-rules-button" onClick={() => setRulesOpen(true)}>
            <span aria-hidden="true">♣</span>
            <span>Rules</span>
            <span aria-hidden="true">Read before you deal →</span>
          </button>
        </section>
      </main>
      <footer className="app-bottom-zone landing-footer">
        <div className="landing-footer-stack">
          <nav className="landing-links" aria-label="Information">
            <button ref={aboutTriggerRef} type="button" onClick={() => setAboutOpen(true)}>About</button>
            <button type="button" onClick={() => setLegalOpen('privacy')}>Privacy</button>
            <button type="button" onClick={() => setLegalOpen('imprint')}>Impressum</button>
          </nav>
        </div>
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
          <div className="landing-about-card">
            <h2 id="about-title">Shithead</h2>
            <p>
              The classic shedding card game. Pass &amp; play with friends, take on the
              computer, or play online in a room of up to five.
            </p>
            <button
              type="button"
              onClick={() => setAboutOpen(false)}
              className="landing-about-close"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
