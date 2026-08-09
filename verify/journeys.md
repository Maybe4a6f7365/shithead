# Shithead — QA / Player-Journey Verification Report

**Claim under test:** "the rebuilt game works end-to-end and feels right."
**Result: FALSIFIED — NO-SHIP.** Multiplayer games cannot reach gameOver (endgame soft-lock), and an all-AI hot-seat hard-blanks the app.

## Environment notes (for repro)
- The lead's stated paths (`$HOME/app-integration`, running `:8787`) did not exist. The merged workspace was found at `/mnt/agents/output/app`; no server was running, deps were mid-install by another agent.
- SUT was brought up read-only w.r.t. sources: tree snapshotted to `/tmp/sut` (snapshot verified identical to workspace at capture time), `vite build` → `dist/` (JS 332.96 kB / 105.74 kB gzip; CSS 19.9 kB; sw.js + 15 precache entries), served via `wrangler dev --local` on Node 22.14 (downloaded; system Node is 20 and wrangler 4 refuses it) at `http://localhost:8787` with ROOM Durable Object active.
- Scratch harness: `/tmp/wstest/{lib,journey9,journey10,journey11,engine-game,join-browser-room}.mjs` (ws@8). Browser driven via browser tools + Playwright attached over CDP to the same Chromium (console/pageerror capture).
- Integration was still in flight during verification (files changed under me); snapshot == workspace at 03:20. Re-run after the next merge.

---

## A. Browser, single-device hot-seat

| # | Journey | Verdict | Evidence |
|---|---------|---------|----------|
| A1 | Landing: woodcut identity, no hero, quiet | **PASS** | `shots/a1-landing.png` — forest felt, serif SHITHEAD wordmark, gold rule, 2 CTAs + Rules/About, no hero/gradients/glow |
| A2 | Hot-seat lobby, 3 players (1 human + AI easy + AI hard), names editable | **PASS** | `shots/a2-hotseat-lobby.png`, `a2-lobby-3players.png`; renamed P3 "You/Hans/Greta"; add/remove seat works |
| A3 | Rearrange: tap-swap + READY | **PASS** | `shots/a3-rearrange.png`; "Q marked — tap a face-up card to swap" → "Cards swapped" feedback → READY |
| A4 | Play phase: turn gating, playable ring, PLAY label, invalid feedback, PICK UP 2-tap, feed, opponent strips | **PASS (with notes)** | Hand only interactive on my turn; AI turns advance by themselves. Playable cards = gold ring on cream (`a4-hand-zoom.png`); unplayable 6♦ greyed, no ring vs K♥ top (`a5-hand-zoom.png`) — clearly distinguishable, not forest-on-forest. Select → PLAY appears; label is `Play` / `Play N×` (count only for N>1, per ActionBar source). PICK UP first tap → flash "Pick up anyway? — tap again" + label → "TAP AGAIN TO CONFIRM" (3 s window); second tap executes (verified via Playwright fast double-tap; single tool clicks were too slow to catch the 3 s arm). OpponentStrip: burgundy mini back + hand **count**, public face-up minis, face-down strips, gold under-bar turn marker, offline flag (`a15-mp-played.png`). Notes: no invalid-move toast observed because unplayable cards can't be selected (selection-gated) — acceptable design. |
| A5 | Full game / no stalls ≥30 turns, AI self-advance | **PARTIAL** | AI turns advanced automatically every time (900 ms tick). Human+2AI game played several rounds cleanly. 3-player WS game ran 57–60 turns stall-free until D1 struck; engine-only 3-AI game ran to completion (66 actions, gameOver, loser set, 15 burns, 6 blind plays, 5 pickups, out-skipping verified — `engine-game.mjs` 7/7). **All-AI browser game is broken (D2), so browser-native full completion not observed.** |
| A6 | Reload mid-game | **PASS (graceful) + LOW defect** | Hot-seat reload → clean landing screen, no broken UI, but game state is silently lost (no SP persistence; MP uses localStorage session, SP nothing) — D5 |
| A7 | Zero unexpected console errors | **FAIL** | Every load logs: `Loading the stylesheet 'https://fonts.googleapis.com/css2?family=Fraunces…' violates CSP directive "style-src 'self' 'unsafe-inline'"` + network `requestfailed … csp`. Font never loads → Fraunces design typography silently falls back — D3. No other console/page errors across ~25 min of driving (incl. React runtime). |
| A8 | Rules sheet; game-over overlay | **PASS / PASS-by-wiring** | Rules sheet complete (goal/setup/turns/specials: 2 reset, 10 burn, quartet, joker, blind flip) — `a9-rules.png`. GameOverOverlay correctly wired in GameTable (`result win/lose`, shithead name, rematch/leave) and engine gameOver verified; visually observed only in engine, not in browser (blocked by D1/D2). |

