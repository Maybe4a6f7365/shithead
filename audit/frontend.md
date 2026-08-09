# Shithead — Frontend/UX Audit

Auditor: Frontend/UX subagent. Read-only. Production: https://shithead.not4a6f7365.workers.dev
Repo: `/mnt/agents/output/app` (frontend root `/mnt/agents/output/app/app`, source `app/src/`)
Screenshots: `/mnt/agents/output/audit/shots/01-menu.png … 10-mp-guest-waiting2.png`

> **Caveat — deployed build ≠ checked-out source.** The production bundle (`app/assets/index-GOD9SWZU.js`) contains the string `Loading room…` which does not exist in `src/components/MultiplayerGameTable.tsx` (repo has `Joining room…`, line 38). Production appears to be built from a slightly different (likely older) source. Live observations below are from the deployed build; file:line citations are from the checked-out repo.

---

## 1. What exists (component / state / style map)

### Component tree
- `src/main.tsx` (10 lines) — React 18 StrictMode root, imports `styles/index.css`.
- `src/App.tsx` (74 lines) — mode switch `'menu' | 'single' | 'multi-lobby' | 'multi-game'` held in local `useState` (line 15). Menu is a centered cream card on forest background with two buttons (lines 18–46). No router; `/about` and `/leaderboard` are plain `<a href>` (lines 39–41).
- `src/components/Lobby.tsx` (84 lines) — SP lobby: 2–5 players, name inputs, AI/HUMAN toggle, easy/medium/hard `<select>` (lines 43–71), DEAL button (line 78).
- `src/components/GameTable.tsx` (226 lines) — SP table: winner screen (26–40), `RearrangeUI` (154–223), play/endgame layout (53–151). Only file using framer-motion (line 2).
- `src/components/Card.tsx` (224 lines) — pure inline-SVG card renderer. Fixed pixel sizes `sm/md/lg` = 96×144 / 144×216 / 200×300 (lines 23–27). Card back with gold "S" monogram (38–64), pip layouts (73–93), face-card silhouette art (155–187), joker art (135–154), WILD/CLEAR badges for 2 and 10 (202–211).
- `src/components/MultiplayerLobby.tsx` (8 lines, minified-style single-line body) — name input, CREATE NEW ROOM (POST `/api/room/new`), join-by-code (lines 5–8).
- `src/components/MultiplayerGameTable.tsx` (50 lines, minified-style) — all MP screens: Loading, error shell, waiting room, rearrange, game-over, play table (lines 36–50).

### State management
- SP: zustand store `src/sp/SPSinglePlayer.ts` (94 lines) — thin wrapper over the pure engine (`src/engine/index.ts`). `GameTable` subscribes to the **entire** `GameState` object (`useSPGame(s => s.state)`, GameTable.tsx:11), so every state change re-renders the whole table. Errors from the engine are swallowed silently (`if (result.error) return s`, SPSinglePlayer.ts:63,71,83,87).
- MP: `src/net/useMultiplayerRoom.ts` — hook with status `'idle'|'connecting'|'connected'|'disconnected'|'error'` (line 6), room/gameState/playerId in local state. Chat messages are accumulated (lines 56–61) **but never rendered anywhere**.
- WS client `src/net/RoomClient.ts` — auto-reconnect with linear backoff (1s × attempts, max 5, lines 75–81), offline message queue (83–90). When max attempts are exhausted it **silently gives up** — no state surfaces "gave up".

### Styling
- Tailwind v3, `tailwind.config.js` has **empty** `theme.extend` — the whole palette is hardcoded hex (`#2d4a2b`, `#faf8f3`, `#a23a1e`, `#c8a35a`) scattered across every component. `clsx` is a dependency (`package.json`) but **never imported**.
- `styles/index.css` (25 lines): global `user-select: none` (line 13), `touch-action: manipulation` (18), and safe-area utilities `.safe-top`/`.safe-bottom` (23–24) that are **never used** in any component.
- `index.html`: `maximum-scale=1.0, user-scalable=no, viewport-fit=cover`; theme-color `#2d4a2b`.
- Layout everywhere is `min-h-screen` (no `100dvh` / dynamic viewport units anywhere in the codebase).

