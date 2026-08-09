# Shithead Multiplayer — Backend & Security Audit

Scope: Cloudflare Worker + Durable Object backend, protocol, client net layer.
All paths relative to `/mnt/agents/output/app`. Primary files:
- `app/src/worker/index.ts` (Worker entry + `Room` Durable Object)
- `app/src/engine/protocol.ts` (wire format + `isClientMsg` validator + state serializer)
- `app/src/engine/index.ts` (pure game rules used server-side)
- `app/src/net/RoomClient.ts`, `app/src/net/useMultiplayerRoom.ts`, `app/src/components/MultiplayerGameTable.tsx`
- `app/wrangler.toml` (root `wrangler.toml` mirrors it)

Note: live production (`https://shithead.not4a6f7365.workers.dev`) was unreachable from this sandbox (network blocked); all findings are from static analysis. No worker tests exist (`app/src/worker/` contains only `index.ts` and `build-meta.ts`; tests only cover the pure engine).

---

## 1. Architecture map

- **Routing** (`worker/index.ts:522-568`): single Worker. `/api/health`, `/api/version` → JSON; `POST /api/room/new` → generates 6-char code, probes the DO via `/internal/status`, returns `{roomId}`; `/api/room/:code/ws` → forwards the raw request (with WS upgrade) to the `Room` DO keyed by `idFromName(code)`; everything else → static assets binding with SPA fallback to `/index.html` (`:562-564`).
- **Room DO** (`worker/index.ts:63-504`): one DO instance per room code. State (`RoomData`: players, `GameState`, host, ready set) kept in-memory and persisted to **DO SQLite storage** under key `'room'` after every mutating action (`save()`, `:218-227`). Alarm-based cleanup deletes the room after 24h idle with zero sessions (`:112-124`). No hibernation API — uses `server.accept()` (`:138`), so the DO is held resident (and billed) while sockets are open.
- **Message pipeline**: each WS message is funneled through a per-DO promise chain `this.operation` (`:139-147`), so all message handlers are fully serialized per room (good for races). Per-session rate limit: 20 msg/s sliding window (`:37`, `:210-216`). Payloads validated by `isClientMsg` (`protocol.ts:73-101`).
- **Sessions**: `Map<sessionId, {webSocket, playerId, recentMessages}>` (`:12-16`, `:64`). `playerId` (a server-generated UUID, `makePlayer` `:51-61`) is the **only** session credential; it is stored client-side in `sessionStorage` (`useMultiplayerRoom.ts:41`) and replayed via `RESUME_ROOM` to reclaim a seat (`resumeRoom`, `:302-318`).
- **Broadcast**: `broadcastGame()` sends each session a viewer-specific `GAME_STATE` via `serializeGameState` (`:484-495`, `protocol.ts:111-124`); lobby state via `ROOM_STATE` (`:480-482`). Errors are generic strings; no stack leakage.

---

## 2. Server-authority verification (per requirement)

| Requirement | Status | Evidence |
|---|---|---|
| Turn ownership | **Enforced** | `playCards` checks `state.players[state.currentPlayerIdx].id === playerId` (`engine/index.ts:220-223`); `pickUpPile` same (`:360-363`). |
| Legal moves (rank vs pile) | **Enforced** | `canPlay`/empty-pile rule (`engine/index.ts:249-265`). |
| Legal moves (same-rank sets) | **NOT enforced** | No check that multi-card plays share a rank (`engine/index.ts:216-265`). See V3. |
| Card ownership | **Enforced (well)** | `canonicalCards` re-derives cards from server state by ID, rejects duplicates/foreign IDs (`worker/index.ts:366-378`); forged suits/ranks from client are discarded. |
| Phase gating for PLAY | **Enforced** | `engine/index.ts:217-219`. |
| Phase gating for PICK_UP | **NOT enforced** | `pickUpPile` has **no phase check at all** (`engine/index.ts:359-412`); server handler only checks state exists (`worker/index.ts:401-404`). See V1/V2. |
| Deck/pile/player state | Partially | Server holds authoritative state, but leaks full `stock` order to every client. See V4. |
| Match progression / start | **Enforced** | Host-only start (`worker/index.ts:322`), ≥2 players (`:330`), no double start (`:326`). |
| Ready/rearrange | **Enforced** | Phase-gated (`:346`, `:358`; engine `:185`, `:203`). |
| Win/loss | **Enforced** | `isOut`/`loserId` computed server-side only (`engine/index.ts:298-333`). |
| Room access | Partially | 6-char code from 32-char alphabet (~2^30) is unguessable, but **seat takeover is trivially possible in-room**. See V5. |
| Duplicate/replayed messages | Mostly enforced | Replayed PLAY fails ownership/turn checks; READY idempotent (`:348`); messages serialized (`:140-141`). No idempotency keys, but reducers make replays self-neutralizing. |
| Input validation | Enforced | `isClientMsg` bounds all string lengths, array sizes, index types (`protocol.ts:73-101`). |

