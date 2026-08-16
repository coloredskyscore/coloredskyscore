## coloredsky score™

Fundamentals-first crypto ratings. No hype, no price targets.

**Live dashboard:** https://coloredskyscore.com

### What this is

coloredsky score™ runs two independent rating frameworks for major crypto assets, each scored purely on documented, live-today fundamentals — never roadmap promises, never sentiment.

- **coloredsky score™ (TradFi)** — how a chain looks through an institutional investor lens: regulatory clarity, security posture, on-chain health, real-world utility, and more.
- **coloredsky AI score™ (Agent Readiness)** — how a chain looks through the lens of an autonomous AI agent trying to transact on it: deterministic finality, programmability, execution quality, agent tooling, and more.

The two scores are never blended. They're separate axes, and the gap between a chain's two scores — its divergence — is often a more interesting signal than either number alone.

Every chain clears three pass/partial/fail gates per axis before being scored across nine weighted categories. Testnet-only features get zero credit, and narrative, macro, and price action are explicitly out of scope.

### How it's built

This repo is the dashboard: a single static site (`index.html`, no build step) served via GitHub Pages, pulling from `data/board.json` (board-level scores) and `data/chains/<ticker>.json` (per-chain detail, fetched on demand when a chain's panel is opened).

### Who's behind it

Built by [@thecoloredsky](https://x.com/thecoloredsky) on X. Follow there for new chain scores and framework updates.

### Disclaimer

Nothing here is financial advice or a price target. These are fundamentals scores only.
