// ============================================================================
// Rules regression tests — every confirmed audit bug (B1-B15) pinned down
// ============================================================================
import { describe, it, expect } from 'vitest'
import { playCards, pickUpPile, canPickUpPile, canPlay, getTopCard, getTopRank, pileSize, MAX_GAME_TURNS } from '../index'
import type { Card } from '../index'
import { c, mkState } from './helpers'

const hand3 = (...ranks: Array<Card['rank']>) => ranks.map(r => c(r))

describe('B1: burn leaves an empty pile; leader may play ANY card', () => {
  it('10 burn: pile emptied, same player leads, any card follows', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('10'), c('5')] }, { id: 'b', hand: [c('K')] }],
      pile: [[c('9')]],
    })
    const r1 = playCards(state, 'a', [state.players[0].hand[0]])
    expect(r1.error).toBeUndefined()
    expect(r1.state.pile.length).toBe(0)              // burned cards leave the game
    expect(getTopCard(r1.state)).toBeNull()
    expect(r1.state.currentPlayerIdx).toBe(0)         // same player leads
    // Leader can play any card, even one that could not beat a 10
    const r2 = playCards(r1.state, 'a', [r1.state.players[0].hand.find(cd => cd.rank === '5')!])
    expect(r2.error).toBeUndefined()
    expect(r2.state.pile[0].cards[0].rank).toBe('5')
  })

  it('joker burn: pile emptied, same player leads, any card follows', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('JOKER', null), c('4')] }, { id: 'b', hand: [c('K')] }],
      pile: [[c('A')]],
    })
    const r1 = playCards(state, 'a', [state.players[0].hand[0]])
    expect(r1.state.pile.length).toBe(0)
    expect(r1.state.currentPlayerIdx).toBe(0)
    const r2 = playCards(r1.state, 'a', [r1.state.players[0].hand[0]])
    expect(r2.error).toBeUndefined()
  })

  it('quartet burn: pile emptied, same player leads, CLEAR_PILE logged', () => {
    const q = [c('7','♠'), c('7','♥'), c('7','♦'), c('7','♣')]
    const state = mkState({
      players: [{ id: 'a', hand: [...q, c('9')] }, { id: 'b', hand: [c('K')] }],
      pile: [[c('6')]],
    })
    const r = playCards(state, 'a', q)
    expect(r.error).toBeUndefined()
    expect(r.state.pile.length).toBe(0)
    expect(r.state.currentPlayerIdx).toBe(0)
    expect(r.state.log.some(e => e.type === 'CLEAR_PILE' && e.reason === 'quartet')).toBe(true)
  })
})

describe('B2: burning (or playing) with last cards never strands the turn', () => {
  it('burn with last card in a 3-player game advances to next active player', () => {
    const state = mkState({
      players: [
        { id: 'a', hand: [c('10')] },            // burns and goes out
        { id: 'b', hand: [c('5')] },
        { id: 'c', hand: [c('6')] },
      ],
      pile: [[c('9')]],
      currentPlayerIdx: 0,
    })
    const r = playCards(state, 'a', [state.players[0].hand[0]])
    expect(r.error).toBeUndefined()
    expect(r.state.players[0].isOut).toBe(true)
    expect(r.state.currentPlayerIdx).toBe(1)    // lead passed, not stranded
    // Next player can actually move on the empty pile
    const r2 = playCards(r.state, 'b', [r.state.players[1].hand[0]])
    expect(r2.error).toBeUndefined()
  })

  it('plain play going out advances the turn and skips out players', () => {
    const state = mkState({
      players: [
        { id: 'a', hand: [c('K')] },
        { id: 'b', hand: [c('5')] },
        { id: 'c', hand: [c('6')] },
        { id: 'd', hand: [c('7')] },
      ],
      pile: [[c('9')]],
      currentPlayerIdx: 1,
    })
    // b plays... can't beat 9? use a card that beats 9
    const s2 = mkState({
      players: state.players.map((p, i) => i === 1 ? { ...p, hand: [c('Q')] } : p),
      pile: [[c('9')]],
      currentPlayerIdx: 1,
    })
    const r = playCards(s2, 'b', [s2.players[1].hand[0]])
    expect(r.state.players[1].isOut).toBe(true)
    expect(r.state.currentPlayerIdx).toBe(2)
    // c goes out next, turn must skip to d
    const s3 = { ...r.state, players: r.state.players.map((p, i) => i === 2 ? { ...p, hand: [c('A')] } : p) }
    const r2 = playCards(s3, 'c', [s3.players[2].hand[0]])
    expect(r2.state.players[2].isOut).toBe(true)
    expect(r2.state.currentPlayerIdx).toBe(3)
  })
})

