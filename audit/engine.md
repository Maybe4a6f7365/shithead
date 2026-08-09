# Shithead Engine & Rules Audit

Scope: `app/src/engine/index.ts` (rules/reducers/AI), `app/src/engine/protocol.ts` (wire format), tests in `app/src/engine/__tests__/`, plus consumers `app/src/sp/SPSinglePlayer.ts` and `app/src/worker/index.ts` (to confirm no downstream compensation). Reference rules: `README.md` §"Game Rules" (German variant). All "confirmed" bugs were reproduced by executing the transpiled engine (node v20) against crafted states. No repository files were modified.

---

## 1. What exists (concise map)

**State model** (`index.ts:9-56`): `Card{id,suit,rank}`; `Player{id,name,isAI,aiDifficulty,hand,faceUp,faceDown,isOut}`; `PileEntry{cards,cleared}`; `GameState{phase,players,stock,pile,currentPlayerIdx,playDirection,turnCount,loserId,log}`. Phases: `lobby|rearrange|play|endgame|roundEnd|gameOver` (`lobby`/`roundEnd` are never produced by the engine).

**Deck/init** (`index.ts:60-182`): 52 French + 2 optional Jokers (`makeDeck`, ids encode suit/rank, e.g. `♠-K-12`, `JOKER-A-52`). Deals 3 down/3 up/3 hand per player, rest to stock. Start player = first with a 3 face-up, else fallback chain (see §3).

**Move validation/reducers**:
- `canPlay` (`index.ts:98-106`): 2/Joker always legal; empty pile only 3/10/Joker (2 inconsistently, see Bug 10); otherwise rank ≥ top.
- `playCards` (`index.ts:216-357`): phase, turn, possession, allowed-zone checks; plays N cards as one entry; refill hand to 3 from stock; marks `isOut`; global phase flip to `endgame` when stock empty and someone is on table cards; burn ⇒ same player leads; `activePlayers===1` ⇒ `gameOver` with `loserId`.
- `pickUpPile` (`index.ts:359-412`): collects non-cleared entries, draws stock so collected ≥ 3, advances turn. **No phase check.**
- `rearrange`/`startPlay` (`index.ts:184-209`): lobby-phase card swapping.

**Special cards**: 2 = wild rank −1 (`index.ts:67`); 10/Joker = burn + replay, quartet (exactly 4 same non-wild rank in one action) = burn (`index.ts:108-124, 280-282`).

**AI** (`index.ts:421-469`): `pickAIMove` over **hand only**; easy = random playable; medium/hard = lowest non-special; hard adds quartet-on-pile≥3, 10-on-pile≥5, 2-when-only-2s.

**Protocol** (`protocol.ts`): 11 client msgs, 8 server msgs, `isClientMsg` validator (73-101), per-viewer sanitizer `serializeGameState` (111-124) that blanks rank/suit of opponent hands and all face-down cards but **keeps card ids**, and `toPlayerSummary` (127-136). No protocol version/sequence numbers.

---

## 2. Confirmed bugs (severity-ranked)

**B1 — CRITICAL: Burned pile entry stays on top; after a 10 the leader must beat the 10.**
`index.ts:282` pushes the burn entry with `cleared:true`, and cleared entries are never removed or skipped. Next `playCards` computes `topRank` from the last entry (`index.ts:250-251`) = the cleared 10. Reproduced: after burning a 9 with a 10, the same player leads but `play 5 → error "Card 5 cannot be played on 10"`. Breaks README "10 … clears the pile, same player leads" and quartet burns the same way. (Joker burns accidentally work because `RANK_ORDER.JOKER = -2` lets anything follow — inconsistent with 10.) `getTopCard` (`index.ts:477-479`) is wrong for clients too.

**B2 — CRITICAL: Burning with your last cards strands the turn on an out player (3+ players).**
`index.ts:316-325`: if `cleared`, `nextIdx` is left unchanged even when the player just went `isOut` (set at `index.ts:298-305`). Reproduced (3 players): after A burns with last card, `currentPlayerIdx` stays 0 and every subsequent move errors `"Player already out"` — game permanently stuck. (2-player games are saved only by the `gameOver` check at `index.ts:327-333`.)

