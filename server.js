// Paid groups & channels for Telegram Stars — HTTP server + bot + scheduler.
//   /            Mini App (explore, buy, my memberships, owner control panel)
//   /api/*       Mini App API (auth: Telegram initData)
//   /tg/webhook  Telegram webhook (when PUBLIC_URL is set)
//   /game        the old "Hit the BOSS!" demo
import express from 'express';
import { resolve } from 'node:path';
import { webhookCallback } from 'grammy';
import { loadConfig } from './src/config.js';
import { openDb } from './src/db.js';
import { verifyInitData } from './src/auth.js';
import { createService, AppError } from './src/service.js';
import { createBot, configureBot, ALLOWED_UPDATES } from './src/bot.js';

/** Builds the express app. `api` = Telegram API (grammY Api or a fake in tests). */
export function createApp({ config, svc, bot = null, api = null }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  app.get('/api/health', (_, res) => res.json({ ok: true }));

  // Telegram webhook (secret token checked by grammY)
  if (bot && config.botMode === 'webhook') {
    app.post('/tg/webhook', express.json({ limit: '1mb' }),
      webhookCallback(bot, 'express', { secretToken: config.webhookSecret || undefined, onTimeout: 'return', timeoutMilliseconds: 9000 }));
  }

  app.get('/vendor/confetti.js', (_, res) => res.sendFile(resolve('node_modules/canvas-confetti/dist/confetti.browser.js')));

  // Public runtime config (no secrets)
  app.get('/config.js', (_, res) => {
    const cfg = {
      adsgramBlockId: process.env.ADSGRAM_BLOCK_ID || '',
      demoAdSeconds: Number(process.env.DEMO_AD_SECONDS || 5),
      botUsername: svc.botInfo.username || '',
      devAuth: config.devAuth,
    };
    res.type('application/javascript').set('Cache-Control', 'no-store');
    res.send(`window.APP_CONFIG = ${JSON.stringify(cfg)};`);
  });

  // ---------------------------------------------------------------- API
  const apiRouter = express.Router();
  apiRouter.use(express.json({ limit: '32kb' }));
  apiRouter.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const init = req.get('X-Telegram-Init-Data') || '';
    const v = verifyInitData(init, config.botToken, config.initDataMaxAge);
    if (v) { req.user = v.user; return next(); }
    if (config.devAuth && /^\d+$/.test(req.get('X-Dev-User') || '')) {
      req.user = { id: Number(req.get('X-Dev-User')), first_name: req.get('X-Dev-Name') || 'Dev' };
      return next();
    }
    res.status(401).json({ error: 'unauthorized', message: 'Please open this app from Telegram' });
  });
  const h = (fn) => async (req, res) => {
    try { res.json(await fn(req)); } catch (e) {
      if (e instanceof AppError) return res.status(e.status).json({ error: e.code, message: e.message });
      console.error('[api]', req.method, req.path, e);
      res.status(500).json({ error: 'server_error', message: e?.description || 'Something went wrong, please try again' });
    }
  };
  const uid = (req) => req.user.id;

  apiRouter.get('/me', h((req) => svc.me(req.user)));
  apiRouter.get('/explore', h(() => ({ chats: svc.explore() })));
  apiRouter.get('/chats/:slug', h((req) => svc.chatPublic(req.params.slug, uid(req))));
  apiRouter.get('/my', h((req) => ({ memberships: svc.myMemberships(uid(req)) })));
  apiRouter.post('/orders', h((req) => svc.createOrder(req.user, req.body?.planId)));
  apiRouter.get('/orders/:id', h((req) => svc.orderStatus(uid(req), req.params.id)));
  apiRouter.post('/memberships/:id/link', h(async (req) => ({ membership: (await svc.renewLink(uid(req), req.params.id)).id })));

  // Owner control panel
  apiRouter.get('/owner/chats', h((req) => ({ chats: svc.ownerChats(uid(req)) })));
  apiRouter.get('/owner/chats/:slug', h((req) => svc.ownerChatDetail(uid(req), req.params.slug)));
  apiRouter.patch('/owner/chats/:slug', h((req) => svc.updateChat(uid(req), req.params.slug, req.body)));
  apiRouter.post('/owner/chats/:slug/refresh', h((req) => svc.refreshChat(uid(req), req.params.slug)));
  apiRouter.post('/owner/chats/:slug/plans', h((req) => svc.savePlan(uid(req), req.params.slug, req.body)));
  apiRouter.patch('/owner/chats/:slug/plans/:id', h((req) => svc.savePlan(uid(req), req.params.slug, req.body, req.params.id)));
  apiRouter.delete('/owner/chats/:slug/plans/:id', h((req) => svc.deletePlan(uid(req), req.params.slug, req.params.id)));
  apiRouter.post('/owner/chats/:slug/members/:id/kick', h((req) => svc.kickMember(uid(req), req.params.slug, req.params.id)));
  apiRouter.post('/owner/chats/:slug/members/:id/extend', h((req) => svc.extendMember(uid(req), req.params.slug, req.params.id, req.body?.days)));
  apiRouter.get('/admin/stats', h((req) => { if (!config.adminIds.includes(uid(req))) throw new AppError(403, 'forbidden'); return svc.globalStats(); }));
  app.use('/api', apiRouter);

  // Group / channel photo (proxied so the bot token never reaches the browser)
  const photoCache = new Map();
  app.get('/photo/:slug', async (req, res) => {
    const chat = svc.getChatBySlug(req.params.slug);
    if (!chat?.photo_file_id || !api) return res.status(404).end();
    try {
      let hit = photoCache.get(chat.photo_file_id);
      if (!hit) {
        const file = await api.getFile(chat.photo_file_id);
        const r = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
        if (!r.ok) return res.status(404).end();
        hit = { type: r.headers.get('content-type') || 'image/jpeg', body: Buffer.from(await r.arrayBuffer()) };
        if (photoCache.size > 300) photoCache.clear();
        photoCache.set(chat.photo_file_id, hit);
      }
      res.type(hit.type).set('Cache-Control', 'public, max-age=3600').send(hit.body);
    } catch { res.status(404).end(); }
  });

  app.use(express.static('public', { extensions: ['html'], maxAge: '1h' }));
  app.get('/game{/*path}', (_, res) => res.sendFile(resolve('public/game/index.html')));
  app.get('*path', (_, res) => res.sendFile(resolve('public/index.html')));
  return app;
}