---

## 3. Concrete vulnerabilities (severity-ranked)

### V1 — CRITICAL: Free card draws via PICK_UP on an empty pile (game-integrity cheat)
`pickUpPile` (`engine/index.ts:359-378`) never checks that the pile contains anything. With an empty pile, `collected` stays empty, then `while (collected.length < 3 && stock.length > 0)` (`:376-378`) **draws 3 cards from the stock into the caller's hand for free**, and advances the turn.
**Scenario:** it's your turn, pile is empty (game start, or right after you clear the pile with a 10 — clearing gives you another turn, `engine/index.ts:316-325`). Send `{"type":"PICK_UP"}` repeatedly: each call deals you 3 fresh cards off the stock. The legitimate client hides this (button disabled when pile empty, `MultiplayerGameTable.tsx:45`), but the server accepts it. Drains the stock and hands the cheater a huge hand.
**Fix:** in `pickUpPile`, return an error when the pile has no un-cleared cards; also add `phase !== 'play' && phase !== 'endgame'` guard mirroring `playCards`.

### V2 — CRITICAL: PICK_UP accepted during `rearrange` phase (pre-game stock drain + turn corruption)
The server handler `pickUp` (`worker/index.ts:401-414`) only requires `data.state` to exist — which it does from `START_GAME` on, i.e. during the `rearrange` phase. `pickUpPile` has no phase guard (see V1).
**Scenario:** immediately after the host starts the game (phase `rearrange`, pile empty), any seated player sends PICK_UP 5-10 times: draws 3 cards each time, advances `currentPlayerIdx` each time (`engine/index.ts:383-389`), while phase remains `rearrange`. When the game then starts via READY, hands/stock/turn order are corrupted.
**Fix:** same phase guard as V1.

### V3 — HIGH: Multi-card plays not required to share a rank
Shithead rules allow playing multiple cards **of the same rank only**. `playCards` validates each card individually against the top rank (`engine/index.ts:258-265`) and the empty-pile rule only requires *some* card to be 3/10/Joker (`:254-257`), but never checks `cards` all have equal rank. Protocol permits up to 4 cards (`protocol.ts:88-89`).
**Scenario:** on an empty pile send `PLAY [3♠, A♥, K♦, Q♣]` — passes validation, dumps 4 cards at once and draws replacements. Legitimate clients never send mixed sets; hostile ones can.
**Fix:** reject when `new Set(cards.map(c => c.rank)).size > 1` (allowing wilds per house rules).

### V4 — HIGH: Full stock (draw pile) order leaked to every client
`serializeGameState` (`protocol.ts:111-124`) spreads the entire `GameState` and only masks opponent `hand`/`faceDown`. **`state.stock` — the ordered, face-down draw pile with real suits/ranks — is sent verbatim to every player in every `GAME_STATE` broadcast** (`worker/index.ts:487-490`). `state.log` (unbounded history) is also included.
**Scenario:** any player (or anyone running a modified client, which needs no exploit at all) inspects `gameState.stock` and knows exactly which cards they and their opponents will draw for the rest of the game — perfect information. The UI even displays `gameState.stock.length` (`MultiplayerGameTable.tsx:45`), confirming it reaches the client.
**Fix:** serialize `stock` as a count (or hidden cards); strip or truncate `log` for clients.

