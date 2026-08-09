# SHITHEAD — Senior Design+Code Review (integration branch, ae5e230)

Reviewer: independent design+code review of the merged engine / worker / infra / UI rebuild.
Method: full read of diff (`main...integration`, 72 files, +8,630/−1,884), line-by-line read of
engine, worker, protocol, net layer and all new components, plus **live verification**:
121/121 vitest tests pass, 20/20 adversarial worker checks pass against `wrangler dev`
(Node 22), production build succeeds (typecheck + vite), asset/CSP/SPA-fallback behavior
curl-verified, and both suspected multiplayer defects **reproduced live over WebSocket**.

---

## FINDINGS (severity-ranked)

### BLOCKER

**B1 — Multiplayer REMATCH is broken: the server rejects the exact message the UI sends.**
- `app/src/worker/index.ts:475-478` — `startGame()` returns `ERROR INTERNAL "Game already
  started"` whenever `data.state` is non-null, with no `gameOver` exception.
- `app/src/components/MultiplayerGameTable.tsx:196-199` — the host's REMATCH button sends
  `{type:'START_GAME'}`.
- Reproduced live: after one `START_GAME`, a second one returns
  `{"type":"ERROR","code":"INTERNAL","message":"Game already started"}`.
- User impact: after any finished MP round, the host taps REMATCH → `INTERNAL` maps to
  `server-error` (`useMultiplayerRoom.ts:217-218`) → full-screen "Something went wrong —
  It's us, not you." The room is effectively single-round. (Ironically the client-side seq
  guard already anticipates rematch — `shouldAcceptGameState` accepts a seq-0 rearrange
  restart, `useMultiplayerRoom.ts:71-77` — but the server never produces one.)
- Fix: in `startGame`, allow re-init when `data.state?.phase === 'gameOver'` (reset
  `readyPlayerIds`, keep players/host); add an adversarial test "T20: START_GAME after
  gameOver deals a fresh round".

**B2 — Multiplayer blind face-down endgame is unplayable: masked card ids can never be played.**
- `app/src/engine/protocol.ts:184-186` — `serializeGameState` replaces **even the owner's**
  face-down cards with synthetic per-viewer ids (`hidden:<pid>:down:<i>`), rank `'3'`,
  suit `null` ("blind is blind").
- `app/src/worker/index.ts:516-528` (`canonicalCards`) and `app/src/engine/index.ts`
  (`playCards` ownership re-derivation) both require the *real* server-side ids.
- Reproduced live: `PLAY` with the masked face-down id the client actually renders →
  `ERROR INVALID_MOVE "Card is not owned by this player"`.
- User impact: when an MP player reaches the face-down zone, every blind play is rejected
  with a confusing feed error; the only working action is PICK UP. Games degenerate into
  forced pickups until the 1000-action stalemate cap. A core endgame mechanic is dead in MP.
  No test covers a blind play over the wire (T8–T11 stop at hand-zone plays).
- Fix (safe): keep the **real id** on the owner's face-down cards while still masking
  rank/suit — ids are opaque 62-bit random tokens (`makeCardId`, engine/index.ts:150-158)
  so identity leaks nothing. Alternative: resolve `hidden:<pid>:down:<i>` positionally in
  `canonicalCards`. Add a wire-level blind-play test.

### MAJOR

**M1 — Production CSP blocks the Fraunces display font; design typography silently dies in prod.**
- `app/index.html:10-12` loads Fraunces from `fonts.googleapis.com` / `fonts.gstatic.com`.
- `app/src/worker/index.ts:678-683` CSP (verified live on `/`):
  `style-src 'self' 'unsafe-inline'` (blocks the Google stylesheet) and no `font-src`
  (falls back to `default-src 'self'`, blocks the font files). Confirmed the built
  `dist/index.html` still contains the Google URLs.
- Impact: in production every display use (wordmark, room code, overlay titles) falls back
  to Georgia and the browser logs CSP violations — directly violates DESIGN.md §2.2
  ("one **self-hosted** WOFF2, 600, latin, ≤28 KB, `font-display: swap`, preloaded") and
  DoD "no obvious console errors". Dev looks fine, prod doesn't — classic trap.
- Fix: self-host `Fraunces-600-latin.woff2` under `app/public/fonts/`, add `@font-face` +
  `<link rel="preload">`, delete the Google links.

**M2 — Late joiner mid-match gets "Something went wrong" instead of §7.3's "Game in progress".**
- `app/src/worker/index.ts:411-414` — `joinRoom` rejects mid-game joins with
  `ERROR INTERNAL "Game already started"` (reproduced live).
- `app/src/net/useMultiplayerRoom.ts:216-218` maps `INTERNAL` → full-screen server-error
  panel "It's us, not you." — factually wrong and scary.
