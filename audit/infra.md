# Infrastructure / Cloudflare & CI Audit — Shithead

Audit date basis: repo HEAD `e10cd7b` (2026-08-08T16:39:08Z). Live checks performed ~2026-08-08T17:30Z against
https://shithead.not4a6f7365.workers.dev and the Cloudflare API (account `862ea3…`, MCP `execute` tool — auth worked).

**Headline findings**
1. **Production serves a frozen, stale UI.** `app/index.html` was replaced by a committed build artifact (commit `44de3f3`), so every CI/Workers Builds build re-bundles the stale prebuilt bundle instead of `src/`. 13 subsequent `app/src` commits (all multiplayer client work) are NOT live. Verified live: the host of a room sees "Waiting for host to start…" with no START button — **production multiplayer is effectively unusable from the UI**, while the protocol smoke test passes green.
2. **No service worker in production.** `/sw.js` (and `/workbox-*.js`) return 404/SPA-fallback even though the build generated them and wrangler uploaded them. PWA offline/update flow is dead; `registerSW.js` is served and fails registration at runtime.
3. PWA icons referenced by the manifest **never existed in the repo** — 404 in prod.

---

## 1. Pipeline map (end to end)

Two independent triggers fire on `git push` to `main`:

### A. Cloudflare Workers Builds — THE ONLY DEPLOYER (confirmed via MCP)
Build config (MCP `builds/workers/3c9b12…`): repo `Maybe4a6f7365/shithead`, branch `main`, trigger `push_event`,
`build_command: ""`, `deploy_command: "npx wrangler deploy"`, `root_directory: "/"`, previews disabled.

Observed build (build `3eefa931…`, commit `e10cd7b`, success, log via MCP):
1. Env: `nodejs@22.23.2` (from `.node-version` = `22`, commit `e9415ba`), `bun@1.2.15`.
2. **`bun install`** at repo root → runs root `postinstall` (`package.json:6`): `npm --prefix app ci && npm --prefix app run deploy:build`.
3. `deploy:build` (`app/package.json:21`) = `generate:build-meta` → `typecheck:worker` → `build` (`tsc --noEmit && vite build`).
   - `write-build-meta.mjs:7` stamps `BUILD_COMMIT` from `WORKERS_CI_COMMIT_SHA` (set by Workers Builds) → `src/worker/build-meta.ts`.
4. `npx wrangler deploy` with **wrangler 4.120.0** (root `package.json:9`, npx-installed) using **root `wrangler.toml`**:
   worker `main = app/src/worker/index.ts`, assets `./app/dist` (13 files read), DO binding `ROOM` (class `Room`), migration `v1 new_sqlite_classes`.

### B. GitHub Actions — verification only, cannot gate the deploy
`.github/workflows/deploy.yml`:
- Job `verify` (all pushes/PRs): `npm ci` → `npm test` (vitest, `vitest.config.ts:13` excludes `src/worker/**`) → `typecheck:worker` → `npm run build`.
- Job `production-smoke` (main only, `needs: verify`, `timeout-minutes: 15` at line 40): installs `ws@8` unpinned (line 53), runs `app/scripts/smoke-multiplayer.mjs` with `BASE_URL=…workers.dev`, `EXPECTED_COMMIT=${{ github.sha }}` (line 58), `DEPLOYMENT_TIMEOUT_MS=600000` (line 59). It **observes** the Workers Builds deploy — polls `/api/version` until `version.commit === github.sha`, then exercises the full multiplayer protocol. The deploy itself already happened; a smoke failure only signals, it never blocks.

Note: commit `e10cd7b` ("Replace duplicate deploy action with production multiplayer smoke test") removed a former GH-Actions deploy path — no duplicate deployers remain.

## 2. Live deployment state (via Cloudflare MCP + live probes)