### V5 — CRITICAL: Seat/session hijacking via RESUME_ROOM with a broadcast playerId
`playerId` is the sole credential for reclaiming a seat, and `resumeRoom` (`worker/index.ts:302-318`) performs **zero authentication** — any client that knows a victim's UUID can send `{"type":"RESUME_ROOM","playerId":"<victim>"}` from a fresh socket; the victim's socket is closed with 4001 (`:309-313`) and the attacker's session takes over the seat, hand, and turn. **Player IDs are not secret**: they are broadcast to every room member in `ROOM_STATE` (`toPlayerSummary` includes `id`, `protocol.ts:128-129`) and in every `GAME_STATE` (`players[].id`).
**Scenario:** Player B opens the devtools (or a script), reads Player A's `id` from any `ROOM_STATE`/`GAME_STATE` message, sends RESUME_ROOM with it from a second WebSocket, and now plays A's cards. Worse, both the real client's auto-reconnect (`RoomClient.ts:65-68` + `useMultiplayerRoom` effect refire on `connected`, `MultiplayerGameTable.tsx:13-26`) and the attacker will keep resuming each other — a resume war at up to 20 msgs/s per side — effectively griefing/DoSing the room. A player can also RESUME_ROOM as someone else *while already seated* (no `session.playerId` precondition, `:302`), abandoning their own seat.
**Fix:** issue a per-player, per-room opaque resume token (random, ≥128-bit) delivered only in `WELCOME`; store a hash server-side; require it for RESUME_ROOM. Never treat the broadcast `playerId` as a credential.

### V6 — HIGH: No resource limits → room/connection/state exhaustion
- **Room creation:** `POST /api/room/new` (`worker/index.ts:542-550`) has no per-IP rate limit. Each created+activated room is a DO instance with SQLite storage living 24h (`ROOM_TTL_MS`, `:36`). An attacker can script thousands of rooms/hour → storage/billing DoS. CORS returns `Access-Control-Allow-Origin: *` for disallowed origins (`:511-519`), and non-browser clients ignore CORS anyway.
- **Connections per room:** unlimited. `openWebSocket` (`:126-152`) accepts any number of sockets; `sessions` grows unboundedly; every broadcast is O(sessions) (`:493-503`); `isConnected` is O(sessions) per player per summary (`:456-458`, `:467-470`). Thousands of sockets to one room = memory/CPU exhaustion and broadcast amplification.
- **Rate limit bypass by fan-out:** the 20 msg/s limit is per *session* (`:210-216`); N sockets ⇒ N×20 msg/s.
- **State growth:** `GameState.log` grows by ≥1 entry per action, is persisted to DO storage on every action (`save`, `:218-227`) and broadcast in full (see V4) → quadratic bandwidth/storage over a long game. Bounded by 24h TTL but abusive in-room.
**Fix:** per-IP/room caps (e.g. ≤ 2×maxPlayers sockets per room, global per-IP token bucket on `/api/room/new` via a rate-limiting DO or Cloudflare Rate Limiting), cap `log` length (ring buffer), max WS message bytes.

### V7 — MEDIUM: TOCTOU on room-code allocation
`/api/room/new` probes `/internal/status` then returns the code (`:543-548`); two concurrent requests can receive the **same** code. First CREATE_ROOM wins, second gets "Room already exists" (`:238-241`). Low impact (retry), but it's a check-then-act race across DO invocations.
**Fix:** acceptable as-is, or have the DO atomically claim the code.

