## coloredsky score™

Credit ratings for the chains. Fundamentals only, no hype, no price targets.

**Live dashboard:** https://coloredskyscore.com

### What this is

coloredsky score™ runs two independent rating frameworks for blockchains, each scored purely on documented, live-today fundamentals. Roadmap promises and sentiment never count.

- **coloredsky score™ (TradFi):** how a chain looks through an institutional investor lens: regulatory clarity, security posture, on-chain health, real-world utility, and more.
- **coloredsky AI score™ (Agent Readiness):** how a chain looks to an autonomous AI agent trying to transact on it: deterministic finality, programmability, execution quality, agent tooling, and more.

The two scores are never blended. They're separate axes, and the gap between a chain's two scores, its split, is often a more interesting signal than either number alone.

Every chain clears three pass/partial/fail gates per axis before being scored across nine weighted categories. Testnet-only features get zero credit, and narrative, macro, and price action are explicitly out of scope.

### How it's built

A static site served by GitHub Pages, no build step.

- `index.html` is the whole dashboard: the TradFi × AI map (top 20 chains by TradFi rating), Rankings (up to 100 chains per lens), and each chain's page at `#chain=<slug>`. Dark and light themes follow the visitor's device and remember their choice.
- `data/board.json` holds board-level scores and tiers and loads on every visit. `data/chains/<slug>.json` holds each chain's gates, categories, findings and tile metrics, fetched only when a chain page or a lens that needs it opens.
- `<slug>/index.html` (for example `btc/`) is a short link, coloredskyscore.com/btc, with its own link-preview tags. It forwards to the chain page. After adding a chain to `board.json`, regenerate these with `python3 tools/make_chain_pages.py`.

### Who's behind it

Built by [@thecoloredsky](https://x.com/thecoloredsky) on X. Follow there for new chain ratings and framework updates.

### Disclaimer

Nothing here is financial advice or a price target. These are fundamentals ratings only.