describe('B3/B8/V1/V2/B13: pickUpPile guards', () => {
  it('exposes pickup eligibility without changing state', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('5')] }, { id: 'b', hand: [c('6')] }],
      pile: [[c('7')]],
    })
    expect(canPickUpPile(state, 'a')).toBe(true)
    expect(canPickUpPile(state, 'b')).toBe(false)
    expect(canPickUpPile({ ...state, pile: [] }, 'a')).toBe(false)
    expect(state.pile).toHaveLength(1)
  })

  it('rejected during rearrange phase (no free stock drain)', () => {
    const state = mkState({
      players: [{ id: 'a', hand: hand3('5','6','7') }, { id: 'b', hand: hand3('8','9','J') }],
      stock: hand3('Q','K','A'),
      phase: 'rearrange',
    })
    const r = pickUpPile(state, 'a')
    expect(r.error).toMatch(/phase/)
    expect(r.state.players[0].hand.length).toBe(3)
    expect(r.state.stock.length).toBe(3)
  })

  it('rejected during gameOver (terminates — no infinite loop)', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('5')] }, { id: 'b', isOut: true }],
      pile: [[c('7')]],
      phase: 'gameOver',
    })
    const r = pickUpPile(state, 'a')
    expect(r.error).toMatch(/phase/)
  })

  it('terminates even if only one active player remains in play phase', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('5')] }, { id: 'b', isOut: true }, { id: 'c', isOut: true }],
      pile: [[c('7')]],
    })
    const r = pickUpPile(state, 'a') // must return, not hang
    expect(r.error).toBeUndefined()
    expect(r.state.players[0].hand.length).toBe(2)
  })

  it('rejected on an empty pile (no free 3-card draw)', () => {
    const state = mkState({
      players: [{ id: 'a', hand: hand3('5','6','7') }, { id: 'b', hand: [c('8')] }],
      stock: hand3('9','J','Q'),
    })
    const r = pickUpPile(state, 'a')
    expect(r.error).toMatch(/empty/i)
    expect(r.state.players[0].hand.length).toBe(3)
    expect(r.state.stock.length).toBe(3)
  })

  it('rejected in lobby/roundEnd phases', () => {
    for (const phase of ['lobby', 'roundEnd'] as const) {
      const state = mkState({ players: [{ id: 'a' }, { id: 'b' }], pile: [[c('7')]], phase })
      expect(pickUpPile(state, 'a').error).toMatch(/phase/)
    }
  })
})

describe('B5/D5: multi-card plays must share one rank', () => {
  it('rejects a mixed-rank set on an empty pile', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('5'), c('K')] }, { id: 'b', hand: [c('6')] }],
    })
    expect(playCards(state, 'a', state.players[0].hand).error).toMatch(/rank/i)
  })
  it('rejects a mixed-rank set on a non-empty pile', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('K'), c('A')] }, { id: 'b', hand: [c('6')] }],
      pile: [[c('3')]],
    })
    expect(playCards(state, 'a', state.players[0].hand).error).toMatch(/rank/i)
  })
  it('rejects wilds mixed with a rank (2+5 is not a set)', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('2'), c('5')] }, { id: 'b', hand: [c('6')] }],
    })
    expect(playCards(state, 'a', state.players[0].hand).error).toMatch(/rank/i)
  })
  it('accepts an equal-rank pair and reads the top correctly', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('5','♠'), c('5','♥')] }, { id: 'b', hand: [c('4')] }],
    })
    const r = playCards(state, 'a', state.players[0].hand)
    expect(r.error).toBeUndefined()
    expect(pileSize(r.state)).toBe(2)
    // b's 4 cannot follow a pair of 5s
    expect(playCards(r.state, 'b', [r.state.players[1].hand[0]]).error).toBeTruthy()
  })
})

