// Runtime configuration (all from environment variables).
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

export function loadConfig(env = process.env) {
  const publicUrl = String(env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  return {
    port: num(env.PORT, 3000),
    botToken: env.BOT_TOKEN || '',
    publicUrl,
    // webhook (when PUBLIC_URL is set) or long polling
    botMode: env.BOT_MODE || (publicUrl ? 'webhook' : 'polling'),
    webhookSecret: env.WEBHOOK_SECRET || '',
    dbPath: env.DB_PATH || 'data/bot.db',
    adminIds: list(env.ADMIN_IDS).map(Number),
    miniAppShortName: env.MINIAPP_SHORT_NAME || '', // from BotFather /newapp (optional)
    // one-time invite link lifetime (hours) — user must join within this window
    linkTtlHours: num(env.LINK_TTL_HOURS, 24),
    // send "membership ends soon" reminder this many hours before expiry
    remindHours: num(env.REMIND_HOURS, 24),
    schedulerSeconds: num(env.SCHEDULER_SECONDS, 30),
    minStars: 1,
    maxStars: num(env.MAX_STARS, 10000),
    maxDays: num(env.MAX_DAYS, 3650),
    // dev only: allow `X-Dev-User: <id>` instead of Telegram initData
    devAuth: env.DEV_AUTH === '1',
    initDataMaxAge: num(env.INIT_DATA_MAX_AGE, 86400),
  };
}
