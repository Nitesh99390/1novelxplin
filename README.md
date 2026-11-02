# Star Pass — paid Telegram groups & channels for ⭐ Telegram Stars

A Telegram bot + Mini App that lets **any owner sell access to their group or
channel for Telegram Stars**. The bot handles payments, gives each buyer a
**personal one-time invite link**, starts the **countdown when the buyer joins**
and **removes the member automatically** when their time is over.

## How it works

### Owner
1. Add the bot to your group / channel as **admin** with the rights
   **Invite users via link** and **Ban users** (channels: *Add subscribers*).
2. The bot sends you a **private message**: *"Connected! How many ⭐ Stars should
   a membership cost?"* with price buttons (25 · 50 · 100 · 250 · 500 · 1000 or
   custom).
3. Next it asks **how many days** access lasts (1 · 7 · 15 · 30 · 90 · 365 or
   custom). The plan is saved and you get a share link.
4. Everything else is in the **Mini App → Manage** tab:
   - earnings (all time / 30 days), active members, paid-but-not-joined
   - add / edit / hide / delete plans (up to 10 per chat)
   - pause sales, hide from Explore, edit the description
   - member list with time left, **gift extra days**, **remove now**
   - recent sales, share link, re-check bot rights

If the owner never started the bot, the bot posts a "Set up membership" button
in the group and delivers the setup DM as soon as the owner presses **Start**.
If the bot loses its rights or is removed, the owner is notified and sales pause
automatically.

### Member
1. Opens the Mini App (or the owner's link), sees the plans with price and
   number of days, picks one and pays with **Telegram Stars** (native invoice).
2. The bot DMs a **one-time invite link** (valid `LINK_TTL_HOURS`, default 24h).
   It is a *join-request* link: the bot approves only the buyer and declines
   anyone else who tries to use it. The link is revoked after joining.
3. **The countdown starts at the moment the member joins** — not at payment.
4. **My memberships** shows a live countdown (days / hours / min / sec). If the
   link expired, the member can get a new one from the Mini App.
5. A reminder is sent before the end (`REMIND_HOURS`, default 24h).
6. When time is up the bot removes the member (ban + immediate unban, so they
   can buy again later) and tells them they can renew.
7. Buying again while active **extends** the end date. If the buyer is already
   inside the chat, the countdown starts right after payment.
8. If an invite link can't be created (bot lost rights), the Stars are
   **refunded automatically**.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. *(Optional, recommended)* `/newapp` in BotFather → set the URL to your server
   and remember the short name → `MINIAPP_SHORT_NAME`. Enables direct links
   `t.me/<bot>/<short_name>?startapp=c_<slug>`.
3. Deploy (see below) and set the env vars. On start the bot automatically sets
   its webhook, commands, menu button (opens the Mini App), descriptions and
   default admin rights.

```bash
npm install
cp .env.example .env    # fill BOT_TOKEN, PUBLIC_URL
npm start               # http://localhost:3000
npm test
```

Without `PUBLIC_URL` the bot uses **long polling** (good for local testing), but
Mini App buttons need an **https** URL.

### Environment variables

| Var | Default | Meaning |
|-----|---------|---------|
| `BOT_TOKEN` | — | Token from BotFather (**required**) |
| `PUBLIC_URL` | `RENDER_EXTERNAL_URL` | Public https URL → webhook + Mini App |
| `WEBHOOK_SECRET` | — | Secret token checked on every webhook call |
| `DB_PATH` | `data/bot.db` | SQLite file (**must be on a persistent disk**) |
| `ADMIN_IDS` | — | Telegram IDs that can manage every chat |
| `MINIAPP_SHORT_NAME` | — | BotFather `/newapp` short name |
| `LINK_TTL_HOURS` | `24` | One-time link lifetime |
| `REMIND_HOURS` | `24` | Reminder before expiry |
| `SCHEDULER_SECONDS` | `30` | How often expiries are checked |
| `MAX_STARS` / `MAX_DAYS` | `10000` / `3650` | Plan limits |
| `DEV_AUTH` | `0` | **Local testing only** — `?dev=<id>` acts as that user |

### Deploy on Render

`render.yaml` is a Blueprint with a **1 GB persistent disk** for the SQLite
database (`/var/data/bot.db`). Disks need a paid plan (*starter*). On the free
plan the database is wiped on each deploy, so members would never be removed —
don't use it in production. `PUBLIC_URL` is taken from `RENDER_EXTERNAL_URL`
automatically.

## Architecture

| File | What |
|------|------|
| `server.js` | Express: Mini App, REST API, webhook, photo proxy, scheduler |
| `src/bot.js` | grammY handlers (`my_chat_member`, `chat_member`, `chat_join_request`, payments, setup buttons) |
| `src/service.js` | All business logic (setup, plans, orders, links, countdown, kick, owner panel) |
| `src/messages.js` | Bot texts and inline keyboards |
| `src/db.js` | SQLite schema (built-in `node:sqlite`, no native deps) |
| `src/auth.js` | Telegram Mini App `initData` HMAC validation |
| `public/index.html`, `app.js`, `app.css` | Mini App (Explore · My memberships · Manage) |
| `public/game/` | the previous "Hit the BOSS!" demo, now at `/game` |

**Security:** every API call is authenticated with signed Telegram `initData`
(HMAC, max age 24h). Owner endpoints check ownership. Payment amount, currency
and buyer are re-checked at `pre_checkout_query`; duplicate payment updates are
ignored by charge ID. The bot token never reaches the browser (chat photos are
proxied).

### API (all need `X-Telegram-Init-Data`)

`GET /api/me` · `GET /api/explore` · `GET /api/chats/:slug` · `GET /api/my` ·
`POST /api/orders {planId}` · `GET /api/orders/:id` ·
`POST /api/memberships/:id/link` · `GET /api/owner/chats` ·
`GET|PATCH /api/owner/chats/:slug` · `POST /api/owner/chats/:slug/refresh` ·
`POST /api/owner/chats/:slug/plans` · `PATCH|DELETE /api/owner/chats/:slug/plans/:id` ·
`POST /api/owner/chats/:slug/members/:id/kick` ·
`POST /api/owner/chats/:slug/members/:id/extend {days}` · `GET /api/admin/stats`

## Tests

`npm test` runs 23 tests. The whole flow runs against a fake Telegram API with a
fake clock: admin → owner DM → price/days → pay → one-time link → stranger
declined → join → countdown → reminder → auto-kick, plus renewals, refunds,
expired links, the owner panel, initData checks and the HTTP API.

## Notes

- Stars go to the **bot's** balance (Telegram rule). Paying out to group owners
  is outside the bot — the Manage tab shows each owner's earnings for that.
- Countdowns are stored as absolute timestamps, so restarts don't lose time;
  overdue members are removed on the next scheduler run.

## Open-source resources

Nunito (OFL) · Fluent Emoji 3D (MIT) · canvas-confetti (ISC) · grammY (MIT) ·
Express (MIT) · Telegram WebApp SDK
