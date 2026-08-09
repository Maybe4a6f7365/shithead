# Shithead — The Classic Shedding Card Game

A web-first, mobile-optimized Shithead implementation with AI bots, online multiplayer, and a clean public-domain art style.

## 🎴 Features

- **Mobile-first PWA** — installable, touch-optimized, and responsive in portrait or landscape
- **Single-device hot-seat** — 2-5 players, mix humans + AI (Easy/Medium/Hard)
- **Online multiplayer** — create a room, share the code, play with friends
- **Strict rules engine** — 100% test coverage on game logic
- **Hand-coded cards** — crisp, modern card faces with no image dependency
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

- **Round options:** the host chooses whether Jokers are included and whether the previous winner gets the optional face-up exchange
- **Deal:** 3 cards face-down, then 6 visible cards. Choose any 3 of those 6 for the face-up final row; the other 3 become your hand
- **Goal:** Lose all your cards. Last player holding = **Shithead**.
- **Start:** the player with the lowest-ranked face-up final card begins
- **Play:** normally play one card or any number of cards of the same rank that match or beat the effective pile rank; special cards modify this below. Can't/won't → pick up pile
- **Refill:** after playing, draw back up to 3 cards while the stock still has cards
- **Endgame phase:** when stock runs out, play from face-up, then face-down blind
- **Next-round exchange (optional):** after everyone chooses their face-up final row, the previous winner may swap exactly one of those 3 cards with exactly one face-up final card belonging to the previous Shithead — or skip the exchange

### Special cards

| Card | Effect |
|------|--------|
| **2** | Reset — play anytime; removes the active rank constraint, so anything can follow |
| **3** | Copy — play anytime; counts exactly like the effective card below it |
| **7** | Low — the next ordinary card must be 7 or lower |
| **8** | Skip — skips one active player per 8 played; equal-rank 8s stack |
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

Modern mobile-game palette:
- Midnight `#0b1120`
- Coral `#d33656`
- Teal `#4de0c4`
- Amber `#f6b94b`

## 📜 License

Apache 2.0 — see LICENSE.
<!-- build trigger Sat Aug  8 03:25:44 PM UTC 2026 -->