describe('B7: duplicate card ids rejected; forged ranks canonicalized', () => {
  it('rejects the same card twice in one play', () => {
    const card = c('5')
    const state = mkState({
      players: [{ id: 'a', hand: [card] }, { id: 'b', hand: [c('6')] }],
    })
    expect(playCards(state, 'a', [card, card]).error).toMatch(/[Dd]uplicate/)
  })
  it('uses the server-side card, not client-forged rank/suit', () => {
    const real = c('5', '♠', 'real-id')
    const forged = { id: 'real-id', suit: '♥' as const, rank: 'A' as const }
    const state = mkState({
      players: [{ id: 'a', hand: [real] }, { id: 'b', hand: [c('6')] }],
      pile: [[c('K')]],
    })
    // Forged "A" would beat K; the real 5 must not.
    expect(playCards(state, 'a', [forged]).error).toBeTruthy()
    const ok = playCards(state, 'a', [{ id: 'real-id', suit: null, rank: '3' }])
    expect(ok.error).toBeTruthy() // still a 5 underneath: cannot beat K
  })
})

describe('B6/D6: zone gating (hand → face-up → face-down)', () => {
  it('face-up locked while hand is non-empty', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('5')], faceUp: [c('9')], faceDown: [c('K')] }, { id: 'b', hand: [c('6')] }],
    })
    expect(playCards(state, 'a', [state.players[0].faceUp[0]]).error).toBeTruthy()
    expect(playCards(state, 'a', [state.players[0].faceDown[0]]).error).toBeTruthy()
    expect(playCards(state, 'a', [state.players[0].hand[0]]).error).toBeUndefined()
  })
  it('face-up allowed once hand is empty; face-down still locked', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [], faceUp: [c('9')], faceDown: [c('K')] }, { id: 'b', hand: [c('6')] }],
      phase: 'endgame',
    })
    expect(playCards(state, 'a', [state.players[0].faceDown[0]]).error).toBeTruthy()
    expect(playCards(state, 'a', [state.players[0].faceUp[0]]).error).toBeUndefined()
  })
  it('face-down blind only when nothing else remains', () => {
    const state = mkState({
      players: [{ id: 'a', faceDown: [c('K')] }, { id: 'b', hand: [c('6')] }],
      phase: 'endgame',
    })
    expect(playCards(state, 'a', [state.players[0].faceDown[0]]).error).toBeUndefined()
  })
})

describe('B11/D7: blind face-down play', () => {
  it('allows only single-card blind plays', () => {
    const state = mkState({
      players: [{ id: 'a', faceDown: [c('K'), c('Q')] }, { id: 'b', hand: [c('6')] }],
      phase: 'endgame',
    })
    expect(playCards(state, 'a', state.players[0].faceDown).error).toMatch(/blind|one/i)
  })
  it('failed blind play forces pickup of pile + revealed card; turn passes', () => {
    const blind = c('5')
    const state = mkState({
      players: [{ id: 'a', faceDown: [blind, c('K')] }, { id: 'b', hand: [c('6')] }],
      pile: [[c('Q')], [c('9')]],
      phase: 'endgame',
    })
    const r = playCards(state, 'a', [blind])
    expect(r.error).toBeUndefined()                  // legal action, bad outcome
    const a = r.state.players[0]
    expect(a.faceDown.length).toBe(1)
    expect(a.hand.map(cd => cd.rank).sort()).toEqual(['5','9','Q'])
    expect(r.state.pile.length).toBe(0)
    expect(r.state.currentPlayerIdx).toBe(1)         // turn passed
    expect(r.state.log.some(e => e.type === 'BLIND_REVEAL')).toBe(true)
  })
  it('successful blind play lands on the pile and can go out', () => {
    const blind = c('K')
    const state = mkState({
      players: [{ id: 'a', faceDown: [blind] }, { id: 'b', hand: [c('6')] }],
      pile: [[c('Q')]],
      phase: 'endgame',
    })
    const r = playCards(state, 'a', [blind])
    expect(r.error).toBeUndefined()
    expect(r.state.players[0].isOut).toBe(true)
    expect(r.state.phase).toBe('gameOver')
    expect(r.state.loserId).toBe('b')
  })
})

describe('B10/D1: canPlay agrees with playCards (2 on empty pile; any opener)', () => {
  it('2 can lead an empty pile in both canPlay and playCards', () => {
    const two = c('2')
    expect(canPlay(two, null)).toBe(true)
    const state = mkState({
      players: [{ id: 'a', hand: [two] }, { id: 'b', hand: [c('6')] }],
    })
    expect(playCards(state, 'a', [two]).error).toBeUndefined()
  })
  it('any rank can open an empty pile', () => {
    const seven = c('7')
    const state = mkState({
      players: [{ id: 'a', hand: [seven] }, { id: 'b', hand: [c('6')] }],
    })
    expect(playCards(state, 'a', [seven]).error).toBeUndefined()
  })
})

