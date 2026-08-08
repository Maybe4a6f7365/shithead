# Shithead — The Classic Shedding Card Game

A web-first, mobile-optimized Shithead implementation with AI bots, online multiplayer, and a clean public-domain art style.

## 🎴 Features

- **Mobile-first PWA** — installable, portrait-locked, touch-optimized
- **Single-device hot-seat** — 2-5 players, mix humans + AI (Easy/Medium/Hard)
- **Online multiplayer** — create a room, share the code, play with friends
- **Strict rules engine** — 100% test coverage on game logic
- **Hand-coded SVG cards** — public-domain woodcut-inspired style
- **No tracking, no analytics** — your game data is yours

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│ Frontend (Vite + React + TS PWA)            │
│  - Touch UI, mobile-first                   │
│  - WebSocket client (src/net/)              │
├─────────────────────────────────────────────┤
│ Backend (Cloudflare Workers + Durable Obj)  │
│  - One DO per game room                     │
│  - WebSocket relay + state machine          │
│  - Static asset serving (built PWA)         │
├─────────────────────────────────────────────┤
│ Shared Engine (src/engine/)                 │
│  - Pure functions, zero deps                │
│  - Used by both client + server             │
│  - 100% unit tested (TDD)                   │
└─────────────────────────────────────────────┘
```

## 🎯 Game Rules

Standard German Shithead variant:

- **Deck:** 52 French + 2 Jokers (52 only without jokers)
- **Deal:** 9 cards each = 3 face-down + 3 face-up (on top) + 3 in hand
- **Goal:** Lose all your cards. Last player holding = **Shithead**.
- **Start:** eldest hand = first player with a 3 face-up
- **Play:** play a card or equal-rank set ≥ top of wastepile. Can't/won't → pick up pile
- **Hand minimum:** 3 cards always; draw from stock to refill
- **Endgame phase:** when stock runs out, play from face-up, then face-down blind

### Special cards

| Card | Effect |
|------|--------|
| **2** | Wild — can be played on anything, anything can follow |
| **10** | Play anytime — clears the pile, same player leads |
| **Quartet** (4× same rank) | Same as 10 — clears pile, same player leads |
| **Joker** | Wild + clears pile |

## 🚀 Development

### Prerequisites

- Node.js 20+
- npm 10+

### Install + run locally

```bash
cd app
npm install
npm run dev          # start Vite dev server on :5173
```

Open http://localhost:5173 — play against AI bots.

### Test (TDD)

```bash
npm test             # run all tests
npm run test:watch   # watch mode
npm run test:coverage # coverage report (must stay >80%)
```

### Multiplayer dev mode

```bash
# Terminal 1: Worker emulator
npm run worker:dev   # starts wrangler dev on :8787

# Terminal 2: Frontend
npm run dev

# In browser: open http://localhost:5173 → multiplayer
```

### Build + deploy

```bash
npm run build        # build PWA to ./dist
npm run worker:deploy # deploy to Cloudflare Workers
```

Production deploy is automatic on push to `main` via GitHub Actions.

## 📁 Project structure

```
shithead-game/
├── app/
│   ├── src/
│   │   ├── engine/           # Pure game logic (client+server shared)
│   │   │   ├── index.ts      # Rules, reducers, AI
│   │   │   ├── protocol.ts   # Wire format types + serialization
│   │   │   └── __tests__/    # TDD test suite
│   │   ├── worker/           # Cloudflare Worker (Durable Object)
│   │   │   ├── index.ts      # Entry point + Room DO
│   │   │   └── __tests__/    # Integration tests via miniflare
│   │   ├── net/              # Client WebSocket layer
│   │   ├── components/       # React UI
│   │   ├── App.tsx           # Root component
│   │   └── main.tsx          # Entry point
│   ├── public/               # Static assets (favicon, icons)
│   ├── dist/                 # Built PWA (gitignored)
│   ├── wrangler.toml         # Worker config
│   ├── vite.config.ts        # Vite + PWA config
│   ├── vitest.config.ts      # Test config
│   └── package.json
├── assets/                   # Source art (not deployed)
├── .github/workflows/        # CI/CD
└── README.md
```

## 🎨 Style

Woodcut-inspired palette:
- Cream `#faf8f3`
- Burgundy `#a23a1e`
- Forest `#2d4a2b`
- Gold `#c8a35a`

## 📜 License

Apache 2.0 — see LICENSE.
<!-- build trigger Sat Aug  8 03:25:44 PM UTC 2026 -->