- The correct panel **exists but is unreachable dead code**:
  `MultiplayerGameTable.tsx:166-170` ("Game in progress / You'll be in next round") only
  renders when a GAME_STATE exists without the player — which can no longer happen.
- Fix: emit a dedicated code (e.g. `GAME_IN_PROGRESS`) from the worker and map it to the
  in-progress panel; or implement the specced spectate-and-wait behavior.

**M3 — MP server rejections stick in the ActionFeed forever.**
- `useMultiplayerRoom.ts:225` sets `notice` on `INVALID_MOVE`/`NOT_HOST`/`RATE_LIMITED`;
  `clearNotice` (line 292) is exported but **never called** —
  `MultiplayerGameTable.tsx:180` passes `error={notice}` and nothing clears it.
- `TableScreen.tsx:113-122` prioritizes `error` over the event feed with no timeout,
  unlike local errors which auto-expire after 3 s (`explain()`, line 167-176; DESIGN §4.2
  mandates 3 s). A single rejected tap poisons the feed for the rest of the session,
  masking real game events.
- Fix: clear `notice` on the next accepted GAME_STATE and/or after 3 s.

**M4 — §5 motion table is only ~half implemented; most state-explaining motion is missing.**
Missing entirely (grep: framer-motion used only in `PileArea`, `ActionFeed`,
`GameOverOverlay`, `RulesSheet`; no transitions in `OpponentStrip`, `HandFan`,
`TableauWell`):
- Deal (180 ms + 60 ms stagger), Draw (220 ms + fan re-space 180 ms — fan re-spacing is
  instant, `HandFan.tsx` margins are not transitioned)
- Play flight hand→pile along shallow arc, peak −24 px (all plays currently get a generic
  28 px rise at the pile, `PileArea.tsx:56-60`)
- Opponent play flight from their **seat** (§5 row 7)
- Pickup pile→hand collapse with "+N" tick (§5 row 9)
- Turn change: 300 ms gold-bar slide under the new seat / one-time slide under your seat
  (§4.1, §5 row 10 — the marker currently snaps, `OpponentStrip.tsx:73-77`)
- Special-2 gold ring pulse (§5 row 11), blind Y-flip (§5 row 13)
- Player joined/left seat fade-slide (§5 last row)
Brief §10: "Motion is part of the game logic… the player should understand what happened
without reading a log." Currently the log (feed) is doing that work.
- Fix: implement the missing rows (all are FLIP-able with the existing framer-motion dep)
  or consciously de-scope them in the spec.

**M5 — Landscape/desktop §3.4–3.5 not implemented; portrait lock kept against explicit spec.**
- `app/vite.config.ts:19` — manifest still `"orientation": "portrait"` (built
  `dist/manifest.webmanifest` confirms); §3.4 explicitly says "remove `portrait`".
  The header comment (line 7) still reads "portrait-locked, no zoom" — stale on both counts.
- No vertical left-rail OpponentStrip (96 px), no <400 px-height compression (ActionBar
  40 px, feed hidden, minis 0.36×), no hover-rise for playable cards (§3.5). Only the
  `--card-w` media query (`index.css:106`) was implemented.
- Fix: remove the orientation lock and either build §3.4/§3.5 or mark them de-scoped.

### MINOR

**m1 — Room-code claim is not bound to the claimant.** `worker/index.ts:152-166` claims a
code for 2 min; any client that opens the WS and sends `CREATE_ROOM` first consumes it
(`worker/index.ts:345-365`). A griefer can squat a just-allocated code (~28-bit space, so
targeted, low-probability). Fix: return a single-use nonce from `/api/room/new` and require
it in `CREATE_ROOM`.

**m2 — Idle un-joined sockets count toward the room socket cap.** `worker/index.ts:181-184`
caps at 12 sessions including sockets that never joined; anyone with the room code can
brick the room with 12 idle connections. Fix: apply the cap to joined players (5) plus a
smaller pre-join allowance, or close sockets that don't join within N seconds.

**m3 — SPA fallback returns 200 HTML for missing asset paths.** `worker/index.ts:812-818`:
`GET /assets/typo.js` or `/favicon.ico` → 200 `text/html` (verified live). Poisons caches
and hides real 404s. Fix: only fall back for paths without a file extension (or not under
`/assets/`).

**m4 — Client never sends the protocol `version` field.** All messages in
`useMultiplayerRoom.ts:117-133, 263-271` omit `version`; the headline "protocol v2
enforcement" (`worker/index.ts:248-257`) therefore never exercises the real client path.
Fix: include `version: PROTOCOL_VERSION` on every client message.