describe('B12/D2: 10 is unrestricted except after an effective 7', () => {
  it('10 can be played on an A and burns', () => {
    const ten = c('10')
    expect(canPlay(ten, 'A')).toBe(true)
    const state = mkState({
      players: [{ id: 'a', hand: [ten] }, { id: 'b', hand: [c('6')] }],
      pile: [[c('A')]],
    })
    const r = playCards(state, 'a', [ten])
    expect(r.error).toBeUndefined()
    expect(r.state.pile.length).toBe(0)
  })

  it('10 cannot be played directly on a 7', () => {
    const ten = c('10')
    expect(canPlay(ten, '7')).toBe(false)
    const state = mkState({
      players: [{ id: 'a', hand: [ten] }, { id: 'b', hand: [c('6')] }],
      pile: [[c('7')]],
    })
    expect(playCards(state, 'a', [ten]).error).toMatch(/cannot be played/i)
  })

  it('10 cannot bypass a 7 mirrored by one or more 3s', () => {
    const ten = c('10')
    const state = mkState({
      players: [{ id: 'a', hand: [ten] }, { id: 'b', hand: [c('6')] }],
      pile: [[c('7')], [c('3')], [c('3', '♥')]],
    })
    expect(getTopRank(state)).toBe('7')
    expect(playCards(state, 'a', [ten]).error).toMatch(/cannot be played/i)
  })
})