**B3 — CRITICAL: `pickUpPile` infinite loop / worker hang when the picker is the only active player.**
No phase guard (`index.ts:359-364`), and the advance loop `do {…} while (players[nextIdx].id === playerId || players[nextIdx].isOut)` (`index.ts:383-389`) never terminates if every other player is `isOut`. Reproduced: `pickUpPile` in phase `gameOver` (2 players, one out) hangs the process (timeout kill). In the Durable Object this is a per-room DoS.

**B4 — CRITICAL (security): Hidden information leaks via card ids; entire stock leaked.**
`makeDeck` ids are `` `${suit}-${rank}-${idx}` `` (`index.ts:77,81-82`). `hiddenCard` (`protocol.ts:105`) blanks rank/suit but preserves the id, so every opponent hand card and every face-down card broadcast in `GAME_STATE` reveals its exact identity (e.g. `♦-K-38`). The blind endgame and all hands are fully compromised. Additionally `serializeGameState` (`protocol.ts:111-124`) shallow-spreads state, so **`stock` (draw order, incl. ranks) is sent to every client**. `protocol.test.ts:43` even asserts the leaking id is preserved.

**B5 — HIGH: No equal-rank validation for multi-card plays.**
README: "play a card or **equal-rank set**". `playCards` (`index.ts:258-265`) only checks each card ≥ top individually; on an empty pile it merely requires *some* card to be 3/10/Joker (`index.ts:254-257`). Reproduced: `[5,K]` played together on a 3 is accepted; pile top is then read from `cards[0]` (`index.ts:251`), so ordering of the submitted array manipulates the effective top.

**B6 — HIGH: Face-up cards are playable at any time, even with a full hand and full stock.**
`allowedCards` (`index.ts:237-241`) = hand+faceUp whenever the player's hand is non-empty (and always in phase `play`). Reproduced: playing a face-up 9 with 3 hand cards and stock remaining succeeds. Per README, face-up is endgame-only ("when stock runs out, play from face-up"). Same flaw in `endgame` while hand cards remain.

**B7 — HIGH: Duplicate card ids in one `PLAY` are accepted — card duplication exploit.**
Possession check (`index.ts:230-234`) uses `some()` per submitted card; nothing requires distinct ids; removal uses a `Set` (`index.ts:268-276`). Reproduced: `playCards(s,'a',[cardX,cardX])` succeeds — one real card leaves the hand, two copies land on the pile. Protocol validator (`protocol.ts:87-89`) only checks that each entry has an id string.

**B8 — HIGH: `pickUpPile` works in any phase; in `rearrange` it deals 3 free cards.**
No phase check (`index.ts:359-364`) plus the draw-to-3 logic (`index.ts:374-378`): reproduced — pickup during `rearrange` grew the hand 3→6 and drained stock 36→33. Also accepted in `gameOver` (leads to B3).

**B9 — MEDIUM: AI can never finish the game.**
`pickAIMove` only filters `player.hand` (`index.ts:425`). With an empty hand it always returns `pickUp`, even with face-up/face-down cards remaining and an empty pile (reproduced in `endgame`: `pickUp`, no-op, turn passes). An AI can therefore never go out; AI-vs-AI endgames loop indefinitely, and `SPSinglePlayer.tickAI` (`SPSinglePlayer.ts:81-89`) applies the move blindly.

**B10 — MEDIUM: `canPlay` and `playCards` disagree about playing a 2 on an empty pile → AI proposes illegal moves that stall its turn.**
`canPlay` returns true for 2 on `null` before the empty-pile check (`index.ts:99-104`), but `playCards` rejects it (`index.ts:254-257`: requires rank 3/10/JOKER). Reproduced both directions. The AI picks moves via `canPlay`, so when a 2 is its only "playable" card it emits an illegal play; `tickAI` swallows the error (`SPSinglePlayer.ts:82-83: if (result.error) return s`) and the AI's turn freezes (caller keeps re-ticking the same state).

