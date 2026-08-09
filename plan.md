# SHITHEAD — Product, Design & Engineering Evolution Plan

Repo: `Maybe4a6f7365/shithead` (public, default branch `main`, main = production via Cloudflare Workers Builds)
Stack: Vite + React + TS PWA frontend · Cloudflare Workers + Durable Objects (`Room` DO, one per room) · shared pure engine (`app/src/engine/`) · vitest · Tailwind · WS realtime
Goal: evolve the existing game into a distinctive, production-quality, mobile-first card game with its own design language — per the uploaded mission brief.

## Operating principles (from brief)
- Understand before redesigning; preserve what works; no rewrites of functioning systems.
- No AI-UI clichés (glassmorphism, purple/blue gradients, pill-everything, cards-in-cards, glow).
- Mobile-first is canonical; cards are the stars; the table is the interface.
- No fake functionality; server authority for game-critical decisions; test like a player.
- `main` is production: all work on feature branch(es) → verified build+tests → PR → merge only after user confirms.

## Stage 0 — Workspace & baseline (main agent)
- Clone repo locally, install deps, run test suite + production build, capture baseline.
- Load skills: `swarm-workspace` (worktree setup), `vibecoding-webapp-swarm` (orchestration), `webapp-building-swarm` (React/Tailwind/shadcn constraints as applicable).
- Output: baseline report (tests pass/fail, build status, dep audit).

## Stage 1 — Parallel recon swarm (explore agents, read-only)
Four non-overlapping audits, each producing a written brief:
1. **Engine & rules auditor** — `app/src/engine/` + tests: map rules implementation vs the German variant in README, find gaps/bugs/ambiguities, AI quality, test coverage holes.
2. **Frontend/UX auditor** — components, styling, responsive behavior, animations, accessibility, mobile viewport handling, player journey (hot-seat + online), PWA behavior.
3. **Realtime/backend & security auditor** — worker/index.ts, Room DO, protocol validation, server authority, reconnect model, rate limiting, XSS/CSP/headers, secrets, error leakage, race conditions.
4. **Infra/Cloudflare & CI auditor** — wrangler.toml, workflows, deployment wrapper, asset serving, observability, build pipeline; check Cloudflare env via MCP where possible.
Cross-validated synthesis → internal plan: what exists / broken / preserve / redesign / architectural work / incremental wins / verification approach.

## Stage 2 — Product & design system (design stage gate)
- Designer sub-agent produces the **Shithead visual language spec**: typography, type scale, spacing, surface hierarchy, table treatment, card geometry/backs/shadows, suit representation, player identity, all interaction states (playable/selected/invalid/active-player/turn/success/danger/reconnect/empty/victory/defeat), motion spec (durations/easings per event, reduced-motion fallbacks), sound-architecture notes.
- Palette evolves from existing woodcut identity (cream/burgundy/forest/gold) — refined, not replaced, unless audit shows it fails.
- Optional: image_generation plugin for card-back motif / table texture / app icon IF the design spec calls for raster art (prefer SVG/CSS otherwise — performance).
- Output: `DESIGN.md` + tokens (CSS custom properties) draft. Gate: review by reviewer agent against brief §3-§11, §20.

## Stage 3 — Implementation swarm (coder agents, worktree-isolated branches)
Sequenced in waves by dependency; each agent: guidance (skill excerpts + design spec + audit findings) + context + mission.
- Wave A (foundation): design tokens + card component system + table layout (mobile-first) — branch `feat/design-system`.
- Wave B (interaction & motion): turn transitions, card play/draw/burn animations, invalid-move feedback, connection-state UX — branch `feat/motion-interaction`.
- Wave C (correctness): engine/rule fixes + protocol hardening + server-authority gaps + tests — branch `feat/engine-integrity` (highest priority if audit finds rule bugs).
- Wave D (security & resilience): headers/CSP, WS auth, rate limiting, input validation, reconnect robustness — branch `feat/security`.
Each wave: implement → unit/integration tests → build → self-verify. No placeholders, no fake logic.

## Stage 4 — Verification swarm (verifier/reviewer agents)
- Rule regression: full engine test suite + adversarial protocol tests (out-of-turn, foreign cards, malformed/duplicate actions).
- Player-journey tests: create/join room, multi-player, special cards, disconnect/reconnect, refresh, backgrounding.
- Mobile viewport matrix (320px up, iPhone/Android/desktop), reduced-motion, keyboard/focus, contrast.
- Performance: bundle size, dependency creep, render cycles.
- Reviewer gates each wave diff against brief's Definition of Done (§24).

## Stage 5 — Integration & delivery
- Merge waves into one integration branch, resolve conflicts, full test + build + dep audit.
- Open PR to `main` with complete changelog and verification evidence.
- Cloudflare: verify Workers Builds status/logs via MCP where available; confirm preview deployment.
- Ask user before merging to `main` (production). After merge: verify production deployment end-to-end (routes, assets, WS, multiplayer, reconnect, console clean).

## Tooling notes
- GitHub MCP for repo reads/branches/PR; local git worktrees per swarm-workspace for code edits and test/build runs.
- Cloudflare MCP (docs/search/execute) only for inspecting deployment state — never expose credentials to client code.
- image_generation only if design spec requires raster assets; keep assets small (performance budget).
