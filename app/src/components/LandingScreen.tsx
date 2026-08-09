// ============================================================================
// LandingScreen (§7.1) — Fraunces wordmark on felt, gold rule, two stacked
// actions, quiet footer. No cream card floating in a void; no fake features.
// ============================================================================
import { useState } from 'react'
import { RulesSheet } from './RulesSheet'

export function LandingScreen({ onPlayOnline, onPassAndPlay }: { onPlayOnline: () => void; onPassAndPlay: () => void }) {
  const [rulesOpen, setRulesOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const commit = document.querySelector('meta[name="build-commit"]')?.getAttribute('content')
  const stamp = commit && commit !== 'local' ? commit.slice(0, 7) : 'v0.2.0'

  return (
    <div className="app-viewport bg-felt text-cream flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center px-s4 w-full max-w-[400px] mx-auto">
        <h1 className="font-display text-display font-semibold tracking-[-0.01em] text-cream">SHITHEAD</h1>
        <div className="w-12 h-[2px] bg-gold mt-s3 mb-s8" aria-hidden="true" />
        <div className="w-full flex flex-col gap-s3">
          <button
            type="button"
            onClick={onPlayOnline}
            className="w-full min-h-[48px] rounded-button bg-burgundy text-cream text-button font-bold tracking-button uppercase active:scale-[0.97] transition-transform duration-dur-1"
          >
            Play online
          </button>
          <button
            type="button"
            onClick={onPassAndPlay}
            className="w-full min-h-[48px] rounded-button border-2 border-cream text-cream text-button font-bold tracking-button uppercase active:scale-[0.97] transition-transform duration-dur-1"
          >
            Pass &amp; play / vs computer
          </button>
        </div>
      </main>
      <footer className="relative app-bottom-zone pb-s4 text-center">
        <p className="text-small text-cream-dim">
          <button type="button" onClick={() => setRulesOpen(true)} className="underline underline-offset-2 min-h-[44px] px-s2">Rules</button>
          {' · '}
          <button type="button" onClick={() => setAboutOpen(true)} className="underline underline-offset-2 min-h-[44px] px-s2">About</button>
        </p>
        <span className="absolute right-s4 bottom-s4 text-micro text-cream/45">{stamp}</span>
      </footer>

      <RulesSheet open={rulesOpen} onClose={() => setRulesOpen(false)} />
      {aboutOpen && (
        <div className="fixed inset-0 z-scrim bg-scrim flex items-center justify-center p-s4" role="dialog" aria-modal="true" aria-label="About">
          <div className="w-full max-w-[320px] bg-cream text-ink rounded-button p-s5 text-center">
            <h2 className="font-display text-title font-semibold mb-s2">Shithead</h2>
            <p className="text-body text-ink-soft">
              The classic shedding card game. Pass &amp; play with friends, take on the
              computer, or play online in a room of up to five.
            </p>
            <button
              type="button"
              onClick={() => setAboutOpen(false)}
              className="mt-s4 w-full min-h-[48px] rounded-button bg-burgundy text-cream text-button font-bold tracking-button uppercase"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
