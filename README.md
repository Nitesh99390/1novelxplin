# Hit the BOSS! — Telegram Mini App (frontend)

A "Hit the Boss" clicker game for Telegram Mini Apps, in English. This is
**frontend only** for now (state is stored in `localStorage`); the backend
(bot, payouts, claim links) will be added later.

## Run

```bash
npm install
npm start          # http://localhost:3000
npm test
```

## Deploy on Render

The repo contains `render.yaml` — connect the repo in Render (Blueprint) or
create a Web Service: `npm ci` / `npm start`, health check `/api/health`.
Then set the service URL in BotFather → Bot Settings → Menu Button / Web App.

## Game flow — tap → watch ads → collect stars

| Boss | Tap until | Then watch | Reward |
|------|-----------|------------|--------|
| 1 | 1,000 points | 1 ad  | +1,000 ★ |
| 2 | 3,000 points | 2 ads | +3,000 ★ |
| 3 | 5,000 points | 3 ads | +5,000 ★ |

1. **Game screen** — "Points tapped" counter, **My stars** balance, goal strip
   (1,000 → 3,000 → 5,000), 3D golden star boss with a health bar and dynamic
   titles (*This is your first boss → He's getting weaker! → The boss is
   resisting → Final push!*), big gold **Hit the boss!** button.
2. Each tap: boss shake, sparks, floating `+95 … +135` points (crit ×2),
   haptic feedback, health bar drains. Points stop **exactly** at the milestone.
3. **Reward screen** — "Watch N ads and get X ★", one box per ad (✓ when
   watched). An ad only counts if it was watched to the end.
4. All ads watched → stars fly into **My stars**, the next boss starts.
   After boss 3 the round starts again from 0.
5. **Skip and start over** → points go back to 0 and the ladder restarts at
   boss 1. Stars already earned are kept.
6. Progress (including half-watched offers) survives app reloads.

## Ads

`public/ads.js` uses **[Adsgram](https://adsgram.ai)** rewarded ads (made for
Telegram Mini Apps) when `ADSGRAM_BLOCK_ID` is set, otherwise a built-in
**demo ad** (5-second countdown) so the flow can be tested right away.

| Env var | Meaning |
|---------|---------|
| `ADSGRAM_BLOCK_ID` | Rewarded block ID from partner.adsgram.ai (empty = demo ad) |
| `DEMO_AD_SECONDS`  | Length of the demo ad (default 5) |

The server serves these as `/config.js` (`window.APP_CONFIG`).

## Structure

- `server.js` — Express static server (+ `/api/health`, `/vendor/confetti.js`)
- `public/rewards.js` — reward ladder rules (pure logic, unit-tested)
- `public/ads.js` — rewarded ads adapter (Adsgram / demo)
- `public/index.html`, `style.css`, `app.js` — all UI and animations
- `public/assets/` — `boss.webp` (3D star), `pedestal.webp`, `card-bg.jpg`
  (generated artwork) + Fluent Emoji 3D icons (MIT)

## Open-source resources

- Font [Nunito](https://fonts.google.com/specimen/Nunito) — OFL
- Icons [Fluent Emoji 3D](https://github.com/microsoft/fluentui-emoji) — MIT
- [canvas-confetti](https://github.com/catdad/canvas-confetti) — ISC
- Telegram WebApp SDK — `telegram-web-app.js`

## Backend integration (later)

- State is in `localStorage` (`boss_rewards_v1`) — move `load()/save()` in
  `public/app.js` to the server so stars can't be edited by the user.
- Verify ad views server-side with the Adsgram reward URL before adding stars.
- Next step: a **shop** where users spend their stars on products.