- Worker `shithead` exists; current version `f414862d…` deployed 2026-08-08T16:40:57Z by Workers Builds build `3eefa931…` for push `e10cd7b`. Live `/api/version` returns `{"service":"shithead-multiplayer","commit":"e10cd7bf483b0c1cb1ba71eba2617093fb69cb04","protocol":2}` → **deployed worker == latest main**. ✅
- `migration_tag: v1` (matches `wrangler.toml:14-16`); DO namespace `shithead_Room` (`08660a…`) bound as `ROOM`; `ASSETS` binding present.
- `compatibility_date: 2026-08-08` live (matches config).
- workers.dev subdomain enabled; **no custom domains/routes** (only `naylampdiving.com` exists on the account, bound to a different worker). `workers_dev`/previews enabled at subdomain level; build previews disabled.
- Observability: enabled, Workers Logs 100% sampling + invocation logs + persist; **traces disabled; logpush off** (settings via MCP; config `[observability] enabled = true`, `wrangler.toml:18-19`).
- 10 deployments in 16:34–16:41 window; one Workers Build (`05d65e0`) was **skipped** (superseded) — see smoke-test race note.
- Live asset probes: `/`, `/registerSW.js`, `/manifest.webmanifest`, `/favicon.svg`, `/assets/index-OZkqToXB.js`, `/assets/index-CfhAyBvr.css` → 200. **`/sw.js`, `/sw.js.map`, `/workbox-9c191d2f.js`, `/assets/manifest-2VGkNcw1.webmanifest`, `/icons/icon-192.png` → all SPA-fallback (asset 404).**
- Live bundle `index-OZkqToXB.js` begins with two stacked modulepreload polyfills → it is the **re-bundled stale artifact**, confirming the frozen-UI pipeline end to end.
- Behavioral proof of stale UI: created room `JT72M3` via the live UI; waiting screen showed "Waiting for host to start…" to the host (no START button, no `(you)` marker). Current src renders a disabled `WAITING FOR PLAYERS…` button + `(you)` for the host (`app/src/components/MultiplayerGameTable.tsx:39`). The frozen bundle lacks `RESUME_ROOM`, `SESSION_EXPIRED`, `ROOM_FULL`, `LEAVE_ROOM`, `(you)`, `Reconnecting…`, `YOUR TURN` (grep of `app/assets/index-GOD9SWZU.js` vs `app/src`). (Audit-created room expires via the 24h DO alarm, `src/worker/index.ts` `ROOM_TTL_MS`.)

## 3. Fragility & config conflicts