**m5 — "Roving tabindex" is claimed but not implemented; §6.5 keyboard spec partially met.**
`HandFan.tsx:5` comment says roving tabindex; the code only handles ←/→ focus movement and
leaves every card in the tab order. ↑/↓ row navigation (hand ↔ tableau) is absent, and DOM
tab order deviates from §6.5 (Menu precedes pile; ActionBar precedes hand). Fix: implement
roving tabindex + ↑/↓, or correct the comment/spec.

**m6 — §7.6 name default not honored online.** `JoinCreateScreen.tsx:33-35, 46-48` blocks
with "Enter your name first." instead of defaulting to "Player N" (the hot-seat lobby does
default, `HotSeatLobby.tsx:27`). Small spec deviation; pick one behavior.

**m7 — DESIGN.md still teaches the removed empty-pile rule.** §4.2/§4.5 specify the
"3 · 10 · Joker" hint, but engine D1 (`engine/index.ts:8-12`) deliberately allows any card
to lead; the shipped UI (`PileArea.tsx:84-93` "any card leads") and RulesSheet correctly
follow the engine. The spec doc is now wrong and will mislead the next implementer.
Fix: update DESIGN.md to D1.

### NIT

- n1 `engine/index.ts:121` `MAX_PLAYERS = 6` vs 5 in protocol validation, worker clamp and
  UI — align or comment.
- n2 `engine/index.ts:74` — `Phase 'roundEnd'` is never produced; dead union member.
- n3 CHAT is a live worker/protocol path (`worker/index.ts:304-306, 576-581`,
  `protocol.ts`) with zero UI — dead surface (and brief §21 frowns on chat); remove or wire.
- n4 `Card.tsx:268-279` WILD/CLEAR mini-badges are not in the spec's state system
  ("unnecessary badges", brief §4); defensible as rules teaching — decide consciously.
- n5 `soundManager.ts:17-19` — the Sound toggle persists a boolean driving a no-op handler.
  Sanctioned by §8 ("wire later") but is a visible control with no audible effect (brief
  §13 "no placeholder interactions"); consider a minimal Web-Audio synth or hiding the
  toggle until assets ship.
- n6 `WaitingRoom.tsx:73` "Copied ✓" — §4.3 says success on panels is text, no icons.
- n7 `worker/index.ts:134-136` — DO constructor schedules alarm `now + ROOM_TTL_MS`
  regardless of stored `lastActivity`; zombie rooms can live ~2× TTL.
- n8 `OpponentStrip.tsx:94` — seat gaps are `s2` for all counts; §3.3 specifies `s4` gaps
  for 3–4 players.
- n9 `TableauWell.tsx:57` — "Tableau clear" is a persistent element the spec doesn't define
  for Z3 (and it appears exactly when the player is about to go out — noise at the climax).
- n10 `LandingScreen.tsx:10` — version stamp falls back to hardcoded `'v0.2.0'`; read it
  from package.json/build meta instead.
- n11 `OpponentStrip.tsx:68` — out players get line-through/opacity treatment the spec
  doesn't define (spec defines only the offline state). Harmless; note for spec update.
- n12 `LandingScreen.tsx:9` — `document.querySelector` executed during render (impure);
  move to `useMemo`/module scope.

---

## PER-DIMENSION VERDICTS

**1. Design fidelity — GOOD with two real gaps.** Tokens port 1:1 (tailwind.config.js ↔
TOKENS.css ↔ index.css — values verified identical, incl. all 14 colors, shadows, rings,
easings, durations, z-scale). Card geometry 5:7 / `clamp(56px,21vw,96px)` / fan step
24–28 px / state table / dashed empty slot / turn marker / badge-as-retry / second-tap
PICK UP guard / pass-and-play gating / waiting-room host branch (`hostId === myPlayerId`,
regression-tested) / game-over overlays / connection states: all present and correct.
Deviations: Fraunces blocked in prod + not self-hosted (M1); half the §5 motion table
missing (M4); landscape/desktop §3.4–3.5 missing + portrait lock kept (M5); DESIGN.md
itself stale on the empty-pile rule (m7); justified deviation: the empty-pile hint was
reworded to "any card leads" to match engine D1 — correct call, doc not updated.

**2. Anti-AI-UI compliance — PASS.** Zero `backdrop-blur`, zero gradients, zero glow, zero
`text-shadow`/`drop-shadow`, no pills (the only `rounded-full` are the spec's 8 px badge
dot and 2 px turn bar), no cards-in-cards (flat tint hierarchy only), no emoji-as-UI, no
hero sections, no fake stats (Leaderboard removed, About dialog is real). Shadows exist
only on cards per §2.4. Clean.