## B. Multiplayer (node WS against worker)

| # | Journey | Verdict | Evidence |
|---|---------|---------|----------|
| B9 | Full journey: alloc → create → join → start → rearrange/READY → plays → PICK_UP → chat → host disconnect+resume → burn → sync | **PASS (24/24 checks)** | `journey9.mjs`: room `WREGBP`; REARRANGE seq=1; READY→play; out-of-turn PLAY rejected ("Not your turn"); guest START_GAME rejected NOT_HOST; chat relayed both ways; PICK_UP and CLEAR_PILE (burn) observed; host closed socket → RESUME_ROOM with token → same seat, token **rotated**, old token replay → `RESUME_FAILED invalid_token`; final states identical (seq 5/5, turnCount 3/3); per-client seq non-decreasing (duplicate seqs exist by design — READY broadcasts unchanged state; protocol documents client-side dedupe) |
| B10 | Garbage token, bad code, adversarial inputs | **PASS (13/13)** | `journey10.mjs`: join nonexistent code → `INVALID_CODE "Room not found"`; CREATE on unallocated code → `INVALID_CODE` (claim required); garbage token → `RESUME_FAILED invalid_token`, no session attached; unknown playerId → `not_a_member`; full room → `ROOM_FULL`; WS with `Origin: https://evil.example.com` → 403; WS without Origin → 403; malformed JSON & unknown type → clean ERROR; wrong `version` → specific version ERROR; 40-msg burst → `RATE_LIMITED`; legit resume still works afterwards |
| B11 | 3-player rotation + out-skip + completion | **FAIL — D1** | `journey11.mjs` (3 runs): cyclic rotation correct over 57/60/46 turns (0 violations after accounting for post-burn leads); **every run soft-locked the moment the first player reached the face-down zone**: `PLAY` of the player's own face-down card → `INVALID_MOVE "Card is not owned by this player"`. No gameOver, no out-players, game unrecoverable |
| B-Interop | Browser host ↔ WS guest | **PASS** | Browser created room QHGKAD; node guest joined, saw deal (`9♠ 2♠ 5♣`); host START_GAME → both rearrange; both READY → play; browser played 6♠, draw refill worked, turn passed (`a12/a13/a15`) |

## C. Cross-checks

| # | Check | Verdict | Evidence |
|---|-------|---------|----------|
| C12 | Hidden information | **PASS** | Every captured GAME_STATE audited (`auditHidden` in all runs, incl. rearrange + deep play): stock and opponent hands are constant `{rank:'3', suit:null, id:'hidden:…'}`; face-down masked for everyone incl. owner until gameOver; zero leaks in 100+ states. (Side effect: masking is what breaks blind play — D1.) |
| C13 | Reduced motion | **PARTIAL** | CSS: `@media (prefers-reduced-motion: reduce)` present (3 blocks, styles/index.css:110,244,270 — transforms → crossfades, loops stop). JS: framer-motion used in ActionFeed, GameOverOverlay, PileArea, RulesSheet with **zero** `useReducedMotion` gating — those animations play regardless — D7 |
| C14 | Bundle/perf smoke | **PASS** | `/` 200 in 13 ms (1,310 B); JS bundle `/assets/index-n_Lqyvu3.js` 333,058 B (105.7 kB gzip); CSS 19.9 kB; `/sw.js` 200 (workbox, 15 precache entries, 365 KiB); manifest 200 + all 3 icons 200; favicon/apple-touch-icon 200 |

---

## Defects (severity-ranked)

