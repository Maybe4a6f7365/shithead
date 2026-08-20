// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import {
  GameOverOverlay,
  type GameOverLeaderboardRow,
  type GameOverRematchVoteRow,
} from '../GameOverOverlay'

afterEach(cleanup)

const leaderboard: GameOverLeaderboardRow[] = [
  {
    playerId: 'alex',
    name: 'Alex',
    place: 1,
    isLoser: false,
    cardsPlayed: 12,
    tensPlayed: 3,
    burns: 2,
    pickups: 1,
    largestPickup: 8,
  },
  {
    playerId: 'bea',
    name: 'Bea',
    place: 2,
    isLoser: true,
    cardsPlayed: 9,
    tensPlayed: 1,
    burns: 0,
    pickups: 2,
    largestPickup: 5,
  },
]

const votes: GameOverRematchVoteRow[] = [
  { playerId: 'alex', name: 'Alex', vote: 'yes', connected: true },
  { playerId: 'bea', name: 'Bea', vote: 'no', connected: false },
  { playerId: 'casey', name: 'Casey', vote: 'pending', connected: true },
]

describe('GameOverOverlay round summary', () => {
  it('renders an accessible leaderboard, loser marker, and complete-round highlights', () => {
    render(
      <GameOverOverlay
        result="win"
        shitheadName="Bea"
        canRematch={false}
        onLeave={vi.fn()}
        leaderboard={leaderboard}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Round leaderboard' })).toBeTruthy()
    const table = screen.getByRole('table', { name: 'Finishing places and statistics for this round' })
    const alexRow = within(table).getByRole('row', { name: /1st Alex 12 3 2 1 8/i })
    expect(alexRow).toBeTruthy()
    const beaRow = within(table).getByRole('row', { name: /2nd Bea, Shithead 9 1 0 2 5/i })
    expect(beaRow.getAttribute('data-loser')).toBe('true')

    const highlights = screen.getByRole('list', { name: 'Round highlights' })
    expect(within(highlights).getByText('Alex · 8 cards')).toBeTruthy()
    expect(within(highlights).getByText('Alex · 3')).toBeTruthy()
    expect(within(highlights).getByText('Alex · 2')).toBeTruthy()
  })

  it('shows unresolved places and a legacy-stats notice without inventing totals', () => {
    const { rerender } = render(
      <GameOverOverlay
        result="neutral"
        canRematch={false}
        onLeave={vi.fn()}
        leaderboard={[{ ...leaderboard[0], place: null, cardsPlayed: Number.NaN, largestPickup: -2 }]}
        statsNote="legacy"
      />,
    )

    expect(screen.getByText('Detailed statistics were not recorded for this round.')).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('cell', { name: '—' }).length).toBeGreaterThanOrEqual(6)
    expect(screen.queryByRole('list', { name: 'Round highlights' })).toBeNull()

    rerender(
      <GameOverOverlay
        result="neutral"
        canRematch={false}
        onLeave={vi.fn()}
        leaderboard={leaderboard}
        statsNote="partial"
      />,
    )
    expect(screen.getByText('Only recorded events are shown. The ≥ symbol means “at least”.')).toBeTruthy()
    expect(within(screen.getByRole('table')).getByRole('cell', { name: '≥12' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Round highlights' })).toBeNull()
  })
})

describe('GameOverOverlay rematch voting', () => {
  it('shows the tally and per-player tags, and sends explicit Yes and No votes', () => {
    const onRematchVote = vi.fn()
    const { rerender } = render(
      <GameOverOverlay
        result="neutral"
        canRematch={false}
        onLeave={vi.fn()}
        rematchVotes={votes}
        viewerRematchVote="yes"
        onRematchVote={onRematchVote}
      />,
    )

    expect(screen.getByText('1/3 ready')).toBeTruthy()
    expect(screen.getByText(/Voting No, or being offline without a vote, releases your seat/)).toBeTruthy()
    expect(screen.getByText(/brief anti-spam delay/)).toBeTruthy()
    const voteList = screen.getByRole('list', { name: 'Rematch votes' })
    expect(within(voteList).getByRole('listitem', { name: 'Alex: Yes' })).toBeTruthy()
    expect(within(voteList).getByRole('listitem', { name: 'Bea: No, offline' })).toBeTruthy()
    expect(within(voteList).getByRole('listitem', { name: 'Casey: Pending' })).toBeTruthy()

    const yes = screen.getByRole('button', { name: 'Vote yes' })
    expect(yes.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(yes)
    fireEvent.click(screen.getByRole('button', { name: 'Vote no' }))
    expect(onRematchVote.mock.calls).toEqual([['yes'], ['no']])

    rerender(
      <GameOverOverlay
        result="neutral"
        canRematch={false}
        onLeave={vi.fn()}
        rematchVotes={votes}
        viewerRematchVote="yes"
        onRematchVote={onRematchVote}
        rematchVotePending
        pendingRematchVote="no"
      />,
    )
    expect(screen.getByText('Submitting vote…')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Vote no' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('button', { name: 'Vote yes' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('gates the host start action and shows the guest waiting copy', () => {
    const onStartRematch = vi.fn()
    const { rerender } = render(
      <GameOverOverlay
        result="neutral"
        canRematch={false}
        onLeave={vi.fn()}
        rematchVotes={votes}
        onRematchVote={vi.fn()}
        canStartRematch={false}
        onStartRematch={onStartRematch}
      />,
    )

    const disabledStart = screen.getByRole('button', { name: /Start rematch/i }) as HTMLButtonElement
    expect(disabledStart.disabled).toBe(true)
    fireEvent.click(disabledStart)
    expect(onStartRematch).not.toHaveBeenCalled()
    expect(screen.getByText('Every online player must vote, with the host and at least one other player choosing Yes.')).toBeTruthy()

    rerender(
      <GameOverOverlay
        result="neutral"
        canRematch={false}
        onLeave={vi.fn()}
        rematchVotes={votes}
        onRematchVote={vi.fn()}
        canStartRematch
        onStartRematch={onStartRematch}
      />,
    )
    const enabledStart = screen.getByRole('button', { name: /Start rematch/i }) as HTMLButtonElement
    expect(enabledStart.disabled).toBe(false)
    fireEvent.click(enabledStart)
    expect(onStartRematch).toHaveBeenCalledTimes(1)

    rerender(
      <GameOverOverlay
        result="neutral"
        canRematch={false}
        onLeave={vi.fn()}
        rematchVotes={votes}
        waitingCopy="Waiting for José…"
      />,
    )
    expect(screen.getByText('Waiting for José…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Start rematch/i })).toBeNull()
  })

  it('focuses the first voting action and traps focus inside the scrolling dialog', () => {
    render(
      <GameOverOverlay
        result="neutral"
        canRematch={false}
        onLeave={vi.fn()}
        rematchVotes={votes}
        onRematchVote={vi.fn()}
      />,
    )

    const yes = screen.getByRole('button', { name: 'Vote yes' })
    const leave = screen.getByRole('button', { name: 'Leave' })
    expect(document.activeElement).toBe(yes)

    leave.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(yes)
  })

  it('keeps the original single-player Rematch action working when no vote data is supplied', () => {
    const onRematch = vi.fn()
    render(
      <GameOverOverlay
        result="win"
        canRematch
        onRematch={onRematch}
        onLeave={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }))
    expect(onRematch).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: 'Vote to rematch' })).toBeNull()
  })
})
