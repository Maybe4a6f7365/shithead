// ============================================================================
// LandingScreen — compact mobile-game welcome screen with a recognisable
// card-stack mark and no decorative space competing with the primary action.
// ============================================================================
import { useState } from 'react'
import { RulesSheet } from './RulesSheet'
import { LegalSheet, type LegalSheetKind } from './LegalSheet'

export function LandingScreen({ onPlayOnline, onPassAndPlay }: { onPlayOnline: () => void; onPassAndPlay: () => void }) {
  const [rulesOpen, setRulesOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [legalOpen, setLegalOpen] = useState<LegalSheetKind | null>(null)
  const commit = document.querySelector('meta[name="build-commit"]')?.getAttribute('content')
  const stamp = commit && commit !== 'local' ? commit.slice(0, 7) : 'v0.2.0'

  return (
    <div className="app-viewport landing-screen bg-felt text-cream flex flex-col">
      <main className="landing-content">
        <div className="brand-mark" aria-hidden="true">
          <span className="brand-mark__back" />
          <span className="brand-mark__front">S</span>
        </div>
        <p className="text-label font-bold tracking-label uppercase text-gold-bright">The shedding card game</p>
        <h1 className="brand-wordmark">SHITHEAD</h1>
        <p className="landing-copy">Outplay the table. Empty your hand. Don’t be last.</p>
        <div className="w-full flex flex-col gap-s3 mt-s7">
          <button
            type="button"
            onClick={onPlayOnline}
            className="primary-action w-full px-s5 text-button font-bold tracking-button uppercase"
          >
            Play online
          </button>
          <button
            type="button"
            onClick={onPassAndPlay}
            className="secondary-action w-full px-s5 text-button font-bold tracking-button uppercase"
          >
            Pass &amp; play / vs computer
          </button>
        </div>
      </main>
      <footer className="app-bottom-zone pb-s4 text-center">
        <nav className="landing-links text-small text-cream-dim" aria-label="Information">
          <button type="button" onClick={() => setRulesOpen(true)} className="underline underline-offset-2 min-h-[44px] px-s2">Rules</button>
          <button type="button" onClick={() => setAboutOpen(true)} className="underline underline-offset-2 min-h-[44px] px-s2">About</button>
          <button type="button" onClick={() => setLegalOpen('privacy')} className="underline underline-offset-2 min-h-[44px] px-s2">Privacy</button>
          <button type="button" onClick={() => setLegalOpen('imprint')} className="underline underline-offset-2 min-h-[44px] px-s2">Impressum</button>
        </nav>
        <span className="block text-micro text-cream/45" aria-label={`Build ${stamp}`}>{stamp}</span>
      </footer>

      <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} />
      <LegalSheet kind="privacy" open={legalOpen === 'privacy'} onClose={() => setLegalOpen(null)} />
      <LegalSheet kind="imprint" open={legalOpen === 'imprint'} onClose={() => setLegalOpen(null)} />
      {aboutOpen && (
        <div className="fixed inset-0 z-scrim bg-scrim flex items-center justify-center p-s4" role="dialog" aria-modal="true" aria-label="About">
          <div className="surface-panel w-full max-w-[340px] bg-cream text-ink rounded-button p-s5 text-center">
            <h2 className="font-display text-title font-semibold mb-s2">Shithead</h2>
            <p className="text-body text-ink-soft">
              The classic shedding card game. Pass &amp; play with friends, take on the
              computer, or play online in a room of up to five.
            </p>
            <button
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
