// Bot texts + inline keyboards (HTML parse mode).
export const DAY = 86_400_000;
export const PRICE_PRESETS = [25, 50, 100, 250, 500, 1000];
export const DAY_PRESETS = [1, 7, 15, 30, 90, 365];

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');
export const plural = (n, w) => `${fmtNum(n)} ${w}${Number(n) === 1 ? '' : 's'}`;
export const kindOf = (chat) => (chat.type === 'channel' ? 'channel' : 'group');

export function fmtDate(ms) {
  const d = new Date(ms);
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function fmtLeft(ms) {
  if (ms <= 0) return '0m';
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

/** Builds buttons that open the Mini App (only possible with an https URL). */
export function makeLinks(config, botUsername) {
  const https = /^https:\/\//.test(config.publicUrl);
  const app = (path = '') => (https ? `${config.publicUrl}/${path}` : '');
  const share = (slug) => (botUsername ? `https://t.me/${botUsername}?start=c_${slug}` : '');
  const direct = (slug) => (botUsername && config.miniAppShortName
    ? `https://t.me/${botUsername}/${config.miniAppShortName}?startapp=c_${slug}` : share(slug));
  const webBtn = (text, path) => (https ? { text, web_app: { url: app(path) } } : null);
  return {
    app, share, direct, webBtn,
    addToGroup: botUsername ? `https://t.me/${botUsername}?startgroup=setup&admin=invite_users+restrict_members+delete_messages` : '',
    addToChannel: botUsername ? `https://t.me/${botUsername}?startchannel=setup&admin=invite_users+restrict_members+post_messages` : '',
  };
}

const rows = (...r) => ({ inline_keyboard: r.map((x) => x.filter(Boolean)).filter((x) => x.length) });

// ---------- Owner setup flow ----------
export function connectedText(chat, plans = []) {
  const k = kindOf(chat);
  const head = `✅ <b>Connected!</b>\nI'm now admin in your ${k} <b>${esc(chat.title)}</b>.`;
  if (plans.length) return `${head}\n\nYou already have ${plural(plans.length, 'plan')} — sales are live again. 🚀`;
  return `${head}\n\n<b>Step 1/2</b> — How many ⭐ <b>Telegram Stars</b> should a membership cost?`;
}

export function priceKeyboard(slug, L) {
  const b = PRICE_PRESETS.map((s) => ({ text: `⭐ ${fmtNum(s)}`, callback_data: `pp:${slug}:${s}` }));
  return rows(b.slice(0, 3), b.slice(3, 6),
    [{ text: '✏️ Custom price', callback_data: `pc:${slug}` }],
    [L.webBtn('⚙️ Open control panel', `?manage=${slug}`)]);
}

export function daysText(chat, stars) {
  return `<b>${esc(chat.title)}</b>\nPrice: <b>⭐ ${fmtNum(stars)}</b>\n\n<b>Step 2/2</b> — For how many <b>days</b> will a member get access?\n<i>The countdown starts when the member joins.</i>`;
}

export function daysKeyboard(slug, stars) {
  const b = DAY_PRESETS.map((d) => ({ text: plural(d, 'day'), callback_data: `pd:${slug}:${stars}:${d}` }));
  return rows(b.slice(0, 3), b.slice(3, 6),
    [{ text: '✏️ Custom days', callback_data: `dc:${slug}:${stars}` }],
    [{ text: '« Change price', callback_data: `pb:${slug}` }]);
}

export function planCreatedText(chat, plan, plans, L) {
  const list = plans.map((p) => `• ${plural(p.days, 'day')} — ⭐ ${fmtNum(p.stars)}`).join('\n');
  const link = L.direct(chat.slug);
  return `🎉 <b>Plan created!</b>\n<b>${esc(chat.title)}</b>: ${plural(plan.days, 'day')} for ⭐ ${fmtNum(plan.stars)}\n\n<b>Your plans</b>\n${list}\n\n`
    + `Share this link — people buy the membership in the Mini App, I send them a <b>one-time invite link</b> and remove them when their time is over.`
    + (link ? `\n\n🔗 ${esc(link)}` : '');
}

export function planCreatedKeyboard(chat, L) {
  const link = L.direct(chat.slug);
  return rows(
    [{ text: '➕ Add another plan', callback_data: `pa:${chat.slug}` }],
    [L.webBtn('⚙️ Control panel', `?manage=${chat.slug}`)],
    [link ? { text: '📤 Share', url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`Join ${chat.title} with Telegram Stars ⭐`)}` } : null],
  );
}

export function noRightsText(chat) {
  return `⚠️ <b>${esc(chat.title)}</b>\nI need to be an <b>admin</b> with these rights:\n• <b>Invite users via link</b> — to create one-time links\n• <b>Ban users</b> — to remove members when time is over\n\nPlease update my admin rights, I'll notice it automatically.`;
}

export function removedText(chat) {
  return `🚫 I was removed from <b>${esc(chat.title)}</b>. Sales are paused.\nAdd me back as admin any time — your plans and members are saved.`;
}

// ---------- Member messages ----------
export function joinText(chat, mem, cfg) {
  return `✅ <b>Payment received!</b>\n\n<b>${esc(chat.title)}</b> — ${plural(mem.days, 'day')} membership.\n\n`
    + `Tap the button below to join. This is a <b>one-time link</b> just for you (valid ${plural(cfg.linkTtlHours, 'hour')}).\n`
    + `⏳ Your ${plural(mem.days, 'day')} start <b>when you join</b>.`;
}
export const joinKeyboard = (link, L) => rows([{ text: '🚀 Join now', url: link }], [L.webBtn('📋 My memberships', '?tab=my')]);

export function welcomeText(chat, mem) {
  return `🎉 <b>Welcome to ${esc(chat.title)}!</b>\n\nYour countdown has started: <b>${plural(mem.days, 'day')}</b>.\nAccess ends on <b>${fmtDate(mem.expires_at)}</b>.\nYou can check the time left any time in the Mini App.`;
}

export function extendedText(chat, mem, days) {
  return `✅ <b>Renewed!</b> +${plural(days, 'day')} for <b>${esc(chat.title)}</b>.\n`
    + (mem.expires_at ? `New end date: <b>${fmtDate(mem.expires_at)}</b>.` : `Total: <b>${plural(mem.days, 'day')}</b> — starts when you join.`);
}

export function reminderText(chat, mem, now) {
  return `⏰ Your membership in <b>${esc(chat.title)}</b> ends in <b>${fmtLeft(mem.expires_at - now)}</b> (${fmtDate(mem.expires_at)}).\nRenew now to keep your access.`;
}

export function expiredText(chat) {
  return `⌛ Your membership in <b>${esc(chat.title)}</b> has ended and you were removed.\nYou can buy a new membership any time. 💛`;
}

export const renewKeyboard = (chat, L) => rows([L.webBtn('⭐ Renew membership', `?c=${chat.slug}`)]);