describe('confirmed special-card rules: reset 2, copying 3, low 7, stacking 8', () => {
  it('2 is playable anytime and resets the active rank constraint', () => {
    const state = mkState({
      players: [
        { id: 'a', hand: [c('2'), c('5')] },
        { id: 'b', hand: [c('6'), c('A')] },
      ],
      pile: [[c('K')]],
    })
    const played = playCards(state, 'a', [state.players[0].hand[0]])
    expect(played.error).toBeUndefined()
    expect(getTopCard(played.state)?.rank).toBe('2')
    expect(getTopRank(played.state)).toBeNull()
    expect(playCards(played.state, 'b', [played.state.players[1].hand[0]]).error).toBeUndefined()
  })

  it('3 is playable anytime and copies the effective card below through a chain of 3s', () => {
    const state = mkState({
      players: [
        { id: 'a', hand: [c('3'), c('4')] },
        { id: 'b', hand: [c('3'), c('9')] },
        { id: 'c', hand: [c('6'), c('Q')] },
      ],
      pile: [[c('7')]],
    })
    const three = playCards(state, 'a', [state.players[0].hand[0]])
    expect(three.error).toBeUndefined()
    expect(getTopRank(three.state)).toBe('7')
    const nextThree = playCards(three.state, 'b', [three.state.players[1].hand[0]])
    expect(nextThree.error).toBeUndefined()
    expect(getTopRank(nextThree.state)).toBe('7')
    expect(playCards(nextThree.state, 'c', [nextThree.state.players[2].hand[0]]).error).toBeUndefined()
  })

  it('3 copies a reset 2 as an unrestricted top instead of restoring older cards', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('3'), c('4')] }, { id: 'b', hand: [c('9')] }],
      pile: [[c('K')], [c('2')]],
    })
    const played = playCards(state, 'a', [state.players[0].hand[0]])
    expect(played.error).toBeUndefined()
    expect(getTopRank(played.state)).toBeNull()
    expect(playCards(played.state, 'b', [played.state.players[1].hand[0]]).error).toBeUndefined()
  })

  it('a reset 2 on an otherwise empty pile leaves it unrestricted', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('2'), c('4')] }, { id: 'b', hand: [c('A')] }],
    })
    const played = playCards(state, 'a', [state.players[0].hand[0]])
    expect(getTopRank(played.state)).toBeNull()
    expect(playCards(played.state, 'b', [played.state.players[1].hand[0]]).error).toBeUndefined()
  })

  it('7 forces the next ordinary play to rank 7 or lower, including through a 3', () => {
    const state = mkState({
      players: [
        { id: 'a', hand: [c('7'), c('K')] },
        { id: 'b', hand: [c('3'), c('9')] },
        { id: 'c', hand: [c('6'), c('8')] },
      ],
      pile: [[c('5')]],
    })
    const seven = playCards(state, 'a', [state.players[0].hand[0]])
    expect(playCards(seven.state, 'b', [seven.state.players[1].hand[1]]).error).toMatch(/cannot be played/i)
    const three = playCards(seven.state, 'b', [seven.state.players[1].hand[0]])
    expect(getTopRank(three.state)).toBe('7')
    expect(playCards(three.state, 'c', [three.state.players[2].hand[1]]).error).toMatch(/cannot be played/i)
    expect(playCards(three.state, 'c', [three.state.players[2].hand[0]]).error).toBeUndefined()
  })

  it('3 over an 8 copies its rank constraint but does not repeat its skip effect', () => {
    const state = mkState({
      players: [
        { id: 'a', hand: [c('3'), c('9')] },
        { id: 'b', hand: [c('9')] },
        { id: 'c', hand: [c('9')] },
      ],
      pile: [[c('8')]],
    })
    const result = playCards(state, 'a', [state.players[0].hand[0]])
    expect(result.error).toBeUndefined()
    expect(getTopRank(result.state)).toBe('8')
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('b')
  })

  it('one 8 skips one active player', () => {
    const state = mkState({
      players: [
        { id: 'a', hand: [c('8'), c('9')] },
        { id: 'b', hand: [c('9')] },
        { id: 'c', hand: [c('9')] },
        { id: 'd', hand: [c('9')] },
      ],
      pile: [[c('5')]],
    })
    const result = playCards(state, 'a', [state.players[0].hand[0]])
    expect(result.error).toBeUndefined()
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('c')
  })

  it('a pair of 8s stacks and skips two active players', () => {
    const eights = [c('8'), c('8', '♥')]
    const state = mkState({
      players: [
        { id: 'a', hand: [...eights, c('9')] },
        { id: 'b', hand: [c('9')] },
        { id: 'c', hand: [c('9')] },
        { id: 'd', hand: [c('9')] },
      ],
      pile: [[c('5')]],
    })
    const result = playCards(state, 'a', eights)
    expect(result.error).toBeUndefined()
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('d')
  })

  it('skip counting ignores players who are already out', () => {
    const state = mkState({
      players: [
        { id: 'a', hand: [c('8'), c('9')] },
        { id: 'b', isOut: true },
        { id: 'c', hand: [c('9')] },
        { id: 'd', hand: [c('9')] },
      ],
      pile: [[c('5')]],
    })
    const result = playCards(state, 'a', [state.players[0].hand[0]])
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('d')
  })

  it('in a two-player round one 8 returns the turn, while a pair skips both seats', () => {
    const one = mkState({
      players: [{ id: 'a', hand: [c('8'), c('9')] }, { id: 'b', hand: [c('9')] }],
      pile: [[c('5')]],
    })
    const oneResult = playCards(one, 'a', [one.players[0].hand[0]])
    expect(oneResult.state.players[oneResult.state.currentPlayerIdx].id).toBe('a')

    const pair = [c('8'), c('8', '♥')]
    const two = mkState({
      players: [{ id: 'a', hand: [...pair, c('9')] }, { id: 'b', hand: [c('9')] }],
      pile: [[c('5')]],
    })
    const pairResult = playCards(two, 'a', pair)
    expect(pairResult.state.players[pairResult.state.currentPlayerIdx].id).toBe('b')
  })

  it('an 8 played as the last card still skips the next remaining player', () => {
    const state = mkState({
      players: [
        { id: 'a', hand: [c('8')] },
        { id: 'b', hand: [c('9')] },
        { id: 'c', hand: [c('9')] },
      ],
      pile: [[c('5')]],
    })
    const result = playCards(state, 'a', [state.players[0].hand[0]])
    expect(result.state.players[0].isOut).toBe(true)
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('c')
  })

  it('four 8s burn as a quartet, so burn precedence keeps the lead', () => {
    const eights = [c('8'), c('8', '♥'), c('8', '♦'), c('8', '♣')]
    const state = mkState({
      players: [
        { id: 'a', hand: [...eights, c('9')] },
        { id: 'b', hand: [c('9')] },
        { id: 'c', hand: [c('9')] },
      ],
      pile: [[c('5')]],
    })
    const result = playCards(state, 'a', eights)
    expect(result.state.pile).toHaveLength(0)
    expect(result.state.players[result.state.currentPlayerIdx].id).toBe('a')
  })
})

