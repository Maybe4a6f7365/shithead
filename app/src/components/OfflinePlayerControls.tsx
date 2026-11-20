import { useEffect, useState } from 'react'
import { OFFLINE_KICK_DELAY_MS, type PlayerSummary } from '../engine/protocol'

export { OFFLINE_KICK_DELAY_MS }

export interface OfflinePlayerControlsProps {
  players: readonly PlayerSummary[]
  isHost: boolean
  onKick: (playerId: string) => void
  inline?: boolean
}

/**
 * Host-only, out-of-flow controls. The server remains authoritative for the
 * role, continuous offline duration, and final removal decision.
 */
export function OfflinePlayerControls({ players, isHost, onKick, inline = false }: OfflinePlayerControlsProps) {
  const [now, setNow] = useState(() => Date.now())
  // The absence being confirmed, not just the player: someone who comes back
  // and drops again has to be confirmed again.
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null)
  const offline = players.filter(player => !player.connected && Number.isFinite(player.offlineSince))
  const absenceKey = (player: PlayerSummary) => `${player.id}:${player.offlineSince}`
  const offlineKey = offline.map(absenceKey).join('|')

  // Tick while anyone is offline, and at once when that set changes.
  useEffect(() => {
    if (!isHost || offlineKey === '') return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isHost, offlineKey])

  if (!isHost) return null
  const eligible = offline.filter(player => now - Number(player.offlineSince) >= OFFLINE_KICK_DELAY_MS)
  if (eligible.length === 0) return null

  return (
    <aside
      className={`offline-player-controls${inline ? ' offline-player-controls--inline' : ''}`}
      aria-label="Offline player controls"
    >
      {eligible.map(player => {
        const confirming = confirmingKey === absenceKey(player)
        return (
          <button
            key={player.id}
            type="button"
            className="offline-player-controls__button"
            data-confirming={confirming || undefined}
            onClick={() => {
              if (!confirming) {
                setConfirmingKey(absenceKey(player))
                return
              }
              setConfirmingKey(null)
              onKick(player.id)
            }}
            aria-label={confirming ? `Confirm remove ${player.name}` : `Remove offline player ${player.name}`}
          >
            {confirming ? `Remove ${player.name}?` : `${player.name} · remove`}
          </button>
        )
      })}
    </aside>
  )
}
