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

## Game flow

1. **Game screen** — "Stars clicked" counter, **Withdraw** button, 3D golden
   Telegram star boss on an ornate gold pedestal, boss health bar, dynamic
   titles (*This is your first boss → He's getting weaker! → The boss is
   resisting → Final push!*), big gold **Hit the boss!** button.
2. Each tap: boss shake, sparks, floating `+79 … +130` damage numbers,
   counter bump, haptic feedback, health bar drains (~40 taps per boss).
3. **Win screen** — autumn-themed *5,000 Telegram Stars* reward card,
   confetti, "BOSS DEFEATED" badge, "You killed the boss!", rolling counter,
   **Claim 5,000 stars** button (opens `window.CLAIM_URL` when set).

## Structure

- `server.js` — Express static server (+ `/api/health`, `/vendor/confetti.js`)
- `public/index.html`, `style.css`, `app.js` — all UI and animations
- `public/assets/` — `boss.webp` (3D star), `pedestal.webp`, `card-bg.jpg`
  (generated artwork) + Fluent Emoji 3D icons (MIT)

## Open-source resources

- Font [Nunito](https://fonts.google.com/specimen/Nunito) — OFL
- Icons [Fluent Emoji 3D](https://github.com/microsoft/fluentui-emoji) — MIT
- [canvas-confetti](https://github.com/catdad/canvas-confetti) — ISC
- Telegram WebApp SDK — `telegram-web-app.js`

## Backend integration (later)

Integration points are marked in `public/app.js`: `load()/save()` (state),
`onHit()` (hit), `window.CLAIM_URL` (the "Claim stars" link).
