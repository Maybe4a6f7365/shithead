// ============================================================================
// Table talk: emotes, fixed broadcasts and custom messages. Shows what the
// room sends, renders the viewer's own reaction at once (suppressing its
// server echo), and applies the client-side cooldown and burst limits.
// ============================================================================
import { useEffect, useRef, useState } from 'react'
import type { GameState } from '../../engine'
import type {
  BroadcastEvent,
  BroadcastId,
  ChatEvent,
  EmoteEvent,
  EmoteId,
} from '../../engine/protocol'
import {
  acceptedCustomMessageBurst,
  CUSTOM_MESSAGE_BURST_LIMIT,
  CUSTOM_MESSAGE_BURST_WINDOW_MS,
  isValidChatText,
  normalizeChatText,
} from '../../engine/protocol'

/**
 * Name the speaker behind a table message. The dealt roster wins so a seated
 * player always shows their live name, then the server's stamp, which is the
 * only way to name a queued watcher: watchers are deliberately absent from both
 * the game state and the room summary until they take a seat.
 */
export function speakerNameForEvent(
  event: { playerId: string; playerName?: string } | null,
  state: Pick<GameState, 'players'>,
): string | undefined {
  if (!event) return undefined
  return state.players.find(player => player.id === event.playerId)?.name ?? event.playerName
}

export function isMatchingSelfEmoteEcho(
  pending: { emote: EmoteId; sentAt: number } | null,
  latest: EmoteEvent,
  viewerId: string,
  now = Date.now(),
): boolean {
  return Boolean(
    pending &&
    latest.playerId === viewerId &&
    latest.emote === pending.emote &&
    now - pending.sentAt >= 0 && now - pending.sentAt < 2500,
  )
}

export function isMatchingSelfBroadcastEcho(
  pending: { broadcast: BroadcastId; sentAt: number } | null,
  latest: BroadcastEvent,
  viewerId: string,
  now = Date.now(),
): boolean {
  return Boolean(
    pending &&
    latest.playerId === viewerId &&
    latest.broadcast === pending.broadcast &&
    now - pending.sentAt >= 0 && now - pending.sentAt < 2500,
  )
}

const REACTION_CLIENT_COOLDOWN_MS = 800

export function canSendReaction(lastSentAt: number | null, now = Date.now()): boolean {
  return lastSentAt === null || now - lastSentAt >= REACTION_CLIENT_COOLDOWN_MS
}

export interface TableReactionsArgs {
  viewerId: string
  /** Names the viewer's own reaction when the dealt roster cannot (a watcher). */
  viewerName?: string
  spectating: boolean
  canReact: boolean
  latestEmote?: EmoteEvent | null
  latestBroadcast?: BroadcastEvent | null
  latestChat?: ChatEvent | null
  /** Absent in single-player, where reactions are local only. */
  onSendEmote?: (emote: EmoteId) => void | boolean
  onSendBroadcast?: (broadcast: BroadcastId) => void | boolean
  onSendChat?: (text: string) => void | boolean
  onLocalChatAccepted?: (text: string) => void
  /** Explain in the feed and to assistive tech why nothing was sent. */
  onNotSent: (text: string) => void
}