// --------------------------------------------------------------- startup
async function main() {
  const config = loadConfig();
  const db = await openDb(config.dbPath);
  let bot = null, svc, api = null;

  if (config.botToken) {
    ({ bot, svc } = createBot(config, (a) => createService({ db, api: a, config })));
    api = bot.api;
    try {
      const me = await bot.api.getMe();
      svc.setBotInfo(me);
      await bot.init();
      console.log(`[bot] @${me.username}`);
    } catch (e) { console.error('[bot] getMe failed:', e.description || e.message); }
  } else {
    console.warn('[bot] BOT_TOKEN is not set — running the Mini App only (bot disabled).');
    svc = createService({ db, api: new Proxy({}, { get: () => async () => { throw new Error('bot disabled'); } }), config });
  }

  const app = createApp({ config, svc, bot, api });
  app.listen(config.port, '0.0.0.0', () => console.log(`[http] listening on ${config.port}`));

  if (bot && svc.botInfo.id) {
    await configureBot(bot, config);
    if (config.botMode === 'webhook') {
      await bot.api.setWebhook(`${config.publicUrl}/tg/webhook`, {
        allowed_updates: ALLOWED_UPDATES, secret_token: config.webhookSecret || undefined, drop_pending_updates: false,
      }).then(() => console.log(`[bot] webhook → ${config.publicUrl}/tg/webhook`))
        .catch((e) => console.error('[bot] setWebhook failed:', e.description || e.message));
    } else {
      await bot.api.deleteWebhook().catch(() => {});
      bot.start({ allowed_updates: ALLOWED_UPDATES, onStart: () => console.log('[bot] long polling started') })
        .catch((e) => console.error('[bot] polling stopped:', e.description || e.message));
    }
    // Countdown scheduler: removes expired members, sends reminders
    const run = () => svc.tick().then((r) => { if (r.expired || r.reminded) console.log('[tick]', r); });
    setTimeout(run, 3000);
    setInterval(run, config.schedulerSeconds * 1000).unref?.();
  }

  const stop = () => { bot?.isRunning?.() && bot.stop(); db.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