**3. Rules correctness — PASS.** D1–D11 are explicit, documented in the header, and each
is test-pinned (`rules.test.ts`, 32 tests). Cross-check vs README German variant: D1 (any
card leads empty pile) is a defensible reading of "≥ top of wastepile" and removes a
self-contradictory invention; D7 blind-play penalty (whole pile + revealed card, turn
passes) is the classic German rule — reasonable; D4 strict quartet is an explicitly
flagged stricter reading; D8/D9 match README; MAX_GAME_TURNS=1000 is documented as a house
rule with stalemate evidence (~88% of AI games finish under half the cap) and is
implemented + tested sanely (most-cards loses). No silent inventions found.

**4. Security posture — STRONG; audit fixes verified landed.** Resume tokens: 256-bit,
SHA-256 hash at rest, rotation on resume, genuinely constant-time compare (fixed-length
hashes; `worker/index.ts:110-114`), destroyed on LEAVE — all verified live (T1–T5, T12).
Per-viewer serialization leaks nothing (T8 + code read; hidden ids uncorrelatable). Headers
verified live: exact CSP, nosniff, frame-ancestors 'none', COOP, Referrer-Policy, no ACAO
*, disallowed Origin → 403 (T16–T17). Rate limits verified live: claim-gated room creation
(T18), 10/min per IP (T19), 12-socket cap (T13), 16 KiB message cap → 1009 (T14), 20 msg/s
(T15). Claim flow closes the TOCTOU via DO transaction. `run_worker_first = true` asset
handling verified for `/`, deep SPA routes, real assets (all 200 correct) — with the
missing-asset caveat (m3). New issues found: B2 (masked-id play rejection — functional,
not exploitable), m1/m2 (claim binding, idle-socket squatting). No new exploitable bugs.

**5. Mobile-first reality — GOOD.** `100dvh`(+fallbacks), safe-area insets incl.
`max(env(),8px)` bottom, no `min-h-screen`, no `user-scalable=no`, `viewport-fit=cover`,
`touch-action: manipulation`, `user-select` scoped to table, card clamp formula exact,
fan step 24–28 px with horizontal scroll fallback, ActionBar in thumb zone, targets ≥44 px
(badge 44×32 per spec), 5-player strip fits 320 px (296 px). One-handed 320 px play is
credible. Gap: landscape mode is locked out rather than adapted (M5).

**6. Accessibility — GOOD with one false claim.** Real `<button>` cards with state-ful
aria-labels, `aria-live` polite+assertive regions with 1/s merge collapsing, focus-visible
gold ring with offset, contrast tokens all ≥ spec, keyboard P/U/Esc + ←/→ + native
Enter/Space, reduced-motion fallbacks implemented (durations → 150 ms crossfade,
shake/pulse removed). Gaps: roving tabindex absent despite the comment claiming it (m5);
↑/↓ row nav missing; tab order deviates from §6.5.

**7. Performance — GOOD.** JS bundle **333,058 B raw / ~105.7 kB gzip** (`index-n_Lqyvu3.js`),
CSS 19.9 kB (5.4 kB gzip); precache 15 entries / 364.8 KiB; sourcemaps absent from dist
(verified); zero new runtime deps (framer-motion/zustand pre-existing); `Card` memoized
with a ref-routed handler contract so unchanged cards skip render; zustand selectors used
per-field in `GameTable` (whole-`state` subscription is acceptable — state is immutable
per action). Typecheck + build pass cleanly.

**8. Definition of Done (§24).** Met (verified): rules correct; tests pass (121 + 20);
build succeeds; security boundaries; no obvious dead placeholder UI. Not met: MP rematch
(B1), MP blind endgame (B2), MP error feed hygiene (M3), late-join state (M2), motion
communicates state (M4), production console cleanliness (M1). Unverifiable from code:
Cloudflare production deploy + production playtest (prod origin was unreachable from the
review sandbox; the CI `production-smoke` job on main is the right gate and is well-built).

**9. Left-behind junk — CLEAN.** Old `Lobby.tsx`/`MultiplayerLobby.tsx` deleted, no dangling
imports, frozen `sw.js`/`version.txt` removed, zero TODO/FIXME, no console.log outside the
worker's structured logger, no commented-out code. Residual dead code: `roundEnd` phase
member, CHAT protocol path (n2/n3), unreachable "Game in progress" branch (M2), stale
vite.config comment (M5).

---

## OVERALL VERDICT: **NO-SHIP** (until B1, B2, M1 land)

The engine, the security posture, the token discipline and the anti-AI-UI compliance are
genuinely excellent — this is close. But two multiplayer journeys are broken end-to-end
(rematch; the entire blind endgame — the mechanic the game is *named* for), and the
production CSP silently kills the design language's only font. All three have precise,
small fixes above. After those, re-review M2–M5 for a SHIP-WITH-FIXES call; the MINOR/NIT
tail can ride along.

Finding counts: **BLOCKER 2 · MAJOR 5 · MINOR 7 · NIT 12**
