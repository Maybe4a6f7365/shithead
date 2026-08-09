// ============================================================================
// JoinCreateScreen (§7.2) — one screen, two sections separated by space (not
// panels), text set directly on felt. ?room=CODE pre-fills and focuses JOIN.
// ============================================================================
import { useEffect, useRef, useState } from 'react'
import { createRoom } from '../net/useMultiplayerRoom'
import { loadSavedName, saveName } from './NameField'

export interface JoinCreateScreenProps {
  onEnterRoom: (roomId: string, playerName: string, intent: 'create' | 'join') => void
  onBack: () => void
}

export function JoinCreateScreen({ onEnterRoom, onBack }: JoinCreateScreenProps) {
  const [name, setName] = useState(() => loadSavedName(''))
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const joinRef = useRef<HTMLInputElement>(null)
  const requestId = useRef(0)

  useEffect(() => () => { requestId.current++ }, [])

  // Paste/share-link support: ?room=CODE pre-fills and focuses JOIN (§7.2).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const room = params.get('room')
    if (room && /^[A-Za-z0-9]{6}$/.test(room)) {
      setCode(room.toUpperCase())
      joinRef.current?.focus()
    }
  }, [])

  const create = async () => {
    if (busy) return
    const n = name.trim()
    if (!n) {
      setNameError('Enter your name first.')
      nameRef.current?.focus()
      return
    }
    const attemptId = ++requestId.current
    setBusy(true)
    setCreateError(null)
    try {
      const roomId = await createRoom()
      if (requestId.current !== attemptId) return
      saveName(n)
      onEnterRoom(roomId, n, 'create')
    } catch (e) {
      if (requestId.current !== attemptId) return
      setCreateError(e instanceof Error ? e.message : 'Failed to create room')
    } finally {
      if (requestId.current === attemptId) setBusy(false)
    }
  }

  const join = () => {
    if (busy) return
    const n = name.trim()
    if (!n) {
      setNameError('Enter your name first.')
      setJoinError(null)
      nameRef.current?.focus()
      return
    }
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      setNameError(null)
      setJoinError('A room code is 6 letters or numbers.')
      joinRef.current?.focus()
      return
    }
    saveName(n)
    onEnterRoom(code, n, 'join')
  }

  const updateName = (nextName: string) => {
    setName(nextName.slice(0, 12))
    setNameError(null)
    setCreateError(null)
  }

  const updateCode = (nextCode: string) => {
    setCode(nextCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
    setJoinError(null)
  }

  return (
    <div className="app-viewport pregame-screen pregame-screen--online bg-felt text-cream flex flex-col">
      <main className="screen-content pregame-shell join-create-screen flex-1 overflow-y-auto w-full max-w-[440px] mx-auto px-s4 py-s5">
        <header className="pregame-header">
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="pregame-back min-h-[44px] text-label font-bold tracking-label uppercase text-cream-dim disabled:opacity-40"
          >
            <span aria-hidden="true">←</span> Menu
          </button>
          <p className="pregame-kicker">
            <span aria-hidden="true">♠</span> Private table
          </p>
          <h1 className="pregame-title font-display text-title font-semibold">Play online</h1>
          <p className="pregame-intro text-body text-cream-dim">
            Take a seat, then deal a new room or join your friends.
          </p>
        </header>

        <section className="setup-card setup-card--identity surface-panel form-panel" aria-labelledby="online-seat-title">
          <div className="setup-card__heading">
            <span className="setup-card__suit" aria-hidden="true">♣</span>
            <div>
              <h2 id="online-seat-title" className="setup-card__title font-display text-body font-semibold">Your seat</h2>
              <p className="setup-card__copy text-small text-cream-dim">This name appears at the table.</p>
            </div>
          </div>
          <div className="name-field setup-field">
            <label
              htmlFor="online-name"
              className="form-label block text-label font-bold tracking-label uppercase mb-s1 text-cream-dim"
            >
              Your name
            </label>
            <input
              id="online-name"
              ref={nameRef}
              value={name}
              onChange={event => updateName(event.target.value)}
              placeholder="Your name"
              maxLength={12}
              autoComplete="off"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'online-name-error' : undefined}
              className="modern-input player-name-input w-full min-h-[48px] px-s3 rounded-button text-body bg-felt-deep text-cream placeholder:text-cream-dim border border-hairline"
            />
            {nameError && (
              <p id="online-name-error" role="alert" className="setup-card__error text-small text-danger-bright">
                {nameError}
              </p>
            )}
          </div>
        </section>

        <div className="join-create-options">
          <section className="setup-card setup-card--create surface-panel form-panel" aria-labelledby="create-room-title">
            <div className="setup-card__heading">
              <span className="setup-card__suit" aria-hidden="true">♦</span>
              <div>
                <h2 id="create-room-title" className="setup-card__title font-display text-body font-semibold">Deal a new table</h2>
                <p className="setup-card__copy text-small text-cream-dim">Get a private code to share.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={create}
              disabled={busy}
              className="primary-action setup-card__action w-full px-s5 text-button font-bold tracking-button uppercase disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create room'}
            </button>
            {createError && <p role="alert" className="setup-card__error text-small text-danger-bright">{createError}</p>}
          </section>

          <div className="form-divider join-create-divider" aria-hidden="true"><span>or</span></div>

          <form
            className="setup-card setup-card--join surface-panel form-panel"
            aria-labelledby="join-room-title"
            onSubmit={event => {
              event.preventDefault()
              join()
            }}
          >
            <div className="setup-card__heading">
              <span className="setup-card__suit" aria-hidden="true">♥</span>
              <div>
                <h2 id="join-room-title" className="setup-card__title font-display text-body font-semibold">Join a table</h2>
                <p className="setup-card__copy text-small text-cream-dim">Use the six-character invite code.</p>
              </div>
            </div>
            <div className="setup-field">
              <label htmlFor="join-code" className="form-label block text-label font-bold tracking-label uppercase text-cream-dim mb-s1">
                Room code
              </label>
              <input
                id="join-code"
                ref={joinRef}
                value={code}
                onChange={event => updateCode(event.target.value)}
                placeholder="LPHGPC"
                maxLength={6}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                aria-invalid={joinError ? true : undefined}
                aria-describedby={joinError ? 'join-code-hint join-code-error' : 'join-code-hint'}
                className="modern-input room-code-input w-full min-h-[48px] px-s3 rounded-button bg-felt-deep text-cream placeholder:text-cream-dim border border-hairline text-body tracking-[0.3em] uppercase"
              />
              <span id="join-code-hint" className="sr-only">Six letters or numbers</span>
              {joinError && <p id="join-code-error" role="alert" className="setup-card__error text-small text-danger-bright">{joinError}</p>}
            </div>
            <button
              type="submit"
              disabled={busy}
              className="primary-action setup-card__action w-full px-s5 text-button font-bold tracking-button uppercase disabled:opacity-50"
            >
              Join room
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