**B11 — MEDIUM: Blind face-down play has no risk and allows multi-card blind plays.**
A failed blind play just returns an error (`index.ts:258-265`); the player may retry a different face-down card or pick up instead — reproduced: blind 5 on Q errors, then blind K succeeds. Classic/German rule: an illegal blind card forces picking up the pile plus that card. Also, nothing restricts blind plays to a single card (`index.ts:237-241` allows playing all 3 face-down at once if each passes `canPlay`).

**B12 — MEDIUM (deviation): 10 is not "play anytime".**
README table: "10 | **Play anytime** — clears the pile". `canPlay` treats 10 as ordinary rank 7 (`index.ts:65,105`): reproduced `canPlay(10,'J') === false`, `canPlay(10,'A') === false`.

**B13 — MEDIUM (exploit): Picking up an empty pile draws up to 3 cards from stock.**
`index.ts:374-378` tops `collected` up to 3 from stock regardless of pile size or current hand. Reproduced: with an empty pile and a 3-card hand, pickup → hand 6, stock 4→1, and the turn is skipped. Combined with the invented empty-pile opener restriction (A1), players can be *forced* into this, or abuse it to draw.

**B14 — LOW: Engine has no player-count/deck-size guard.**
`initGame` (`index.ts:134-182`) deals `undefined` cards into hands for >6 players (54-card deck); protocol caps at 5 (`protocol.ts:80`) but the engine itself doesn't enforce it.

**B15 — LOW: Unbounded growth of pile and log.**
Cleared entries are never compacted (`index.ts:279-282`; `pickUpPile` keeps cleared entries, `index.ts:368-372`) and `log` accumulates every event — state broadcast to every client on every move grows linearly.

---

## 3. Silent rule inventions & ambiguities (code invented a rule not in the README)

- **A1 — Empty pile may only be opened with 3, 10, or Joker** (`index.ts:100-104`, `254-257`; 2 inconsistently excluded, B10). README says only "play ≥ top of wastepile" and "eldest hand = first player with a 3 face-up" (a *starting-player* rule, not a perpetual opener restriction). In standard Shithead any card may lead.
- **A2 — Starting-player fallback chain** (`index.ts:159-168`): if no 3 is face-up, the engine searches hand *and* face-up for 3,4,5,…,A,2. README specifies only the face-up-3 rule.
- **A3 — Pickup refills collected cards to 3 from stock** (`index.ts:374-378`). README's refill rule applies after *playing* ("draw from stock to refill"), not as a pickup bonus.
- **A4 — Quartet must be played as one 4-card action; pile-top accumulation doesn't burn** (`index.ts:112-117`). Common German variants burn when the top 4 pile cards share a rank even across turns. README's "Quartet (4× same rank)" is ambiguous; the engine silently chose the stricter reading. Wilds excluded from quartets (`index.ts:114`) is also undocumented.
- **A5 — Multi-card sets need not be equal-rank** (absence of a check, `index.ts:258-265`) — the engine silently *dropped* a README rule rather than inventing one.
- **A6 — Blind endgame semantics** (`index.ts:237-247`): free choice of which face-down card, multi-card blind plays allowed, failed blind play = free retry (B11). None of this is documented.
- **A7 — `2` as pure wild with no "reset to lowest" semantics**: anything ≥ −1 follows a 2, which matches "anything can follow", but `RANK_ORDER['2'] = -1` (`index.ts:67`) also means a 2 on the pile makes the pile-top effectively invisible to `getTopCard` consumers.
- **A8 — Out players' cards are revealed to everyone** (`protocol.ts:116-121`: `player.isOut` ⇒ hand/faceDown sent unmasked). Harmless when hands are empty, but it also unmasks face-down cards mid-game for out players — undocumented.
- **A9 — `playDirection` exists (`index.ts:42`) but no card ever reverses direction** — dead mechanic, undocumented.
- **A10 — Global `endgame` phase trigger** (`index.ts:309-314`, `393-398`) flips on *any* player reaching table cards, yet the per-player allowed-zone logic is keyed off hand emptiness — a hybrid model not described anywhere.

---

## 4. Missing edge-case handling