### PWA
- `vite.config.ts`: `VitePWA` with `registerType: 'autoUpdate'`, manifest: portrait orientation, theme `#2d4a2b`, background `#faf8f3`, icons `icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`.
- **Broken icons**: `public/` contains only `favicon.svg`. Visiting `https://shithead.not4a6f7365.workers.dev/icons/icon-192.png` returns the SPA HTML (worker fallback), not a PNG (observed in browser, tab [^9^]). Install prompt/icon will fail.
- Built bundle: `index-GOD9SWZU.js` 300,709 bytes (~95 KB gzipped), plus a **1.1 MB sourcemap shipped publicly** (`build.sourcemap: true`, vite.config.ts).

---

## 2. Current player journey (screenshot observations)

1. **Menu** (`01-menu.png`): centered cream card, burgundy SHITHEAD wordmark, two full-width buttons. Clean and on-palette, but on desktop it's a small card floating in a void of green; on mobile it works. `Leaderboard · About` links are 10px at 40% opacity.
2. **SP lobby** (`02-sp-lobby.png`): player rows with name input, AI/HUMAN pill, difficulty select, dashed "+ Add Player (3/5)", big DEAL. Functional; no labels on inputs; "×" remove button is a bare text glyph.
3. **Rearrange** (`03-rearrange.png`): instruction text ("Tap a hand card…"), face-up row, hand row, READY TO PLAY. The card art looks genuinely good here — cream cards, burgundy/forest ink, gold crowns. This is the product's identity working.
4. **Table, your turn** (`04-table.png`): status bar (Stock/Pile/Turn), opponent chips (Hans H3 U3 D3, Greta H3 U3 D3), Draw and Pile both showing the **identical card back** (empty pile renders a face-down card, GameTable.tsx:95), player panel with face-up row + hand row visually indistinguishable, PICK UP disabled (empty pile), tiny "YOUR TURN" in gold at the bottom. Large dead vertical gap between pile and player panel.
5. **Mid-game** (`06-after-play2.png`, `07-after-play3.png`): pile top animates in (scale/fade), "+2 under" counter appears. Between two of my screenshots the AIs played 3 turns; there is **no record of what they played** — the pile just changed. No playable-card highlight is visible anywhere (the ring is `#2d4a2b` on a `#2d4a2b` background — literally invisible, contrast 1.0:1). I also attempted to play a face-up `4♥` on an empty pile (turn 1) and got **zero feedback** — the empty-pile "must start with 3/10/Joker" rule (engine/index.ts:100–103) is never communicated.
6. **MP lobby → waiting room** (`08-mp-waiting.png`): create flow shows room code `LPHGPC`, player list with CONNECTED badge. **Observed bug: the room creator sees "Waiting for host to start…" instead of the START GAME button** — a dead end; the room can never start from this client. No copy-code button, no share link, no host badge.
7. **MP join as guest** (`09/10`): second session joining `LPHGPC` sat on a full-screen `♠ … Loading room…` spinner and eventually landed back at the main menu with no error message. (Deployed build behavior; couldn't fully diagnose, but the join journey failed end-to-end in two attempts.)
8. **/about and /leaderboard**: both URLs render the main menu — the links in App.tsx:39–41 are dead ends (no routes exist).
9. **No quit**: once in a single-player game there is no way back to the lobby/menu without finishing the game or reloading the page (GameTable has no exit control; `reset` is only reachable from the winner screen, GameTable.tsx:34).

---

## 3. Preserve list (works well, keep)

- **Card art** (Card.tsx:38–221): inline-SVG woodcut-adjacent faces, pip arrangements, gold "S" card back, WILD/CLEAR badges. Distinctive, on-brief, no assets to load. Seen at its best in `03-rearrange.png`.
- **Palette discipline**: cream/burgundy/forest/gold used consistently; no gradients/glassmorphism clichés in game screens (one `backdrop-blur` on the player panel, GameTable.tsx:103, is the only exception).
- **Rearrange interaction** (GameTable.tsx:166–208): tap-hand → tap-face-up swap is simple, legible, mobile-appropriate.
- **Pile top-card animation** (GameTable.tsx:89–97): AnimatePresence keyed on card id — the one place motion explains state change.
- **Architecture**: pure engine + thin zustand store (SPSinglePlayer.ts) is clean and testable; RoomClient reconnect + message queue (RoomClient.ts:75–90) and session-resume intent (MultiplayerGameTable.tsx:13–26) are the right bones.
- **PWA intent**: portrait orientation, correct theme colors, autoUpdate SW registration (vite.config.ts, index.html).
- **Lobby simplicity** (Lobby.tsx): one screen, no wizard; difficulty select inline.

---

## 4. Weaknesses ranked by player impact

### Critical
1. **Opponents' hands are fully visible and the bottom panel hot-swaps between players.** The player area renders `currentPlayer` — the *turn holder*, not "me" — face-up (GameTable.tsx:104–134: `{currentPlayer.name}`, `currentPlayer.hand.map(<CardView card={c}>)`). On AI turns you see the AI's hand; the whole bottom panel churns identity every 900 ms turn. Multi-human lobbies (Lobby allows >1 HUMAN, Lobby.tsx:50–55) are unplayable-as-intended. *Fix target: pin bottom panel to the local player; show opponents as card-backs.*
2. **Multiplayer cannot start a game (observed).** Room creator saw "Waiting for host to start…" (`08-mp-waiting.png`); the host branch (`playerId === room.hostId ? START_GAME …`, MultiplayerGameTable.tsx:39) never triggered, and a guest join stalled on `Loading room…` then silently returned to menu. MP is effectively broken in production (and the deployed bundle differs from the repo, compounding debugging).
3. **No way to tell whose turn it is among opponents.** The opponent grid blanks out the current turn player (`if (i === currentPlayerIdx) return <div/>`, GameTable.tsx:70) — so chips shown are everyone *except* the active player, and positions shift every turn. The burgundy "current" highlight (`isCur`, line 71–73) is **dead code** (computed after the early return, always false). Confirmed in `04-table.png`: no highlight anywhere.
4. **Playable-card affordance is invisible.** `playable` ring is `ring-[#2d4a2b]` (Card.tsx:33) on the `#2d4a2b` felt — contrast 1.0:1. In shots 04–07 nothing distinguishes playable from unplayable cards; only `cursor:pointer` (useless on touch). Illegal taps fail silently (error swallowed, SPSinglePlayer.ts:63).
5. **MP endgame is unfinishable.** The MP table renders hand and (when hand empty) faceUp, but **never renders face-down cards** (MultiplayerGameTable.tsx:45) — blind endgame plays are impossible. SP does render them (GameTable.tsx:137–143). MP also lacks the draw-pile visual, the "+N under" counter, and any pile animation present in SP.

### High
6. **Desktop-shrunk layout, not mobile-first.** Fixed 144×216 px cards (Card.tsx:25); three across = ~450 px + gaps, so on ≤390 px phones the hand wraps to a 2-row stack (visible even at desktop width in `04-table.png`). No `clamp()`/vw sizing, no fan/overlap layout, `max-w-lg mx-auto` column (GameTable.tsx:54). Face-up row sits *above* the hand, pushing playable cards out of the thumb zone.
7. **AI turns are unreadable.** Fixed 900 ms tick (GameTable.tsx:21); plays appear as an instant pile swap. `state.log` (engine) is never rendered. After three AI plays (shots 05→06) the player cannot reconstruct what happened — no log, no "Hans played 9♥" toast, no card-flight animation.
8. **Empty-pile rule is undiscoverable.** On an empty pile only 3/10/Joker may be played (engine/index.ts:100–103); the UI shows the same card back for "empty pile" as for the draw stock (GameTable.tsx:95) and gives no hint why most cards are dead. First-turn UX guaranteed to confuse (`04-table.png`, my own failed tap).
9. **Multi-card plays unsupported.** Engine supports sets/quartets (isQuartet, engine/index.ts:112–117); UI only ever sends single cards (`playCards(id, [c])`, GameTable.tsx:117,127; MP line 45 `PLAY, cards: [c]`). No selection mechanic in play phase (it exists only in rearrange).
10. **Connection states collapse into dead ends.** Error + disconnected share one screen showing "Reconnecting…" forever (MultiplayerGameTable.tsx:37) while RoomClient gives up silently after 5 tries (RoomClient.ts:77). No attempt counter, no retry button, no connected/reconnecting indicator during the game, no opponent connectivity in-game (only in the waiting room). Loading is a bare `♠` pulse with no cancel (line 49).

### Medium
11. **Winner/loser screen**: only the loser is named, with a shaming 🤡 loop (GameTable.tsx:30–33); no winner celebration, no stats, no rematch in MP (only LEAVE, MultiplayerGameTable.tsx:42). Infinite rotate animation ignores reduced-motion.
12. **Dead navigation**: /about and /leaderboard render the menu (observed); no rules/help anywhere in the product despite a non-obvious ruleset.
13. **Pile/draw ambiguity**: empty pile renders a card back identical to the draw pile (GameTable.tsx:94–95) — two identical red "S" cards side by side (`04-table.png`).
14. **Broken PWA icons** (manifest references missing PNGs; icon URL serves HTML) — install banner/icon will fail.
15. **Deployed build ≠ repo source** — releases not traceable; version.txt/build-meta exist but aren't surfaced in UI (no version/debug info for support).

### Low
16. Minified-style components (MultiplayerLobby.tsx, MultiplayerGameTable.tsx) — 200+-character lines, unmaintainable, inconsistent with the rest of the codebase.
17. GameTable.tsx:5–7 imports `getCurrentPlayer` but never uses it; RearrangeUI's `useStateSafe` import sits at the bottom of the file (line 226).
18. Lobby inputs have no `<label>`; remove-player "×" has no aria-label; AI/HUMAN toggle state conveyed by color alone.
19. Face-up cards are engine-playable while the hand is non-empty (engine/index.ts:237–241 allows hand+faceUp in `play` phase) — a rules deviation classic players will notice (engine-level, surfaced by UI showing face-up row during play).

---

## 5. Mobile-specific gaps

- **No dynamic viewport**: `min-h-screen` everywhere (App.tsx:20, GameTable.tsx:54,159, etc.); zero use of `dvh`/`svh`. Mobile browser chrome will crop/scroll-jump the layout.
- **Safe areas defined but unused**: `.safe-top`/`.safe-bottom` (index.css:23–24) are never applied despite `viewport-fit=cover` (index.html) — notch/home-indicator overlap likely on iPhone.
- **Thumb zone ignored**: playable hand is mid-screen; PICK UP is a small button inline with cards (GameTable.tsx:130); opponent chips are `text-[10px]` (line 73–75). No drag/swipe gestures, no haptics.
- **Hand overflow**: 3×144 px cards + gaps ≥ 460 px → wrap on every common phone width (375–430 px). Cards don't scale, fan, or overlap.
- **Zoom disabled** (`user-scalable=no`, index.html) — hostile on small text (10 px labels).
- **Global `user-select:none`** (index.css:13) also kills text selection in name inputs.
- Portrait-locked manifest but no landscape fallback/rotate hint in-app.

---

## 6. Motion & turn-feel gaps

- framer-motion is used for exactly two things: pile top-card pop (GameTable.tsx:91) and the loser card (30–31). Everything else is instant.
- Missing state-explaining motion: card flight hand→pile, draw stock→hand, pile→hand on pickup, clear-pile (10/quartet) effect, face-down blind-flip reveal, turn-change indicator, deal animation at game start.
- No turn emphasis: no banner, glow, haptic, or sound on your turn; the only cue is 10 px gold "Your turn" text (GameTable.tsx:146–149) at 4.16:1 contrast on small text (below AA 4.5:1).
- AI cadence is a flat 900 ms regardless of action (GameTable.tsx:21) — no pacing difference for pickup vs play vs clear.
- No `prefers-reduced-motion` support anywhere; the loser 🤡 rotates `repeat: Infinity` (GameTable.tsx:31).
- MP table has **zero** animation (no framer-motion import in MultiplayerGameTable.tsx).

## 7. Connection-state UX gaps

- Status union exists (`useMultiplayerRoom.ts:6`) but only 4 of 5 states have distinct UI; `error` and `disconnected` share one shell (MultiplayerGameTable.tsx:37).
- "Reconnecting…" copy is shown even after the client has permanently given up (RoomClient.ts:77) — a lie by omission; no manual retry.
- No in-game connectivity indicator (waiting room shows CONNECTED/OFFLINE per player; the game table shows nothing).
- No feedback while resuming a session (RESUME_ROOM, MultiplayerGameTable.tsx:16–19).
- Chat is wired end-to-end (protocol CHAT, hook stores 50 messages) but has **no UI** — invisible feature.
- Waiting room: no copy/share affordance for the room code, no host crown, no player-count vs max, no kick.
- SESSION_EXPIRED clears stored id silently (useMultiplayerRoom.ts:51–54) — user just lands back in a loading state.

## 8. Accessibility gaps

- **Cards are `<div onClick>`** (Card.tsx:40,96): no `role="button"`, no `tabIndex`, no keyboard handler, no `aria-label` with rank+suit. A screen reader hears "K K" (duplicated corner ranks) with no suit semantics; face-down cards announce nothing.
- **No `aria-live`** regions for turn changes, pile updates, AI actions, errors, or connection status.
- **Contrast failures**: gold `#c8a35a` on forest `#2d4a2b` = **4.16:1** — used for 10 px labels (turn text, "+N under", "thinking…") → fails AA. Forest/40–50 text (footer links, dividers) ≈ 2:1. Playable ring = 1.0:1. (Buttons: cream-on-burgundy 6.26:1 — passes.)
- **No focus-visible styling** anywhere; `:hover` only on two footer links; touch feedback is `active:scale-95` only on buttons, not cards.
- **Touch targets**: opponent chips, "×" remove (Lobby.tsx:68), difficulty `<select>`, "+N under" text all well under 44 px.
- **Zoom disabled** (`user-scalable=no`) and global `user-select:none` — WCAG 1.4.4/1.4.10 issues.
- **No reduced-motion** handling; infinite emoji rotation.
- Color-only state encoding: AI/HUMAN toggle (Lobby.tsx:52), playable ring, ENDGAME badge, CONNECTED badge.
- Emoji as sole iconography (🤖 🎴 🤡 ♠ loader) with no text alternatives.

## 9. Performance notes

- **Whole-state subscription**: `useSPGame(s => s.state)` (GameTable.tsx:11) re-renders the entire table (30+ SVG-heavy cards) on every tick/turn. No `React.memo` on `Card`, no selector granularity, no `useMemo`/`useCallback` in components.
- **Card DOM weight**: each face-up card mounts 3–4 nested SVGs including a per-card `<pattern>` + `<linearGradient>` with unique IDs (Card.tsx:104–110) — grain overlay is invisible at 144 px but costs layout/paint on every render. Face-down cards duplicate a global `id="backPattern"` (Card.tsx:50) across every instance (duplicate DOM IDs).
- **Bundle**: 300.7 KB uncompressed / ~95 KB gz single chunk; framer-motion (~30–40 KB gz) imported app-wide via GameTable for two micro-animations; no route-based code splitting; `clsx` shipped in deps but unused.
- **1.1 MB sourcemap deployed publicly** (vite.config.ts `sourcemap: true`; `index-GOD9SWZU.js.map` live).
- **AI loop**: `setTimeout` re-armed on every state change (GameTable.tsx:17–23) — fine functionally, but coupled to full-table re-render.
- Render cascade in MP: every `GAME_STATE` message replaces the whole `gameState` object → full table re-render (MultiplayerGameTable.tsx:44–45).

## 10. Recommended improvements (ranked)

1. **Pin the table to "me"**: bottom panel always shows the local player; opponents rendered as compact card-back rows with an active-turn ring. Kills the hot-seat leak (Critical #1) and turn-blindness (#3) in one layout change. (GameTable.tsx:68–144)
2. **Make turns loud**: burgundy active-player highlight (fix dead `isCur`), a large "YOUR TURN" state in the thumb zone, aria-live announcements, and a one-line action feed from `state.log` ("Greta played 9♥").
3. **Visible playable affordance**: switch the playable ring to gold `#c8a35a` + slight lift (selected style already does this, Card.tsx:32), dim non-playable cards, and show a hint on illegal tap instead of swallowing errors (SPSinglePlayer.ts:63).
4. **Fix MP start/host flow** and verify deployed build == repo; add a version stamp in the UI. Rebuild the waiting room: host badge, copy-code button, START for host. (MultiplayerGameTable.tsx:39)
5. **Responsive card sizing**: `clamp()`/vw-based card size, overlapping fan for hand, `100dvh` layout, apply the existing safe-area utilities, move hand + PICK UP into the bottom thumb zone.
6. **Explain the table**: distinct empty-pile slot (dashed outline, not a card back), empty-pile start rule hint, multi-select for same-rank plays, face-down blind-play rendering in MP.
7. **Connection honesty**: persistent in-game status pill, attempt counter + manual RETRY after give-up, distinct error vs disconnected screens, cancel button on Loading, render the chat or remove it.
8. **Motion with meaning**: card-flight hand→pile / pile→hand / stock→hand, clear-pile flourish, deal-in animation; respect `prefers-reduced-motion`; slow AI cadence slightly for pickup turns. Consider replacing framer-motion with CSS transitions to cut ~35 KB gz.
9. **A11y pass**: cards as real `<button>` with aria-labels (`"King of clubs, playable"`), focus-visible rings, ≥44 px targets, remove `user-scalable=no`, lift 10 px gold text to ≥12 px or 4.5:1, labels on lobby inputs.
10. **Perf hygiene**: fine-grained zustand selectors + `React.memo(Card)`, drop the invisible grain pattern (or bake one shared pattern), remove `clsx`, disable public sourcemaps, code-split the MP path.
11. **Content**: rules sheet on the menu, real /about & /leaderboard or remove the links, winner screen with winner + rematch, quit-to-menu on the table, fix PWA icons so install works.