describe('Game over + turn order', () => {
  it('2-player: playing last card ends the game, loser set, events emitted once', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('K')] }, { id: 'b', hand: [c('6')] }],
      pile: [[c('9')]],
    })
    const r = playCards(state, 'a', [state.players[0].hand[0]])
    expect(r.state.phase).toBe('gameOver')
    expect(r.state.loserId).toBe('b')
    expect(r.state.log.filter(e => e.type === 'PLAYER_OUT').length).toBe(1)
    expect(r.state.log.filter(e => e.type === 'GAME_OVER').length).toBe(1)
    // No further moves accepted
    expect(playCards(r.state, 'b', [r.state.players[1].hand[0]]).error).toMatch(/phase/)
    expect(pickUpPile(r.state, 'b').error).toMatch(/phase/)
  })
  it('burn with last card in a 2-player game ends the game cleanly', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('10')] }, { id: 'b', hand: [c('6')] }],
      pile: [[c('9')]],
    })
    const r = playCards(state, 'a', [state.players[0].hand[0]])
    expect(r.state.phase).toBe('gameOver')
    expect(r.state.loserId).toBe('b')
  })
})

describe('Stalemate cap (D11)', () => {
  it('ends the game at MAX_GAME_TURNS; loser = most cards; no moves after', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('5'), c('6')] }, { id: 'b', hand: [c('9'), c('J'), c('Q')] }],
      pile: [[c('4')]],
    })
    const atCap = { ...state, turnCount: MAX_GAME_TURNS - 1 }
    const r = playCards(atCap, 'a', [atCap.players[0].hand[0]])
    expect(r.error).toBeUndefined()
    expect(r.state.turnCount).toBe(MAX_GAME_TURNS)
    expect(r.state.phase).toBe('gameOver')
    expect(r.state.loserId).toBe('b') // b holds the most cards
    expect(r.state.log.some(e => e.type === 'GAME_OVER' && e.loserId === 'b')).toBe(true)
    expect(pickUpPile(r.state, 'b').error).toMatch(/phase/)
  })
  it('does not override a natural game over on the same turn', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('K')] }, { id: 'b', hand: [c('6')] }],
      pile: [[c('9')]],
    })
    const atCap = { ...state, turnCount: MAX_GAME_TURNS - 1 }
    const r = playCards(atCap, 'a', [atCap.players[0].hand[0]])
    expect(r.state.phase).toBe('gameOver')
    expect(r.state.loserId).toBe('b') // natural loser (last holding cards)
  })
})

describe('Refill + endgame transitions', () => {
  it('draw event count matches cards taken; hand capped by remaining stock', () => {
    const state = mkState({
      players: [{ id: 'a', hand: [c('5','♠'), c('5','♥'), c('7')] }, { id: 'b', hand: [c('6')] }],
      stock: [c('9')], // only 1 card left in stock
    })
    const r = playCards(state, 'a', state.players[0].hand.slice(0, 2))
    expect(r.error).toBeUndefined()
    const a = r.state.players[0]
    expect(a.hand.length).toBe(2) // 1 kept + 1 drawn (stock ran out)
    expect(r.state.stock.length).toBe(0)
    const draw = r.state.log.find(e => e.type === 'DRAW')
    expect(draw && draw.type === 'DRAW' && draw.count).toBe(1)
  })
  it('global phase flips to endgame when stock empties and someone is on table cards', () => {
    const state = mkState({
      players: [
        { id: 'a', hand: [c('5')] },
        { id: 'b', hand: [], faceUp: [c('K')], faceDown: [c('Q')] },
      ],
      stock: [c('9')],
    })
    // a's play will not drain stock (hand stays 1 < 3 → draws the last card)
    const r = playCards(state, 'a', [state.players[0].hand[0]])
    expect(r.state.stock.length).toBe(0)
    expect(r.state.phase).toBe('endgame')
  })
  it('picking up in endgame returns the player to hand play', () => {
    const state = mkState({
      players: [
        { id: 'a', hand: [], faceUp: [c('4')] },
        { id: 'b', hand: [c('6')] },
      ],
      pile: [[c('K')]],
      phase: 'endgame',
    })
    const r = pickUpPile(state, 'a')
    expect(r.error).toBeUndefined()
    const a = r.state.players[0]
    expect(a.hand.length).toBe(1)
    // a is back in the hand zone: face-up card no longer playable next turn,
    // hand card is.
    const s2 = { ...r.state, currentPlayerIdx: 0 }
    expect(playCards(s2, 'a', [a.faceUp[0]]).error).toBeTruthy()
    expect(playCards(s2, 'a', [a.hand[0]]).error).toBeUndefined()
  })
})