- **Burn while going out** leaves the turn on the out player (B2) — no test or handling.
- **Pickup with a single active player** → infinite loop (B3); no guard for `activePlayers.length <= 1`.
- **Empty-pile pickup** (allowed, draws stock — B13) instead of being rejected as a no-op.
- **Quartet on empty pile**: four 3s open and immediately burn (works, untested); a 4-card mixed set including a 10 on an empty pile burns (A5 side effect, untested).
- **Stock empties mid-refill** (`index.ts:290-294`): hand stays at 1–2 cards — functional, but no test pins the behavior.
- **Phase never reverts**: a player who picks up the pile in `endgame` returns to hand play, but the global phase stays `endgame` (works only accidentally via the hand-length branching at `index.ts:237-241`).
- **Picking up a pile containing Jokers/2s** — no special handling (fine), untested.
- **2-player vs 5-player**: no turn-order tests with out-player skipping (`index.ts:321-323` do/while), no 5-player stock-exhaustion test (5×9=45, stock 9 with jokers).
- **`REARRANGE` with equal indices / repeated swaps** — allowed; no test.
- **Worker trusts engine errors but re-broadcasts state on every message** (`worker/index.ts:390-411, 487-495`); no handling for the hung-loop case (B3) — the DO would block its alarm/queue.

---

## 5. Protocol risks