### D1 — CRITICAL: Multiplayer can never finish — blind face-down play rejected by the server (endgame soft-lock)
- **Repro:** any MP game driven to the point where a player's only remaining cards are face-down. 3/3 scripted 3-player runs stalled at turns 46–60: current player sends `PLAY {cards:[{id:'hidden:<ownId>:down:0', rank:'3', suit:null}]}` — the only ids the client has ever seen for its own face-down cards — server answers `INVALID_MOVE "Card is not owned by this player"`. Turn never advances; room lives 24 h.
- **Root cause (code):** `protocol.ts serializeGameState` masks face-down cards for *everyone including the owner* with synthetic `hidden:` ids; `worker/index.ts canonicalCards()` only accepts *real* card ids from server state. The browser client (`TableScreen` onFaceDownId) sends the masked id, so browser MP hits the same wall. Engine itself handles blind plays correctly (verified: 6 blind plays in engine game) — the bug is in the worker/serialization contract.
- **Fix direction:** resolve `hidden:<pid>:down:<i>` ids server-side to the player's i-th face-down card, or stop masking *own* face-down ids (position-stable ids without rank/suit).

### D2 — HIGH: All-AI hot-seat → permanent blank screen
- **Repro:** Pass & play → set every player to AI → Deal. 3/3 repros (2- and 3-player). `#root` empties; zero console errors; no recovery without reload.
- **Root cause:** `SPSinglePlayer.initGame` pre-marks all AI as ready; `GameTable`'s auto-ready effect then has nobody to ready, so `endRearrange`/`startPlay` never run → phase stuck in `rearrange`; rearrange branch finds no `next` player and `TableScreen` only renders in play/endgame/gameOver → renders nothing.
- **Fix direction:** either disallow 0 humans in the lobby, or make the auto-ready effect/startPlay handle the all-AI case (and then the viewer pinning needs an all-AI spectator path).

### D3 — MEDIUM: CSP blocks the Google Fonts stylesheet (console error on every page; design font never loads)
- `index.html` links `fonts.googleapis.com/css2?family=Fraunces…`; worker CSP is `style-src 'self' 'unsafe-inline'`. Blocked at runtime (Playwright `requestfailed: csp`). Fraunces falls back to generic serif — the woodcut typographic identity is silently degraded in production. Self-host the font or allow the origin.

### D4 — MEDIUM: A disconnected multiplayer player blocks the game forever
- Verified: WS guest went offline mid-game; browser host sits at "WsGuest's turn … offline" indefinitely. No turn timer, no forfeit, no AI takeover; only the 24 h room TTL cleans up.

### D5 — LOW: Hot-seat game state does not survive reload
- Reload mid-game → landing screen, game silently gone (MP persists a session; SP persists nothing). Graceful but lossy.

### D6 — LOW: No rejoin affordance after MP refresh
- Resume itself works E2E (verified in browser: refresh → landing → Play online → re-enter code → `RESUME_ROOM` restores seat/hand/turn — `a14-resume-after-refresh.png`), but the user must remember and manually re-enter the 6-char code; landing shows no "Rejoin ABCDEF" prompt. Undiscoverable.

### D7 — LOW: framer-motion animations ignore reduced-motion
- CSS media queries cover CSS animations; JS-driven motion (pile fly, game-over overlay, feed) has no `useReducedMotion` gate.

### Info (not defects)
- PLAY label shows count only for N>1 (`Play 2×`) — matches the component's design comment.
- Manifest icons are very small (2.5–7.5 kB PNGs) but valid and 200.
- Duplicate-seq GAME_STATE broadcasts exist (e.g., first READY rebroadcasts unchanged state); protocol documents client-side dedupe — clients must implement it (the app's `useMultiplayerRoom` does, per seq guard).

---

## Verdict: **NO-SHIP**

The engine, protocol hardening, hidden-info masking, resume-token security, rate limiting, origin checks, hot-seat interaction design, and visual language are all in good shape (journeys A1–A4, B9, B10, C12, C14 pass convincingly). But D1 means the flagship online mode can literally never produce a Shithead, and D2 blanks the app on a lobby configuration the UI itself offers. Fix D1 + D2 (and cheaply D3) → re-verify → likely SHIP-WITH-FIXES (D4–D7).
