// ============================================================================
// Multiplayer lobby — host a new game or join an existing one
// ============================================================================
import { useState } from 'react'
import { useSPGame } from '../sp/SPSinglePlayer'
import { createRoom } from '../net/useMultiplayerRoom'

interface Props {
  onJoin: (roomId: string) => void
}

export function MultiplayerLobby({ onJoin }: Props) {
  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) { setError('Enter your name'); return }
    setBusy(true); setError(null)
    try {
      const roomId = await createRoom()
      // Stash name for after connect
      sessionStorage.setItem(`shithead:name:${roomId}`, name)
      onJoin(roomId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#2d4a2b] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[#faf8f3] rounded-2xl p-6 shadow-2xl">
        <button
          onClick={() => useSPGame.getState().reset()}
          className="text-xs text-[#2d4a2b]/50 mb-3 hover:underline"
        >
          ← Back to single player
        </button>
        <h1 className="text-4xl font-black text-center text-[#a23a1e] mb-2">PLAY ONLINE</h1>
        <p className="text-center text-[#2d4a2b]/70 mb-5 text-sm">Real-time multiplayer via WebSocket</p>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[#2d4a2b]/70 mb-1 block">Your Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Player 1"
              maxLength={32}
              className="w-full px-3 py-2 rounded-lg border border-[#2d4a2b]/20 bg-white"
            />
          </div>

          <button
            onClick={handleCreate}
            disabled={busy || !name.trim()}
            className="w-full py-3 rounded-xl bg-[#a23a1e] text-[#faf8f3] font-black shadow-lg active:scale-95 transition disabled:opacity-50"
          >
            {busy ? 'CREATING…' : 'CREATE NEW ROOM'}
          </button>

          <div className="flex items-center gap-2 text-xs text-[#2d4a2b]/40">
            <div className="flex-1 h-px bg-[#2d4a2b]/20" />
            <span>OR JOIN</span>
            <div className="flex-1 h-px bg-[#2d4a2b]/20" />
          </div>

          <input
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
            placeholder="ROOM CODE"
            maxLength={6}
            className="w-full px-3 py-2 rounded-lg border border-[#2d4a2b]/20 bg-white text-center font-mono text-xl tracking-widest"
          />

          <button
            onClick={async () => {
              if (!joinCode.match(/^[A-Z0-9]{6}$/)) { setError('Invalid code (6 chars)'); return }
              if (!name.trim()) { setError('Enter your name'); return }
              // For join, we need a room ID — currently API returns it from /api/room/new
              // To join by code, we need an index. For now, fake it by passing code as roomId.
              // (Real impl: index of code → roomId stored in Workers KV)
              sessionStorage.setItem(`shithead:name:${joinCode}`, name)
              onJoin(joinCode)
            }}
            disabled={!name.trim() || joinCode.length < 6}
            className="w-full py-3 rounded-xl bg-[#2d4a2b] text-[#faf8f3] font-black shadow-lg active:scale-95 transition disabled:opacity-50"
          >
            JOIN
          </button>
        </div>

        {error && <div className="mt-3 p-2 bg-[#a23a1e]/10 text-[#a23a1e] text-sm rounded text-center">{error}</div>}
      </div>
    </div>
  )
}