| # | Finding | Evidence |
|---|---------|----------|
| F1 | **`app/index.html` is a committed build artifact** (hashed `/assets/index-GOD9SWZU.js` entry, marker comment `build-1786202834` at line 19, no `/src/main.tsx`). Vite builds from it: only "4 modules transformed" and warning `<script src="/registerSW.js"> … can't be bundled without type="module"` (build log). Result: UI frozen at commit `44de3f3` (2026-08-08 15:46Z); 13 later `app/src` commits never ship. Root cause of the broken multiplayer host flow in prod. | `app/index.html:12,19`; git `44de3f3`; Workers Build log |
| F2 | Committed build artifacts in `app/` root: `app/assets/index-GOD9SWZU.js(.map, 1.1MB)`, `app/sw.js`, `app/registerSW.js`, `app/manifest.webmanifest`, `app/version.txt` (marker `build-1786202932` ≠ index.html's `…834` — two different stale builds), `app/shot.mjs` (imports `playwright`, **not declared in any package.json** → broken script). | `git ls-files app` |
| F3 | **Duplicate wrangler configs**: root `wrangler.toml` and `app/wrangler.toml` are identical except relative paths (`main`/`directory`). Deploys use root; `npm run worker:deploy` from `app/` (`app/package.json:18`) uses the app copy. They can silently drift. | `wrangler.toml:1-19`, `app/wrangler.toml:1-19` |
| F4 | **Wrangler version split**: root pins `wrangler@4.120.0` (exact, `package.json:9`) — used by Workers Builds; app devDep `^3.91.0` → locked `3.114.17` (`app/package.json:43`, released 2026-01-13). `compatibility_date = 2026-08-08` is ~7 months newer than 3.114.17 → local deploys warn/clamp the compat date; asset/migration semantics differ across major versions. | package.jsons, lockfile, npm registry |
| F5 | **No root lockfile.** Workers Builds runs `bun install` at root: wrangler transitive deps resolved fresh every build; log explicitly: "No package-lock.json… Build caching not supported" despite `build_caching_enabled: true` in the build config. | repo root, MCP build config + log |
| F6 | Build happens in `postinstall` (`package.json:6`) — runs on *any* root `npm install`/`bun install` (side-effecty), and Workers Builds relies on it because `build_command` is empty. Works, but brittle/invisible. | `package.json:6`, MCP build config |
| F7 | `run_worker_first = ["/api/*"]` (`wrangler.toml:8`): non-API traffic goes assets-first; on asset miss the platform falls through to the worker, which implements SPA fallback manually (`src/worker/index.ts:558-566`). Works today (verified `/leaderboard` → 200), but every asset 404 (incl. the missing sw.js/icons) burns a worker invocation, and the double-fallback semantics are subtle. | wrangler.toml, worker code, live probes |
| F8 | Engines mismatch: root `>=22`, app `>=20`; GH Actions pins 22; `.node-version` 22. Cosmetic. | package.jsons, deploy.yml:24 |
| F9 | Stale origin allow-list entry `https://shithead.maybe4a6f7365.workers.dev` — the real subdomain is `not4a6f7365` (GitHub org is `Maybe4a6f7365`); also unused `https://shithead.pages.dev`. | `src/worker/index.ts:41` |
| F10 | `sourcemap: true` in production builds (`app/vite.config.ts:37`) → `.map` files generated and uploaded; currently 404 by accident of F12, but any fix will publicly expose full source maps unless excluded. | vite.config.ts, build log |
| F11 | vitest excludes `src/worker/**` — the DO/worker has zero unit-test coverage in CI; only the smoke test covers it. | `vitest.config.ts:15` |
| F12 | **sw.js/workbox uploaded but not served** — see §4. Mechanism unexplained from repo side (wrangler read 13 files, uploaded all; asset router 404s exactly the PWA-generated files + `.map`s + the vite-emitted `assets/manifest-*.webmanifest`; everything referenced by `index.html` serves). Needs Cloudflare-side investigation or redeploy-and-verify. | build log vs live probes |

## 4. PWA / service-worker update-flow risks

1. **No active SW in production (critical).** `registerSW.js` is served and executes `navigator.serviceWorker.register('/sw.js')`; `/sw.js` 404s → registration fails → no precache, no offline, no auto-update. Observed live; build log proves `dist/sw.js` was generated (PWA v0.21.2, precache 7 entries) and wrangler uploaded it.
2. **Manifest icons 404** (`icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png` referenced in `app/vite.config.ts:16-22` manifest and the served `manifest.webmanifest`) — no such files anywhere in repo history → install criteria never met.
3. When the SW does work: `registerType: 'autoUpdate'` + generated workbox SW uses `skipWaiting()` + `clientsClaim()` (see committed artifact `app/sw.js`), and `globPatterns` precaches `index.html` (`app/vite.config.ts:30-32`). Navigations are served from precache (`NavigationRoute`), so after each deploy clients keep the old UI until the SW update cycle completes; with skipWaiting this is one reload. API calls bypass the SW (worker sets `Cache-Control: no-store`, `src/worker/index.ts:517`), so mixed-version UI/API is the main residual risk — currently moot since the UI itself is frozen (F1).
4. The committed `index.html` already contains the plugin-injected `<script id="vite-plugin-pwa:register-sw" src="/registerSW.js">`; on every build vite warns it can't bundle it — benign today, fragile if the plugin's injection heuristics change (duplicate registration).

## 5. Smoke-test assessment (`app/scripts/smoke-multiplayer.mjs`)

**Coverage (strong):** deploy-readiness gate on `/api/version` (`commit === EXPECTED_COMMIT`, `service`, `protocol === 2`), `/api/health`, room allocation (`/api/room/new`, 6-char code), WS connect with correct `Origin`, CREATE/JOIN + presence sync, host disconnect → guest sees `connected:false`, RESUME without player duplication, START → rearrange phase on both peers, **hidden-card leak checks** (opponent hand + face-down masked as `rank '3', suit null`), READY → play phase, CHAT, PING/PONG, and a real PICK_UP mutation propagated to both peers with turn advancement. Per-wait timeouts 20 s, WS handshake 15 s, overall deploy wait 10 min, job cap 15 min.

**False-pass vectors:**
- Tests worker/DO only — **blind to static assets/UI**. This is exactly how the frozen-UI regression (F1) and missing sw.js (F12) shipped while CI stayed green. No assertion ties the deployed HTML/assets to the commit.
- `EXPECTED_COMMIT` is always set in the workflow; a re-run/`workflow_dispatch` on an old sha would correctly fail (waits then times out) — OK.
- Creates real production rooms/DO storage on every run (cleaned by 24 h alarm — acceptable, but unmonitored accumulation if the alarm path breaks).

**False-fail vectors:**
- **Skipped Workers Builds**: build for `05d65e0` had outcome `skipped` (superseded by a newer push). If the GH concurrency cancellation (`deploy.yml:13-15`) loses the race, the smoke job for the skipped commit waits 10 min and fails although nothing is broken.
- Deploy wait (10 min) shares the 15-min job budget with `npm ci` + `ws` install + the test itself (~2-3 min); Workers Builds queueing >~10 min → false fail. Observed deploy latency is ~2 min, so headroom is currently fine.
- `ws@8` installed `--no-save` unpinned (deploy.yml:53) — upstream breakage would fail CI, not prod.
- Message rate limit is 20 msg/s per session (`src/worker/index.ts` `MAX_MESSAGES_PER_SECOND`); smoke sends ~6-8 per peer — safe.

**Timeout behavior:** all waits bounded (20 s default per assertion; `AbortSignal.timeout(20s)` on HTTP; 10-min deploy poll; 15-min job). A hung deploy fails cleanly with the last observed version.

## 6. Dependency health

- **`npm ci` in the build reports "11 vulnerabilities (4 moderate, 5 high, 2 critical)"** (Workers Build log; `npm audit` endpoint unavailable on the configured registry mirror, so details unenumerated).
- Deprecated transitive deps in install log: `rollup-plugin-inject@3.0.2`, `sourcemap-codec@1.4.8`, `glob@10.5.0/11.1.0`.
- Outdated (npm registry): `react`/`react-dom` 18.3.1 (latest 19.2.8), `zustand` ^4.5.5 (5.x), `framer-motion` ^11 (package renamed to `motion`, latest 13), `vite` ^5 (7.x), `vitest`/`@vitest/coverage-v8` ^2 (3.x), `tailwindcss` ^3.4 (4.x), `vite-plugin-pwa` ^0.21 (1.x), `@cloudflare/workers-types` ^4.20241112 (stale vs 2026 compat date), app `wrangler` ^3.91 vs root 4.120.0 (F4).
- Unused: `clsx` (0 imports in `src/`). `framer-motion` and `zustand` each used in 1 file.
- Lockfiles: `app/package-lock.json` present, used for GH Actions npm cache (`deploy.yml:27`); **root has none** (F5).

## 7. Recommended fixes (ranked)

1. **Unfreeze the UI (fixes the live multiplayer breakage):** restore `app/index.html` to source form (`<script type="module" src="/src/main.tsx">`, remove hashed tags + marker) and delete committed artifacts `app/assets/`, `app/sw.js`, `app/registerSW.js`, `app/manifest.webmanifest`, `app/version.txt`. Redeploy; verify the host sees `WAITING FOR PLAYERS…` and `(you)` live.
2. **Make the smoke test cover the UI surface:** assert `GET /` HTML references an `assets/index-*.js` that returns 200, assert `/sw.js` returns JS (not HTML fallback), and stamp `WORKERS_CI_COMMIT_SHA` into the built HTML (meta tag) and assert it matches `EXPECTED_COMMIT`. This closes the exact blind spot that let F1/F12 ship.
3. **Fix PWA assets:** add `app/public/icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`; after (1), redeploy and verify `/sw.js` serves. If it still 404s despite upload, escalate to Cloudflare (F12) or work around by serving sw.js from the worker.
4. **One wrangler, one config:** bump app to `wrangler@^4.120.0` (or drop the app devDep and use the root one), delete `app/wrangler.toml` or keep it byte-identical to root, and avoid `worker:deploy` from app/ until aligned (compat-date clamping under 3.114.17).
5. **Commit a root lockfile** (`package-lock.json` or `bun.lock`) — reproducible Workers Builds + enables build dependency caching.
6. **Move the build out of `postinstall`** into an explicit root `build` script and set the Workers Builds `build_command` accordingly.
7. **Dependency hygiene:** fix the 11 audit findings (2 critical) via upgrades; remove `clsx`; upgrade vite/vitest/tailwind/vite-plugin-pwa/zustand/react stack or pin deliberately; refresh `@cloudflare/workers-types`; delete or repair `app/shot.mjs` (add `playwright` devDep or remove).
8. **Stop shipping source maps:** `build.sourcemap: false` (`app/vite.config.ts:37`) or an `.assetsignore` with `**/*.map`; purge the committed 1.1 MB map from git history later.
9. **Minor:** fix/remove the `maybe4a6f7365` origin (`src/worker/index.ts:41`); align `engines`; consider `vitest` coverage for `src/worker/**` via the workers pool hinted in `vitest.config.ts:4-6`.
10. **Optional gating:** since GH Actions can no longer block a bad deploy, consider an auto-`wrangler rollback` step on smoke failure (deployments API supports it) to make the smoke test a real gate.

---
*Method note: Cloudflare observations via MCP `execute` against account `862ea3…` (workers/scripts, deployments, builds config, build logs, DO namespaces, settings); live probes via browser tool. IDs truncated. No files modified; one disposable test room (`JT72M3`) created in production during verification (auto-expires via the 24 h DO alarm).*
