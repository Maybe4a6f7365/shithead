// ============================================================================
// JoinCreateScreen (§7.2) — one screen, two sections separated by space (not
// panels), text set directly on felt. ?room=CODE pre-fills and focuses JOIN.
// ============================================================================
import { useEffect, useRef, useState } from 'react'
import { createRoom } from '../net/useMultiplayerRoom'
import { NameField, loadSavedName, saveName } from './NameField'

export interface JoinCreateScreenProps {
  onEnterRoom: (roomId: string, playerName: string, intent: 'create' | 'join') => void
  onBack: () => void
}

export function JoinCreateScreen({ onEnterRoom, onBack }: JoinCreateScreenProps) {
  const [name, setName] = useState(() => loadSavedName(''))
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
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
    if (!n) { setCreateError('Enter your name first.'); return }
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
    if (!n) { setJoinError('Enter your name first.'); return }
    if (!/^[A-Z0-9]{6}$/.test(code)) { setJoinError('A room code is 6 letters.'); return }
    saveName(n)
    onEnterRoom(code, n, 'join')
  }

  return (
    <div className="app-viewport bg-felt text-cream flex flex-col">
      <main className="flex-1 overflow-y-auto w-full max-w-[400px] mx-auto px-s4 py-s6 flex flex-col justify-center">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="self-start min-h-[44px] text-label font-bold tracking-label uppercase text-cream-dim mb-s5 disabled:opacity-40"
        >
          ← Menu
        </button>

        {/* Create */}
        <section>
          <h1 className="font-display text-title font-semibold mb-s3">Start a room</h1>
          <NameField id="create-name" label="Your name" value={name} onChange={setName} onDark />
          <button
            type="button"
            onClick={create}
            disabled={busy}
            className="mt-s3 w-full min-h-[48px] rounded-button bg-burgundy text-cream text-button font-bold tracking-button uppercase active:scale-[0.97] transition-transform duration-dur-1 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create room'}
          </button>
          {createError && <p role="alert" className="mt-s2 text-small text-danger-bright">{createError}</p>}
        </section>

        <div className="h-s6" aria-hidden="true" />

        {/* Join */}
        <section>
          <h2 className="font-display text-title font-semibold mb-s3">Join a room</h2>
          <div className="mb-s3">
            <label htmlFor="join-code" className="block text-label font-bold tracking-label uppercase text-cream-dim mb-s1">
              Room code
            </label>
            <input
              id="join-code"
              ref={joinRef}
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="LPHGPC"
              maxLength={6}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              className="w-full min-h-[48px] px-s3 rounded-button bg-felt-deep text-cream placeholder:text-cream-dim border border-hairline text-body tracking-[0.3em] uppercase"
            />
            {joinError && <p role="alert" className="mt-s2 text-small text-danger-bright">{joinError}</p>}
          </div>
          <button
            type="button"
            onClick={join}
            disabled={busy}
            className="w-full min-h-[48px] rounded-button bg-burgundy text-cream text-button font-bold tracking-button uppercase active:scale-[0.97] transition-transform duration-dur-1 disabled:opacity-50"
          >
            Join
          </button>
        </section>
      </main>
    </div>
  )
}