export function useTableReactions({
  viewerId, viewerName, spectating, canReact,
  latestEmote, latestBroadcast, latestChat,
  onSendEmote, onSendBroadcast, onSendChat, onLocalChatAccepted, onNotSent,
}: TableReactionsArgs) {
  const [emote, setEmote] = useState<EmoteEvent | null>(null)
  const [broadcast, setBroadcast] = useState<BroadcastEvent | null>(null)
  const [chat, setChat] = useState<ChatEvent | null>(null)
  const pendingSelfEmote = useRef<{ emote: EmoteId; sentAt: number } | null>(null)
  const pendingSelfBroadcast = useRef<{ broadcast: BroadcastId; sentAt: number } | null>(null)
  // Pass-and-play reuses one mounted table for several viewers. Keep reaction
  // gates per viewer so one local player neither blocks nor lends a fresh
  // burst window to another player when the device changes hands.
  const lastSentAtByViewer = useRef(new Map<string, number>())
  const chatTimestampsByViewer = useRef(new Map<string, number[]>())

  useEffect(() => {
    if (!latestEmote) return
    if (isMatchingSelfEmoteEcho(pendingSelfEmote.current, latestEmote, viewerId)) {
      pendingSelfEmote.current = null
      return
    }
    setEmote(latestEmote)
  }, [latestEmote, viewerId])

  useEffect(() => {
    if (!latestBroadcast) return
    if (isMatchingSelfBroadcastEcho(pendingSelfBroadcast.current, latestBroadcast, viewerId)) {
      pendingSelfBroadcast.current = null
      return
    }
    setBroadcast(latestBroadcast)
  }, [latestBroadcast, viewerId])

  useEffect(() => {
    if (!latestChat) return
    setChat(latestChat)
  }, [latestChat])

  // Your own emote/broadcast renders locally and suppresses the server echo, so
  // the optimistic event has to carry the attribution the echo would have
  // brought. Without it a watcher — absent from the dealt roster — would watch
  // their own reaction come back labelled "Player" and untagged.
  const selfAttribution = { playerName: viewerName, role: spectating ? 'spectator' as const : 'player' as const }
  const cooledDown = (now: number) => canSendReaction(lastSentAtByViewer.current.get(viewerId) ?? null, now)
  const notSent = () => onNotSent('Reconnecting — reaction not sent')

  const sendEmote = (id: EmoteId) => {
    const sentAt = Date.now()
    if (!cooledDown(sentAt)) return
    if (!canReact || onSendEmote?.(id) === false) {
      notSent()
      return
    }
    lastSentAtByViewer.current.set(viewerId, sentAt)
    if (onSendEmote) pendingSelfEmote.current = { emote: id, sentAt }
    setEmote({ playerId: viewerId, emote: id, ts: sentAt, ...selfAttribution })
  }

  const sendBroadcast = (id: BroadcastId) => {
    const sentAt = Date.now()
    if (!cooledDown(sentAt)) return
    if (!canReact || onSendBroadcast?.(id) === false) {
      notSent()
      return
    }
    lastSentAtByViewer.current.set(viewerId, sentAt)
    if (onSendBroadcast) pendingSelfBroadcast.current = { broadcast: id, sentAt }
    setBroadcast({ playerId: viewerId, broadcast: id, ts: sentAt, ...selfAttribution })
  }

  const sendChat = (rawText: string): boolean => {
    const text = normalizeChatText(rawText)
    if (!isValidChatText(text)) return false
    const sentAt = Date.now()
    if (!cooledDown(sentAt)) return false
    if (!canReact) {
      notSent()
      return false
    }
    const burst = acceptedCustomMessageBurst(chatTimestampsByViewer.current.get(viewerId) ?? [], sentAt)
    if (!burst.accepted) {
      chatTimestampsByViewer.current.set(viewerId, burst.timestamps)
      onNotSent(`Custom messages are limited to ${CUSTOM_MESSAGE_BURST_LIMIT} every ${CUSTOM_MESSAGE_BURST_WINDOW_MS / 1000} seconds`)
      return false
    }
    if (onSendChat && onSendChat(text) === false) {
      notSent()
      return false
    }
    chatTimestampsByViewer.current.set(viewerId, burst.timestamps)
    lastSentAtByViewer.current.set(viewerId, sentAt)
    // Multiplayer waits for the authenticated server echo. This keeps a
    // transport drop or authoritative rate-limit rejection from appearing as
    // a message that other players never received. Single-player remains
    // local-only and can render immediately.
    if (onSendChat) return true
    setChat({ playerId: viewerId, text, ts: sentAt, ...selfAttribution })
    onLocalChatAccepted?.(text)
    return true
  }

  return { emote, broadcast, chat, sendEmote, sendBroadcast, sendChat }
}