- **P1 (critical): information leak** — see B4: ids encode rank/suit (`index.ts:77`; `protocol.ts:105`); stock broadcast verbatim (`protocol.ts:112`). Any client can read all hidden cards and the future draw order.
- **P2: no protocol versioning.** No `version` field on any message (`protocol.ts:10-33`); client/worker can drift across deploys with no negotiation or rejection path. `RoomSummary.phase` even admits a client-only value `'waiting'` (`protocol.ts:48`) outside the engine's `Phase` union.
- **P3: no state sequencing/integrity.** `GAME_STATE` carries a full `GameState` with no sequence number, hash, or ack; a late/duplicated message after `RESUME_ROOM` reconnect can silently roll a client back (desync), and there is no client-side resync request.
- **P4: weak `PLAY` validation** (`protocol.ts:87-89`): only `id` presence is checked — no rank/suit shape, no uniqueness (B7), up to 4 arbitrary ids. Extra fields pass through to the engine's `PileEntry`/log, which are then broadcast (minor injection of junk into all clients' state).
- **P5: unbounded trusted payloads elsewhere**: `RESUME_ROOM.playerId` up to 128 chars with no proof-of-possession (`protocol.ts:83-84`) — session hijacking reduces to knowing a playerId (depends on worker issuance; engine-side there is no token at all).
- **P6: rate limiting is only an `ErrorCode`** (`protocol.ts:62`); nothing in the shared layer enforces it (worker's responsibility — flag for the worker audit).

---

## 6. Test gaps (concrete missing scenarios)

Existing suites: `engine.test.ts` (346 lines) and `protocol.test.ts` (91 lines). Coverage is broad but shallow; several tests are **vacuous by construction**:
- Conditional guards skip assertions when the deterministic deal lacks the needed card: `if (three) {…}` (`engine.test.ts:200-216`), `if (ten) {…}` (`engine.test.ts:225-233`), `if (playable) {…} else expect(true).toBe(true)` (`engine.test.ts:242-255`).
- `"rejects illegal play"` asserts only `expect(r.state).toBeDefined()` (`engine.test.ts:213`) — it cannot fail.
- README claims "100% test coverage on game logic" / "100% unit tested" (README:10,30) — not substantiated.

Concrete missing tests:
1. After a 10/Joker/quartet burn, the same player may lead **any** card (would catch B1).
2. Burn with the player's last card(s) in a 3-player game advances to the next active player (B2).
3. `pickUpPile` rejected in `rearrange`/`gameOver`; pickup with one active player terminates (B3/B8).
4. Multi-card plays must be equal rank; `[5,K]` rejected; empty-pile set must be uniform (B5/A5).
5. Duplicate ids in `PLAY` rejected (B7).
6. Face-up locked while hand non-empty / stock non-empty; face-down locked until hand+faceUp empty (B6).
7. Failed blind face-down play forces pickup of pile + card; single-card blind plays only (B11).
8. `canPlay`/`playCards` agreement for 2 on empty pile (B10); decide and pin the empty-pile opener rule (A1).
9. Endgame phase transitions: stock-empty mid-refill, hand→faceUp→faceDown ordering, pickup returning a player to hand play.
10. Game-over: `loserId` set, `GAME_OVER` and `PLAYER_OUT` events emitted exactly once, no further moves accepted.
11. Turn order skips out players in 3/4/5-player games; 2-player immediate game-over.
12. Refill: `DRAW` event count matches cards taken; hand capped by remaining stock.
13. Serialization: hidden ids must not encode rank/suit; `stock` must not be sent; `log` must not leak hidden cards (would catch B4).
14. AI: an AI must be able to complete a full game (regression for B9); AI moves must always be accepted by `playCards` (B10); hard AI quartet/10 thresholds.

---

## 7. AI assessment

- **Fatal strategic flaw (B9)**: hand-only move generation (`index.ts:425`) — never plays face-up or blind face-down cards, so it can never shed its table cards or win; in endgame with an empty pile it emits `pickUp` no-ops forever.
- **Illegal-move generator (B10)**: trusts `canPlay`, which disagrees with `playCards`; errors are swallowed by `tickAI` (`SPSinglePlayer.ts:82-83`), freezing the turn.
- **Never plays sets** (except hard's hand-only quartet, `index.ts:443,459-469`): medium/hard always play exactly one card (`index.ts:436-437,456`), missing the core shedding/tempo mechanic and the hand-refill advantage of playing multiples.
- **Hard "strategy" is threshold folklore**: quartet only when pile ≥ 3 (`index.ts:444`), 10 only when pile ≥ 5 (`index.ts:446-447`), 2 only when *all* playable cards are 2s *and* pile ≥ 4 (`index.ts:449-452` — the second clause makes the first nearly dead code). No awareness of opponent card counts, stock depletion, endgame proximity, or its own face-up cards.
- **Exploitable predictability**: medium/hard deterministically dump the lowest non-special card (`index.ts:434-437,454-456`); a human can time burns/quartets knowing the AI hoards 10s/Jokers until fixed pile sizes and never picks up voluntarily.
- **Easy difficulty uses unseeded `Math.random`** (`index.ts:429`) — fine for play, untestable as written.
- **Performance**: trivially cheap (hand-size scans, one pile reduction); no concerns.

---

## 8. Recommended fixes, ranked by impact

1. **Effective pile top must skip cleared entries** (compact the pile on burn, or filter in `topRank`/`getTopCard`) — fixes B1; add test §6.1.
2. **Fix turn advancement**: after a burn, if the leading player `isOut`, advance to the next active player; add a termination guard in both advance loops — fixes B2, B3; add §6.2/§6.3 tests.
3. **Stop the information leak**: generate opaque card ids (random/uuid), and strip `stock` (and any hidden-card data) in `serializeGameState` — fixes B4/P1; add §6.13 tests. This changes id format — coordinate with any id-dependent client code.
4. **Enforce set rules and id uniqueness in `playCards`** (equal rank for multi-card plays, distinct ids, single-card blind plays) and mirror in `isClientMsg` — fixes B5, B7, part of B11.
5. **Gate card zones by game state**: face-up only when hand empty; face-down only when hand+faceUp empty and stock empty; failed blind play forces pickup (pile + played card) — fixes B6, B11.
6. **Add phase guard to `pickUpPile`** (`play`/`endgame` only) and reject empty-pile pickups; remove or explicitly document the pickup-to-3 stock draw (A3/B13).
7. **Make the AI game-complete**: generate moves from the currently legal zone (hand → face-up → one blind face-down), validate via `playCards` before returning, add set plays — fixes B9; resolves B10's stall.
8. **Reconcile `canPlay` with `playCards`** and decide + document the empty-pile opener rule (A1) and whether 10 is "play anytime" (B12) — update README or code, then pin with tests.
9. **Harden the protocol**: add `version` and per-state `seq`/hash to `GAME_STATE`, require a resume token for `RESUME_ROOM` (P2, P3, P5).
10. **Housekeeping**: compact cleared pile entries and cap/trim `log` (B15); add an engine-side player-count guard (B14); remove or implement `playDirection`, `lobby`/`roundEnd` phases (A9).
