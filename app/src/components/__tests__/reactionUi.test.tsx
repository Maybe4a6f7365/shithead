// @vitest-environment jsdom
// @ts-ignore Vitest exposes Node built-ins for this source/asset contract.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { GameState, Player } from '../../engine'
import { MAX_CHAT_MESSAGE_LENGTH, type SystemEvent } from '../../engine/protocol'
import {
  BroadcastFeedback,
  ChatFeedback,
  EmoteButton,
  EmoteFeedback,
  SystemEventFeedback,
} from '../EmoteButton'
import { LobbySystemFeedback } from '../MultiplayerGameTable'
import { BROADCAST_OPTIONS, REACTION_OPTIONS } from '../reactionCatalog'
import {
  canSendReaction,
  isMatchingSelfBroadcastEcho,
  TableScreen,
} from '../TableScreen'

declare const process: { cwd: () => string }

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(cleanup)

describe('modern reaction picker', () => {
  it('uses 28 local Fluent Emoji images with no native-glyph fallback', () => {
    render(<EmoteButton onSend={vi.fn()} onSendBroadcast={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Open reactions' })
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Reactions' })
    const grid = within(dialog).getByRole('group', { name: 'Emoji reactions' })
    const cells = within(grid).getAllByRole('button')
    expect(cells).toHaveLength(28)
    for (const cell of cells) {
      expect(cell.textContent).toBe('')
      expect(cell.querySelector('img')?.getAttribute('src')).toMatch(/^\/reactions\/[a-z-]+\.svg$/)
    }
    expect(within(grid).getByRole('button', { name: 'Angry' })).toBeTruthy()
    expect(within(grid).getByRole('button', { name: 'Middle finger, medium-dark skin tone' }).querySelector('img')?.getAttribute('src'))
      .toBe('/reactions/middle-finger.svg')
  })

  it('offers all fixed broadcasts as direction-safe buttons and sends every stable id', async () => {
    const sendBroadcast = vi.fn()
    render(<EmoteButton onSend={vi.fn()} onSendBroadcast={sendBroadcast} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open reactions' }))
    fireEvent.click(screen.getByRole('tab', { name: /Text/ }))

    for (const option of BROADCAST_OPTIONS) {
      const button = screen.getByRole('button', { name: `Broadcast: ${option.label}` })
      expect(button.getAttribute('dir')).toBe('auto')
      expect(button.textContent).toBe(option.text)
    }

    fireEvent.click(screen.getByRole('button', { name: `Broadcast: ${BROADCAST_OPTIONS[0].label}` }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    for (const option of BROADCAST_OPTIONS.slice(1)) {
      fireEvent.click(screen.getByRole('button', { name: 'Open reactions' }))
      fireEvent.click(screen.getByRole('tab', { name: /Text/ }))
      fireEvent.click(screen.getByRole('button', { name: `Broadcast: ${option.label}` }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }
    expect(sendBroadcast.mock.calls.map(call => call[0])).toEqual(BROADCAST_OPTIONS.map(option => option.id))
    expect(screen.getByRole('button', { name: 'Open reactions' })).toBe(document.activeElement)
  })

  it('puts an accessible custom-message composer first in the text menu', async () => {
    const sendChat = vi.fn()
    render(<EmoteButton onSend={vi.fn()} onSendChat={sendChat} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open reactions' }))
    fireEvent.click(screen.getByRole('tab', { name: /Text/ }))

    const panel = screen.getByRole('tabpanel')
    const choices = within(panel).getAllByRole('button')
    expect(choices[0].getAttribute('aria-label')).toBe('Custom message')
    expect(choices[0].getAttribute('data-broadcast-index')).toBe('0')
    expect(choices[1].getAttribute('aria-label')).toBe(`Broadcast: ${BROADCAST_OPTIONS[0].label}`)

    fireEvent.click(choices[0])
    const input = screen.getByRole('textbox', { name: 'Custom message' })
    expect(input).toBe(document.activeElement)
    expect(input.getAttribute('maxlength')).toBe(String(MAX_CHAT_MESSAGE_LENGTH))
    expect(input.getAttribute('dir')).toBe('auto')
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(input, {
      target: { value: `A${'\u0344'.repeat(MAX_CHAT_MESSAGE_LENGTH - 1)}` },
    })
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(input, { target: { value: '  Héllo   table 👋  ' } })
    const send = screen.getByRole('button', { name: 'Send' })
    expect((send as HTMLButtonElement).disabled).toBe(false)
    fireEvent.submit(input.closest('form')!)

    expect(sendChat).toHaveBeenCalledTimes(1)
    expect(sendChat).toHaveBeenCalledWith('Héllo table 👋')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: 'Open reactions' })).toBe(document.activeElement)
  })

  it('supports a five-column arrow grid, Escape, focus return and focus trapping', async () => {
    render(<EmoteButton onSend={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Open reactions' })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Reactions' })
    const cells = within(within(dialog).getByRole('group', { name: 'Emoji reactions' })).getAllByRole('button')

    cells[0].focus()
    fireEvent.keyDown(cells[0], { key: 'ArrowDown' })
    expect(cells[5]).toBe(document.activeElement)

    fireEvent.keyDown(cells[5], { key: 'End' })
    expect(cells[27]).toBe(document.activeElement)
    fireEvent.keyDown(dialog, { key: 'Tab' })
    const close = screen.getByRole('button', { name: 'Close reactions' })
    expect(close).toBe(document.activeElement)
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(cells[27]).toBe(document.activeElement)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(trigger).toBe(document.activeElement)
  })
})

describe('reaction receipts and table events', () => {
  it('renders image-based emoji feedback and tasteful text feedback', () => {
    const { rerender } = render(
      <EmoteFeedback event={{ playerId: 'p1', emote: 'angry', ts: 10 }} playerName="Mira" />,
    )
    expect(screen.getByRole('status').textContent).toContain('Mira reacted: Angry')
    expect(screen.getByRole('status').querySelector('img')?.getAttribute('src')).toBe('/reactions/angry.svg')

    rerender(
      <BroadcastFeedback
        event={{ playerId: 'p1', broadcast: 'womp-womp', ts: 11 }}
        playerName="Mira"
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('Mira')
    expect(screen.getByRole('status').textContent).toContain('𝖜𝖔𝖒𝖕 𝖜𝖔𝖒𝖕')

    rerender(
      <ChatFeedback
        event={{ playerId: 'p1', text: '<img src=x onerror=alert(1)> Hé 👋', ts: 12 }}
        playerName="Mira"
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('<img src=x onerror=alert(1)> Hé 👋')
    expect(screen.getByRole('status').querySelector('img')).toBeNull()
  })

  it('labels player-left as Table while Ondra looks like a normal player broadcast', () => {
    const left: SystemEvent = {
      kind: 'player-left', playerId: 'p1', playerName: 'Mira',
      message: 'bye-little-shits', ts: 12,
    }
    const { rerender } = render(<SystemEventFeedback event={left} />)
    expect(screen.getByRole('status').textContent).toContain('Table')
    expect(screen.getByRole('status').textContent).toContain('Mira said bye little shits ✌︎︎')

    const ondra: SystemEvent = {
      kind: 'ondra-mode', playerId: 'p2', playerName: 'Ondrej',
      message: 'ondra-farts-cutely', ts: 13,
    }
    rerender(<SystemEventFeedback event={ondra} />)
    expect(screen.getByRole('status').textContent).toContain('Ondrej')
    expect(screen.getByRole('status').textContent).toContain('*farts cutely🎀*')
    expect(screen.getByRole('status').textContent).not.toContain('Ondra mode')
    expect(screen.getByRole('status').className).toContain('reaction-feedback--broadcast')
  })

  it('surfaces system events while the room is still in the lobby', () => {
    const event: SystemEvent = {
      kind: 'player-left', playerId: 'gone', playerName: 'Kai',
      message: 'bye-little-shits', ts: 14,
    }
    render(
      <div>
        <LobbySystemFeedback event={event} />
        <main>Waiting room</main>
      </div>,
    )
    expect(screen.getByText('Waiting room')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Kai said bye little shits ✌︎︎')
    expect(screen.getByRole('status').textContent).toContain('Table')
  })

  it('never surfaces an Ondra broadcast in the waiting room', () => {
    const event: SystemEvent = {
      kind: 'ondra-mode', playerId: 'ondra', playerName: 'Ondra',
      message: 'ondra-faster', ts: 15,
    }
    render(<LobbySystemFeedback event={event} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows a local text receipt immediately and suppresses its server echo', async () => {
    const me: Player = {
      id: 'me', name: 'Me', hand: [{ id: 'five', rank: '5', suit: '♣' }],
      faceUp: [], faceDown: [], isOut: false,
    }
    const other: Player = {
      id: 'other', name: 'Other', hand: [{ id: 'six', rank: '6', suit: '♠' }],
      faceUp: [], faceDown: [], isOut: false,
    }
    const state: GameState = {
      phase: 'play', rules: { includeJokers: false, winnerSwapsFaceUp: false, deckCount: 1 },
      players: [me, other], stock: [], pile: [], currentPlayerIdx: 0,
      playDirection: 1, turnCount: 1, winnerId: null, loserId: null,
      pendingTribute: null, pendingQuickFollowUp: null, log: [], seq: 1,
    }
    const sendBroadcast = vi.fn()
    const props = {
      state, viewerId: 'me', viewerActive: true, onPlay: vi.fn(), onPickUp: vi.fn(),
      onLeave: vi.fn(), onOpenRules: vi.fn(), soundOn: false, onToggleSound: vi.fn(),
      onSendBroadcast: sendBroadcast,
    }
    const view = render(<TableScreen {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open reactions' }))
    fireEvent.click(screen.getByRole('tab', { name: /Text/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Broadcast: Karma' }))

    expect(sendBroadcast).toHaveBeenCalledWith('karma')
    expect(document.querySelector('.reaction-feedback--broadcast')?.textContent).toContain('Me☘Karma☠')

    const echoed = { playerId: 'me', broadcast: 'karma' as const, ts: Date.now() }
    view.rerender(<TableScreen {...props} latestBroadcast={echoed} />)
    await waitFor(() => expect(screen.getAllByText('☘Karma☠')).toHaveLength(1))
    expect(isMatchingSelfBroadcastEcho(
      { broadcast: 'karma', sentAt: echoed.ts - 10 }, echoed, 'me', echoed.ts,
    )).toBe(true)
  })

  it('waits for the canonical server echo before showing multiplayer custom text', async () => {
    const me: Player = {
      id: 'me', name: 'Me', hand: [{ id: 'five', rank: '5', suit: '♣' }],
      faceUp: [], faceDown: [], isOut: false,
    }
    const other: Player = {
      id: 'other', name: 'Other', hand: [{ id: 'six', rank: '6', suit: '♠' }],
      faceUp: [], faceDown: [], isOut: false,
    }
    const state: GameState = {
      phase: 'play', rules: { includeJokers: false, winnerSwapsFaceUp: false, deckCount: 1 },
      players: [me, other], stock: [], pile: [], currentPlayerIdx: 0,
      playDirection: 1, turnCount: 1, winnerId: null, loserId: null,
      pendingTribute: null, pendingQuickFollowUp: null, log: [], seq: 1,
    }
    const sendChat = vi.fn((_text: string) => true)
    const props = {
      state, viewerId: 'me', viewerActive: true, onPlay: vi.fn(), onPickUp: vi.fn(),
      onLeave: vi.fn(), onOpenRules: vi.fn(), soundOn: false, onToggleSound: vi.fn(),
      onSendChat: sendChat,
    }
    const view = render(<TableScreen {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open reactions' }))
    fireEvent.click(screen.getByRole('tab', { name: /Text/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Custom message' }))
    const input = screen.getByRole('textbox', { name: 'Custom message' })
    fireEvent.change(input, { target: { value: 'Hello   table 👋' } })
    fireEvent.submit(input.closest('form')!)

    expect(sendChat).toHaveBeenCalledWith('Hello table 👋')
    expect(screen.queryByText('Hello table 👋')).toBeNull()

    const echoed = { playerId: 'me', text: 'Hello table 👋', ts: Date.now() }
    view.rerender(<TableScreen {...props} latestChat={echoed} />)
    await waitFor(() => expect(screen.getAllByText('Hello table 👋')).toHaveLength(1))
    expect(document.querySelector('.reaction-feedback--broadcast')?.textContent).toContain('MeHello table 👋')
  })

  it('does not show a custom message when reconnecting or when transport rejects it', async () => {
    const me: Player = {
      id: 'me', name: 'Me', hand: [{ id: 'five', rank: '5', suit: '♣' }],
      faceUp: [], faceDown: [], isOut: false,
    }
    const other: Player = {
      id: 'other', name: 'Other', hand: [{ id: 'six', rank: '6', suit: '♠' }],
      faceUp: [], faceDown: [], isOut: false,
    }
    const state: GameState = {
      phase: 'play', rules: { includeJokers: false, winnerSwapsFaceUp: false, deckCount: 1 },
      players: [me, other], stock: [], pile: [], currentPlayerIdx: 0,
      playDirection: 1, turnCount: 1, winnerId: null, loserId: null,
      pendingTribute: null, pendingQuickFollowUp: null, log: [], seq: 1,
    }
    const sendChat = vi.fn((_text: string) => false)
    render(
      <TableScreen
        state={state}
        viewerId="me"
        viewerActive
        actionsEnabled={false}
        onPlay={vi.fn()}
        onPickUp={vi.fn()}
        onLeave={vi.fn()}
        onOpenRules={vi.fn()}
        soundOn={false}
        onToggleSound={vi.fn()}
        onSendChat={sendChat}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open reactions' }))
    fireEvent.click(screen.getByRole('tab', { name: /Text/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Custom message' }))
    const input = screen.getByRole('textbox', { name: 'Custom message' })
    fireEvent.change(input, { target: { value: 'Never relayed' } })
    fireEvent.submit(input.closest('form')!)

    expect(sendChat).not.toHaveBeenCalled()
    expect(screen.queryByText('Never relayed')).toBeNull()
    await waitFor(() => expect(screen.getByText('Reconnecting — reaction not sent')).toBeTruthy())
  })

  it('stops a fourth custom message in the rolling client burst window', async () => {
    const me: Player = {
      id: 'me', name: 'Me', hand: [{ id: 'five', rank: '5', suit: '♣' }],
      faceUp: [], faceDown: [], isOut: false,
    }
    const other: Player = {
      id: 'other', name: 'Other', hand: [{ id: 'six', rank: '6', suit: '♠' }],
      faceUp: [], faceDown: [], isOut: false,
    }
    const state: GameState = {
      phase: 'play', rules: { includeJokers: false, winnerSwapsFaceUp: false, deckCount: 1 },
      players: [me, other], stock: [], pile: [], currentPlayerIdx: 0,
      playDirection: 1, turnCount: 1, winnerId: null, loserId: null,
      pendingTribute: null, pendingQuickFollowUp: null, log: [], seq: 1,
    }
    const sendChat = vi.fn((_text: string) => true)
    let now = 1_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      render(
        <TableScreen
          state={state}
          viewerId="me"
          viewerActive
          onPlay={vi.fn()}
          onPickUp={vi.fn()}
          onLeave={vi.fn()}
          onOpenRules={vi.fn()}
          soundOn={false}
          onToggleSound={vi.fn()}
          onSendChat={sendChat}
        />,
      )

      for (let index = 1; index <= 4; index++) {
        fireEvent.click(screen.getByRole('button', { name: 'Open reactions' }))
        fireEvent.click(screen.getByRole('tab', { name: /Text/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Custom message' }))
        const input = screen.getByRole('textbox', { name: 'Custom message' })
        fireEvent.change(input, { target: { value: `Burst ${index}` } })
        fireEvent.submit(input.closest('form')!)
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
        now += 800
      }

      expect(sendChat.mock.calls.map(call => call[0])).toEqual(['Burst 1', 'Burst 2', 'Burst 3'])
      expect(screen.getByText('Custom messages are limited to 3 every 10 seconds')).toBeTruthy()
    } finally {
      clock.mockRestore()
    }
  })

  it('shares one short client gate across emoji and text reactions', () => {
    expect(canSendReaction(null, 1000)).toBe(true)
    expect(canSendReaction(1000, 1699)).toBe(false)
    expect(canSendReaction(1000, 1800)).toBe(true)
  })
})

describe('reaction assets and responsive cascade', () => {
  it('ships every catalog image with the upstream Microsoft MIT notice', () => {
    const reactionsDir = `${process.cwd()}/public/reactions`
    const files = readdirSync(reactionsDir)
    expect(REACTION_OPTIONS).toHaveLength(28)
    expect(files.filter(file => file.endsWith('.svg'))).toHaveLength(28)
    for (const option of REACTION_OPTIONS) {
      expect(existsSync(`${process.cwd()}/public${option.asset}`)).toBe(true)
    }
    const license = readFileSync(`${process.cwd()}/public/reactions/LICENSE.txt`, 'utf8')
    expect(license).toContain('MIT License')
    expect(license).toContain('Copyright (c) Microsoft Corporation.')
  })

  it('keeps the bounded five-column visual-viewport rules last in the cascade', () => {
    const css = readFileSync(`${process.cwd()}/src/styles/index.css`, 'utf8')
    const quietLayer = css.indexOf('QUIET TABLE — premium gameplay chrome')
    const legacyPicker = css.indexOf('.game-screen .emote-picker {', quietLayer)
    const finalContract = css.lastIndexOf('Final reaction cascade contract')
    expect(finalContract).toBeGreaterThan(legacyPicker)

    const finalCss = css.slice(finalContract)
    expect(finalCss).toContain('width: min(376px, calc(100vw - 20px))')
    expect(finalCss).toContain('grid-template-columns: repeat(5, minmax(44px, 1fr))')
    expect(finalCss).toContain('min-width: 44px')
    expect(finalCss).toContain('overflow-y: auto')
    expect(finalCss).toContain('var(--app-viewport-height, 100dvh)')
    expect(finalCss).toContain('bottom: auto')
    expect(finalCss).toContain('z-index: calc(var(--z-overlay) + 1)')
  })
})