### V8 — MEDIUM: Disconnected-seat liveness abuse (griefing)
During a running game `LEAVE_ROOM` preserves the seat (`:428-433`), and `markReady` requires **all** players including disconnected ones (`:349`). One player who closes the tab during `rearrange` (or mid-game, whose turn never comes because turns don't skip disconnected players) stalls the room for up to 24h. Combined with V5, seats are both stealable and freezable.
**Fix:** add a turn/ready timeout that auto-forfeits or AI-fills disconnected seats.

### V9 — LOW: Room-code allocation brute-force / room guessing
Codes are 6 chars from a 32-char alphabet (~1.07×10^9, `:506-509`) — fine against guessing, but there is no join password; anyone who observes a code (shoulder-surfed, leaked link) can join while the lobby is open. `JOIN_ROOM` is rejected once the game starts (`:288-291`). Acceptable for a casual game; document as a design choice.

### V10 — LOW: Info disclosure in `/api/version`
Exposes `BUILD_COMMIT` and protocol version (`:534-540`). Minor fingerprinting aid. Also the stale-looking allowed origin `https://shithead.maybe4a6f7365.workers.dev` (`:41`) suggests a staging deployment is permanently trusted.

---

## 4. Reconnect / session model

- **Issuance:** `playerId = crypto.randomUUID()` on CREATE/JOIN (`:249`, `:293`); delivered in `WELCOME`; stored in `sessionStorage` (`useMultiplayerRoom.ts:41`).
- **Resume:** `RESUME_ROOM {playerId}` (`MultiplayerGameTable.tsx:16-19`). Refresh works (sessionStorage survives reload); background tab → socket closes → auto-reconnect with linear backoff (max 5 attempts, `RoomClient.ts:75-81`) → effect re-fires RESUME on reconnect.
- **Hijackable:** yes — V5. **Fixable:** yes — two tabs of the same browser fight: tab 2 (no sessionStorage) defaults to `intent:'create'` (`MultiplayerGameTable.tsx:22`) → CREATE_ROOM → "Room already exists" error; but two tabs *sharing* storage (duplicated tab) enter a resume war because each RESUME kicks the other (close 4001) and both auto-reconnect+re-resume (`:309-313` ↔ `RoomClient.ts:67`).
- **No reconnection grace logic server-side for turns:** a disconnected player's turn simply blocks forever (V8).
- **`closeSession` runs outside the serialized operation chain** (`:148-149`, `:451-454`), but `onMessage`'s `sessions.get(sessionId)` guard (`:155-156`) makes a kicked/closed session's queued messages no-op — verified safe.

---

## 5. DoS & abuse surface

- Per-session 20 msg/s sliding window (`:37`, `:210-216`) — present but per-connection only; trivially multiplied by opening more sockets (no per-IP/per-room cap). Rate-limited messages still cost a JSON parse? No — rate check precedes parse (`:158-161`). Good.
- No WS message size cap in code (platform cap ~1 MiB applies); `JSON.parse` of a max-size frame × 20/s × N sockets is CPU-bound work on the DO's single thread.
- No room-creation limit (V6). No chat rate shaping beyond the generic 20/s (chat is sanitized and length-capped, `:416-422`).
- Unbounded `state.log` persisted + broadcast every action (V4/V6).
- DO held resident for every open socket (no hibernation) — idle-connection cost amplification.

---

## 6. HTTP / header posture

- **Security headers: none set anywhere.** API responses carry only CORS headers (`corsHeaders`, `:511-520`); asset responses are passed through untouched (`:558-564`). No `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, or `Permissions-Policy` in the worker, `index.html` (no `<meta http-equiv>`), or a `public/_headers` file (public/ contains only `favicon.svg`). Impact: clickjacking of the app, no defense-in-depth against XSS, MIME sniffing.
- **CORS:** API returns `Access-Control-Allow-Origin: *` for *disallowed* origins (`:513`) — harmless only because no cookies/credentials are used; but it invites cross-origin API abuse (room creation) from any web page. Prefer omitting ACAO entirely for disallowed origins. `Vary: Origin` set (`:518`) — good.
- **WebSocket CSWSH protection:** Origin checked against same-origin or allowlist (`:46-49`, `:102-104`); missing Origin rejected — correct for browsers; non-browser attackers bypass trivially (expected; real auth must come from tokens — see V5).
- **Cache headers:** API: `Cache-Control: no-store` (`:517`) — good. Assets: relies on Cloudflare defaults (hashed `/assets/*` get long cache; `index.html` is served via SPA fallback with platform defaults — could not verify live; recommend explicit `no-cache` on HTML so deploys propagate).
- **Error leakage:** good — errors are generic strings (`:145`, `:169`); exceptions logged server-side only. `/api/version` leaks commit (V10).
- **Asset serving correctness:** `/api/*` runs worker-first (`wrangler.toml:8`); unknown API paths return 404 with headers (`:567`) — correct. SPA fallback only for non-API GETs (`:562`) — correct.

---

## 7. XSS & client-side findings

- No `dangerouslySetInnerHTML`/`innerHTML`/`eval` anywhere in `app/src` or `index.html` (grep-verified). Player names and chat render through React text interpolation only (`MultiplayerGameTable.tsx:39,42,45`) — escaped by default. **No XSS sink found.**
- Defense-in-depth gaps: player names are *not* sanitized server-side (only trim + ≤32 chars, `:243-247`, `:280-283`) — control characters/zero-width/RTL-override spoofing possible (impersonation/confusion, not XSS). Chat *is* sanitized (`:418` strips non-word chars) — inconsistent; sanitize names too.
- **No CSP** (Section 6) means any future injection is unmitigated.
- **Secrets client-side:** none found. `playerId` in `sessionStorage` is the only sensitive artifact — and it's treated as a bearer credential while also being broadcast (V5). Service worker (`registerSW.js`) is PWA-standard; no sensitive caching logic in app code reviewed.
- Client trusts server messages shallowly (`RoomClient.ts:54-63` checks only `type` exists) — acceptable since the server is trusted, but a compromised/malicious server message is out of threat model here.

---

## 8. Race conditions

- **Intra-DO serialization: correct.** All message handlers run through the shared `this.operation` promise chain (`:140-141`), so check-then-act sequences in `createRoom`/`joinRoom`/`markReady`/`play` (which `await save()` mid-handler, e.g. `:263`, `:297`, `:352`, `:397`) cannot interleave with other messages. Await points are safe because of the chain.
- **Close/kick paths bypass the chain** (`:148-149`, `:311-313`), but guarded by `sessions.get` at `:155` — verified no stale-session mutation (kicked session's queued handler returns early). `leaveRoom` mutating `session.playerId` on a session object already removed from the map is harmless.
- **Cross-request TOCTOU on room allocation** — V7.
- **Storage consistency:** single-key `put` per mutation (`:225`), no multi-key transactions needed; alarm + `blockConcurrencyWhile` init (`:71-83`) is the correct pattern. `deleteAll` on expiry (`:119`) is safe because sessions.size === 0 is checked.
- One residual: `save()` bumps `lastActivity` and re-arms the alarm on *every* action (`:224-226`); under the 20 msg/s limit this is ≤20 storage writes/s per room — fine, but a write-heavy amplification if combined with V6 socket fan-out.

---

## 9. Recommended fixes (ranked)

1. **Add phase + non-empty-pile guards to `pickUpPile`** (`engine/index.ts:359`): reject unless `phase` is `play`/`endgame` and the pile has un-cleared cards. (Fixes V1, V2 — critical cheats.)
2. **Issue opaque per-player resume tokens**: generate at CREATE/JOIN, send only in `WELCOME`, store hash in `RoomData`, require in `RESUME_ROOM`; stop treating broadcast `playerId` as a credential. (Fixes V5.)
3. **Mask `stock` (send count only) and strip/cap `log`** in `serializeGameState` (`protocol.ts:111-124`). (Fixes V4, mitigates V6 state growth.)
4. **Enforce same-rank multi-card plays** in `playCards` (`engine/index.ts:249-265`). (V3.)
5. **Abuse controls**: cap sockets per room (≤ 2×maxPlayers), per-IP token bucket on `/api/room/new` and WS connects (Cloudflare Rate Limiting rules or a counter DO), max WS frame size check, drop `Access-Control-Allow-Origin: *` for disallowed origins. (V6.)
6. **Security headers** on all responses (worker wrapper): `Content-Security-Policy: default-src 'self'; connect-src 'self' wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: ()`, `frame-ancestors 'none'` in CSP; explicit `Cache-Control: no-cache` on HTML. (Section 6.)
7. **Liveness**: turn/ready timeouts that auto-pass/auto-ready or convert disconnected seats to AI; reject RESUME for a different playerId while `session.playerId` is set. (V8, part of V5.)
8. **Sanitize player names** server-side like chat (control chars, bidi overrides); add worker-level integration tests simulating hostile clients (currently zero worker tests).
9. **Minor**: make room-code claim atomic (V7), reconsider exposing commit hash (V10), remove/audit the stale allowlisted origin (`worker/index.ts:41`).
