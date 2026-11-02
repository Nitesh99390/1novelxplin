// Core business logic: connecting chats, plans, Stars payments,
// one-time invite links, countdowns and automatic removal.
// Everything Telegram-related goes through `api` (grammY Api or a fake in tests).
import { randomBytes } from 'node:crypto';
import * as M from './messages.js';

const { DAY } = M;
const HOUR = 3_600_000;
const MAX_PLANS = 10;

export class AppError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new AppError(status, code, message); };
const tgErr = (e) => String(e?.description || e?.message || e);
const sec = (ms) => Math.floor(ms / 1000);
const newSlug = () => randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);
const newOrderId = () => `o${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;
const isInt = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const displayName = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(' ') || (u?.username ? `@${u.username}` : `User ${u?.id ?? ''}`);
const IN_CHAT = new Set(['creator', 'administrator', 'member']);

export function createService({ db, api, config, now = () => Date.now(), log = console }) {
  let botInfo = { id: 0, username: '' };
  const L = () => M.makeLinks(config, botInfo.username);

  // ------------------------------------------------------------------ helpers
  async function send(userId, text, reply_markup) {
    try {
      await api.sendMessage(userId, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(reply_markup ? { reply_markup } : {}) });
      return true;
    } catch (e) {
      log.warn?.(`[send] ${userId}: ${tgErr(e)}`);
      return false;
    }
  }

  const getChat = (id) => db.get('SELECT * FROM chats WHERE id = ?', id);
  const getChatBySlug = (slug) => db.get('SELECT * FROM chats WHERE slug = ?', String(slug || ''));
  const getUser = (id) => db.get('SELECT * FROM users WHERE id = ?', id);
  const getMembership = (id) => db.get('SELECT * FROM memberships WHERE id = ?', id);
  const activePlans = (chatId) => db.all('SELECT * FROM plans WHERE chat_id = ? AND deleted = 0 AND active = 1 ORDER BY days, stars', chatId);
  const allPlans = (chatId) => db.all('SELECT * FROM plans WHERE chat_id = ? AND deleted = 0 ORDER BY days, stars', chatId);
  const isAdmin = (userId) => config.adminIds.includes(Number(userId));
  const canSell = (chat) => chat && chat.status === 'active' && chat.sales_enabled;

  function upsertUser(u, { started = false } = {}) {
    if (!u?.id || u.is_bot) return;
    const t = now();
    db.run(`INSERT INTO users (id, first_name, last_name, username, language_code, started_bot, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
              username = excluded.username, language_code = COALESCE(excluded.language_code, users.language_code),
              started_bot = MAX(users.started_bot, excluded.started_bot), updated_at = excluded.updated_at`,
    u.id, u.first_name || '', u.last_name || '', u.username || null, u.language_code || null, started ? 1 : 0, t, t);
  }

  function ownedChat(userId, slug) {
    const chat = getChatBySlug(slug);
    if (!chat) fail(404, 'chat_not_found', 'Group / channel not found');
    if (chat.owner_id !== Number(userId) && !isAdmin(userId)) fail(403, 'not_owner', 'Only the owner can manage this');
    return chat;
  }

  function rightsOf(member) {
    const admin = member?.status === 'administrator' || member?.status === 'creator';
    return { admin, invite: admin && !!member.can_invite_users, restrict: admin && !!member.can_restrict_members };
  }
  // Groups need "invite via link" + "ban users"; channels only need "add subscribers".
  const rightsOk = (type, r) => r.invite && (type === 'channel' || r.restrict);

  // ------------------------------------------------------------- chat setup
  async function resolveOwner(chat, from) {
    if (from && !from.is_bot) return from;
    try { // anonymous admin → fall back to the creator
      const admins = await api.getChatAdministrators(chat.id);
      return admins.find((a) => a.status === 'creator' && !a.user.is_bot)?.user || null;
    } catch { return null; }
  }

  /** my_chat_member: bot was added / promoted / restricted / removed. */
  async function onMyChatMember(upd) {
    const { chat, from } = upd;
    if (!chat || chat.type === 'private') return null;
    const member = upd.new_chat_member;
    const r = rightsOf(member);
    const gone = member.status === 'left' || member.status === 'kicked';
    const status = gone ? 'removed' : rightsOk(chat.type, r) ? 'active' : 'no_rights';
    const t = now();
    let row = getChat(chat.id);
    const prevStatus = row?.status;

    if (!row) {
      if (gone) return null;
      const owner = await resolveOwner(chat, from);
      if (!owner) { log.warn?.(`[chat] ${chat.id}: no owner found`); return null; }
      upsertUser(owner);
      db.run(`INSERT INTO chats (id, slug, type, title, username, owner_id, status, can_invite, can_restrict, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      chat.id, newSlug(), chat.type, chat.title || 'Untitled', chat.username || null, owner.id, status, +r.invite, +r.restrict, t, t);
    } else {
      let ownerId = row.owner_id;
      // Re-added by somebody else: the chat creator takes over ownership.
      if (!gone && from && !from.is_bot && from.id !== row.owner_id) {
        try { if ((await api.getChatMember(chat.id, from.id)).status === 'creator') { ownerId = from.id; upsertUser(from); } } catch {}
      }
      db.run(`UPDATE chats SET type = ?, title = ?, username = ?, status = ?, can_invite = ?, can_restrict = ?, owner_id = ?, updated_at = ? WHERE id = ?`,
        chat.type, chat.title || row.title, chat.username || null, status, +r.invite, +r.restrict, ownerId, t, chat.id);
    }
    row = getChat(chat.id);
    if (!gone) await refreshInfo(row).catch(() => {});

    if (status === prevStatus) return row;
    if (status === 'active') await sendOwnerSetup(row);
    else if (status === 'no_rights') await send(row.owner_id, M.noRightsText(row));
    else if (status === 'removed' && prevStatus) await send(row.owner_id, M.removedText(row));
    return getChat(chat.id);
  }

  /** DM to the owner with price buttons (or a "start the bot" hint if DM is impossible). */
  async function sendOwnerSetup(chat) {
    const plans = activePlans(chat.id);
    const kb = plans.length ? M.planCreatedKeyboard(chat, L()) : M.priceKeyboard(chat.slug, L());
    const text = plans.length ? M.connectedText(chat, plans) + '\n\n' + M.planCreatedText(chat, plans[0], plans, L()).split('\n\n').slice(1).join('\n\n') : M.connectedText(chat, plans);
    const ok = await send(chat.owner_id, text, kb);
    db.run('UPDATE chats SET owner_notified = ? WHERE id = ?', ok ? 1 : 0, chat.id);
    if (!ok && chat.type !== 'channel' && botInfo.username) {
      await api.sendMessage(chat.id, `👋 Thanks for adding me!\nTo set the membership price, the owner needs to open a private chat with me.`, {
        reply_markup: { inline_keyboard: [[{ text: '⚙️ Set up membership', url: `https://t.me/${botInfo.username}?start=own_${chat.slug}` }]] },
      }).catch(() => {});
    }
    return ok;
  }

  /** Re-reads title, description, photo, member count and bot rights. */
  async function refreshInfo(chat) {
    const info = await api.getChat(chat.id);
    let count = chat.member_count;
    try { count = await api.getChatMemberCount(chat.id); } catch {}
    db.run(`UPDATE chats SET title = ?, username = ?, description = COALESCE(description, ?), photo_file_id = ?, member_count = ?, updated_at = ? WHERE id = ?`,
      info.title || chat.title, info.username || null, info.description || null, info.photo?.small_file_id || null, count ?? null, now(), chat.id);
  }

  // ---------------------------------------------------------- owner (bot)
  /** /start in private chat. */
  async function onStart(from, payload = '') {
    upsertUser(from, { started: true });
    const links = L();
    if (payload.startsWith('c_')) {
      const chat = getChatBySlug(payload.slice(2));
      if (chat && canSell(chat)) {
        const plans = activePlans(chat.id);
        const list = plans.map((p) => `• ${M.plural(p.days, 'day')} — ⭐ ${M.fmtNum(p.stars)}`).join('\n');
        return send(from.id, `⭐ <b>${M.esc(chat.title)}</b>\n${chat.description ? M.esc(chat.description).slice(0, 300) + '\n' : ''}\n<b>Membership plans</b>\n${list || 'No plans yet'}\n\nTap below to choose a plan and pay with Telegram Stars.`,
          { inline_keyboard: [[links.webBtn('⭐ Get membership', `?c=${chat.slug}`)].filter(Boolean)] });
      }
      return send(from.id, 'This membership is not available right now.');
    }
    // Deliver setup messages that could not be sent before the owner started the bot.
    const pending = db.all("SELECT * FROM chats WHERE owner_id = ? AND owner_notified = 0 AND status = 'active'", from.id);
    for (const chat of pending) await sendOwnerSetup(chat);
    if (pending.length) return true;
    if (payload.startsWith('own_')) {
      const chat = getChatBySlug(payload.slice(4));
      if (chat && chat.owner_id === from.id) return sendOwnerSetup(chat);
    }
    return send(from.id,
      `👋 <b>Hi ${M.esc(from.first_name || '')}!</b>\n\nI sell access to <b>paid groups & channels</b> for ⭐ <b>Telegram Stars</b>.\n\n`
      + `<b>For owners</b>\n1. Add me as <b>admin</b> to your group or channel\n2. I'll DM you here — pick the price & days\n3. Share your link — I handle payments, one-time invite links and remove members when their time is over\n\n`
      + `<b>For members</b>\nOpen the Mini App, choose a group and pay with Stars.`,
      { inline_keyboard: [
        [links.webBtn('🚀 Open Mini App', '')].filter(Boolean),
        [links.addToGroup && { text: '➕ Add to group', url: links.addToGroup }, links.addToChannel && { text: '📢 Add to channel', url: links.addToChannel }].filter(Boolean),
      ].filter((r) => r.length) });
  }

  function setPending(userId, value) {
    db.run('UPDATE users SET pending_input = ? WHERE id = ?', value ? JSON.stringify(value) : null, userId);
  }

  function addPlan(chat, days, stars, title = null) {
    if (!isInt(days, 1, config.maxDays)) fail(400, 'bad_days', `Days must be 1–${config.maxDays}`);
    if (!isInt(stars, config.minStars, config.maxStars)) fail(400, 'bad_stars', `Price must be ${config.minStars}–${config.maxStars} stars`);
    const same = db.get('SELECT * FROM plans WHERE chat_id = ? AND days = ? AND deleted = 0', chat.id, days);
    if (same) {
      db.run('UPDATE plans SET stars = ?, active = 1, title = COALESCE(?, title) WHERE id = ?', stars, title, same.id);
      return db.get('SELECT * FROM plans WHERE id = ?', same.id);
    }
    if (allPlans(chat.id).length >= MAX_PLANS) fail(400, 'too_many_plans', `Max ${MAX_PLANS} plans`);
    const r = db.run('INSERT INTO plans (chat_id, title, days, stars, created_at) VALUES (?, ?, ?, ?, ?)', chat.id, title, days, stars, now());
    return db.get('SELECT * FROM plans WHERE id = ?', Number(r.lastInsertRowid));
  }

  /** Inline buttons of the setup DM. Returns { text, reply_markup } to edit the message, or { toast }. */
  async function onCallback(from, data) {
    upsertUser(from, { started: true });
    const [cmd, ...a] = String(data).split(':');
    const links = L();
    if (cmd === 'nl') { // member: new invite link
      try { const m = await renewLink(from.id, Number(a[0])); return { toast: 'New link sent ✅', silent: !!m }; } catch (e) { return { toast: e.message, alert: true }; }
    }
    const chat = getChatBySlug(a[0]);
    if (!chat) return { toast: 'Chat not found', alert: true };
    if (chat.owner_id !== from.id && !isAdmin(from.id)) return { toast: 'Only the owner can do this', alert: true };
    switch (cmd) {
      case 'pa': case 'pb':
        setPending(from.id, null);
        return { text: `<b>${M.esc(chat.title)}</b>\nHow many ⭐ <b>Telegram Stars</b> should a membership cost?`, reply_markup: M.priceKeyboard(chat.slug, links) };
      case 'pp': {
        const stars = Number(a[1]);
        if (!isInt(stars, config.minStars, config.maxStars)) return { toast: 'Invalid price', alert: true };
        return { text: M.daysText(chat, stars), reply_markup: M.daysKeyboard(chat.slug, stars) };
      }
      case 'pc':
        setPending(from.id, { t: 'price', slug: chat.slug });
        return { text: `<b>${M.esc(chat.title)}</b>\n✏️ Send me the price in ⭐ Stars (${config.minStars}–${M.fmtNum(config.maxStars)}), e.g. <code>150</code>`, reply_markup: { inline_keyboard: [[{ text: '« Back', callback_data: `pb:${chat.slug}` }]] } };
      case 'dc':
        setPending(from.id, { t: 'days', slug: chat.slug, stars: Number(a[1]) });
        return { text: `<b>${M.esc(chat.title)}</b> — ⭐ ${M.fmtNum(a[1])}\n✏️ Send me the number of days (1–${config.maxDays}), e.g. <code>45</code>`, reply_markup: { inline_keyboard: [[{ text: '« Back', callback_data: `pp:${chat.slug}:${a[1]}` }]] } };
      case 'pd': {
        try {
          const plan = addPlan(chat, Number(a[2]), Number(a[1]));
          setPending(from.id, null);
          return { text: M.planCreatedText(chat, plan, activePlans(chat.id), links), reply_markup: M.planCreatedKeyboard(chat, links), toast: 'Plan saved ✅' };
        } catch (e) { return { toast: e.message, alert: true }; }
      }
      default: return { toast: 'Unknown action' };
    }
  }

  /** Free text in private chat (custom price / days). Returns reply or null. */
  function onText(from, text) {
    const u = getUser(from.id);
    if (!u?.pending_input) return null;
    let p; try { p = JSON.parse(u.pending_input); } catch { setPending(from.id, null); return null; }
    const chat = getChatBySlug(p.slug);
    if (!chat || (chat.owner_id !== from.id && !isAdmin(from.id))) { setPending(from.id, null); return null; }
    const n = Number(String(text).trim().replace(/[\s,⭐]/g, ''));
    if (p.t === 'price') {
      if (!isInt(n, config.minStars, config.maxStars)) return { text: `Please send a whole number between ${config.minStars} and ${M.fmtNum(config.maxStars)}.` };
      setPending(from.id, null);
      return { text: M.daysText(chat, n), reply_markup: M.daysKeyboard(chat.slug, n) };
    }
    if (p.t === 'days') {
      if (!isInt(n, 1, config.maxDays)) return { text: `Please send a whole number of days between 1 and ${config.maxDays}.` };
      const plan = addPlan(chat, n, p.stars);
      setPending(from.id, null);
      return { text: M.planCreatedText(chat, plan, activePlans(chat.id), L()), reply_markup: M.planCreatedKeyboard(chat, L()) };
    }
    setPending(from.id, null);
    return null;
  }

  // -------------------------------------------------------------- payments
  async function createOrder(user, planId) {
    upsertUser(user);
    const plan = db.get('SELECT * FROM plans WHERE id = ? AND deleted = 0 AND active = 1', Number(planId));
    if (!plan) fail(404, 'plan_not_found', 'This plan is not available');
    const chat = getChat(plan.chat_id);
    if (!canSell(chat)) fail(409, 'sales_closed', 'Sales are paused for this group');
    if (chat.owner_id === user.id) fail(409, 'owner', "You own this group — you don't need a membership");
    const id = newOrderId();
    const kind = M.kindOf(chat);
    const link = await api.createInvoiceLink(
      chat.title.slice(0, 32),
      `${M.plural(plan.days, 'day')} membership in the ${kind} "${chat.title}". Your one-time invite link arrives right after payment.`.slice(0, 255),
      id, '', 'XTR', [{ label: `${M.plural(plan.days, 'day')} access`, amount: plan.stars }],
    );
    db.run('INSERT INTO orders (id, user_id, chat_id, plan_id, days, stars, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, user.id, chat.id, plan.id, plan.days, plan.stars, now());
    return { orderId: id, invoiceLink: link, stars: plan.stars, days: plan.days };
  }

  /** pre_checkout_query → { ok, error } */
  function onPreCheckout(q) {
    const order = db.get('SELECT * FROM orders WHERE id = ?', q.invoice_payload);
    if (!order || order.status !== 'pending') return { ok: false, error: 'This order is no longer valid. Please try again from the Mini App.' };
    if (order.user_id !== q.from.id || q.currency !== 'XTR' || q.total_amount !== order.stars) return { ok: false, error: 'Order mismatch. Please try again.' };
    if (!canSell(getChat(order.chat_id))) return { ok: false, error: 'Sales are paused for this group right now.' };
    return { ok: true };
  }

  /** successful_payment → grants / extends membership and sends the one-time link. */
  async function onSuccessfulPayment(from, sp) {
    upsertUser(from, { started: true });
    if (db.get('SELECT id FROM orders WHERE charge_id = ?', sp.telegram_payment_charge_id)) return null; // duplicate update
    const order = db.get('SELECT * FROM orders WHERE id = ?', sp.invoice_payload);
    if (!order) { log.error?.(`[pay] unknown order ${sp.invoice_payload}`); return null; }
    const chat = getChat(order.chat_id);
    const t = now();

    // Existing paid/active membership in this chat → extend it.
    const cur = db.get("SELECT * FROM memberships WHERE user_id = ? AND chat_id = ? AND status IN ('paid','active') ORDER BY id DESC LIMIT 1", from.id, chat.id);
    const memId = db.tx(() => {
      let id;
      if (cur) {
        id = cur.id;
        db.run(`UPDATE memberships SET days = days + ?, reminded = 0,
                expires_at = CASE WHEN status = 'active' THEN expires_at + ? ELSE expires_at END WHERE id = ?`, order.days, order.days * DAY, id);
      } else {
        id = Number(db.run("INSERT INTO memberships (user_id, chat_id, plan_id, days, status, paid_at, created_at) VALUES (?, ?, ?, ?, 'paid', ?, ?)",
          from.id, chat.id, order.plan_id, order.days, t, t).lastInsertRowid);
      }
      db.run("UPDATE orders SET status = 'paid', charge_id = ?, paid_at = ?, membership_id = ? WHERE id = ?", sp.telegram_payment_charge_id, t, id, order.id);
      return id;
    });

    let mem = getMembership(memId);
    if (cur?.status === 'active') { await send(from.id, M.extendedText(chat, mem, order.days), M.renewKeyboard(chat, L())); return mem; }
    if (cur?.status === 'paid' && cur.link_expires_at > t + HOUR) {
      await send(from.id, M.extendedText(chat, mem, order.days) + '\n\n' + M.joinText(chat, mem, config), M.joinKeyboard(mem.invite_link, L()));
      return mem;
    }

    // Already inside the chat (e.g. was a free member)? Start the countdown right away.
    try {
      const cm = await api.getChatMember(chat.id, from.id);
      if (IN_CHAT.has(cm.status) || (cm.status === 'restricted' && cm.is_member)) {
        mem = activate(mem);
        await send(from.id, M.welcomeText(chat, mem), M.renewKeyboard(chat, L()));
        return mem;
      }
      if (cm.status === 'kicked') await api.unbanChatMember(chat.id, from.id, { only_if_banned: true });
    } catch {}

    try {
      mem = await issueLink(mem, chat);
      await send(from.id, M.joinText(chat, mem, config), M.joinKeyboard(mem.invite_link, L()));
    } catch (e) {
      log.error?.(`[pay] link failed for ${chat.id}: ${tgErr(e)} — refunding`);
      await refund(order, mem, from.id, chat);
    }
    return getMembership(memId);
  }

  async function refund(order, mem, userId, chat) {
    try {
      await api.refundStarPayment(userId, (db.get('SELECT charge_id FROM orders WHERE id = ?', order.id)).charge_id);
      db.run("UPDATE orders SET status = 'refunded' WHERE id = ?", order.id);
      if (mem && mem.days <= order.days) db.run("UPDATE memberships SET status = 'removed', end_reason = 'refunded', ended_at = ? WHERE id = ?", now(), mem.id);
      else if (mem) db.run('UPDATE memberships SET days = days - ? WHERE id = ?', order.days, mem.id);
      await send(userId, `😔 Sorry, I couldn't create an invite link for <b>${M.esc(chat.title)}</b> (the bot lost its admin rights). Your ⭐ ${M.fmtNum(order.stars)} were refunded.`);
      await send(chat.owner_id, `⚠️ A purchase in <b>${M.esc(chat.title)}</b> was refunded because I couldn't create an invite link. Please check my admin rights.`);
    } catch (e) { log.error?.(`[refund] ${order.id}: ${tgErr(e)}`); }
  }

  /** Personal one-time link: join-request based, so only the buyer can use it. */
  async function issueLink(mem, chat) {
    if (mem.invite_link) await api.revokeChatInviteLink(chat.id, mem.invite_link).catch(() => {});
    const exp = now() + config.linkTtlHours * HOUR;
    const user = getUser(mem.user_id);
    const link = await api.createChatInviteLink(chat.id, {
      name: `#${mem.id} ${displayName(user)}`.slice(0, 32),
      expire_date: sec(exp),
      creates_join_request: true,
    });
    db.run('UPDATE memberships SET invite_link = ?, link_expires_at = ? WHERE id = ?', link.invite_link, exp, mem.id);
    return getMembership(mem.id);
  }

  async function renewLink(userId, memId) {
    const mem = getMembership(memId);
    if (!mem || mem.user_id !== Number(userId)) fail(404, 'not_found', 'Membership not found');
    if (mem.status !== 'paid') fail(409, 'already_joined', mem.status === 'active' ? 'You already joined 🎉' : 'This membership has ended');
    const chat = getChat(mem.chat_id);
    if (!chat || chat.status !== 'active') fail(409, 'chat_unavailable', 'The group is unavailable right now, try again later');
    const m = await issueLink(mem, chat);
    await send(userId, M.joinText(chat, m, config), M.joinKeyboard(m.invite_link, L()));
    return m;
  }

  /** Starts the countdown (status → active). */
  function activate(mem) {
    const t = now();
    db.run("UPDATE memberships SET status = 'active', joined_at = ?, expires_at = ?, in_chat = 1, reminded = 0 WHERE id = ? AND status = 'paid'", t, t + mem.days * DAY, mem.id);
    return getMembership(mem.id);
  }

  // ---------------------------------------------------- joins & leaves
  /** chat_join_request: approve the buyer, decline anyone using someone else's link. */
  async function onJoinRequest(req) {
    const chat = getChat(req.chat.id);
    if (!chat) return null;
    const link = req.invite_link?.invite_link || '';
    const ours = req.invite_link?.creator?.id === botInfo.id || (link && db.get('SELECT id FROM memberships WHERE invite_link = ?', link));
    const mem = db.get("SELECT * FROM memberships WHERE chat_id = ? AND user_id = ? AND status IN ('paid','active') ORDER BY id DESC LIMIT 1", chat.id, req.from.id);
    if (!mem) {
      if (!ours) return null; // owner's own approval links — not our business
      await api.declineChatJoinRequest(chat.id, req.from.id).catch(() => {});
      upsertUser(req.from);
      await send(req.user_chat_id || req.from.id, `🔒 That invite link belongs to someone else.\nGet your own membership for <b>${M.esc(chat.title)}</b>:`, M.renewKeyboard(chat, L()));
      return { declined: true };
    }
    try { await api.approveChatJoinRequest(chat.id, req.from.id); } catch (e) {
      if (!/USER_ALREADY_PARTICIPANT/i.test(tgErr(e))) { log.warn?.(`[join] approve failed: ${tgErr(e)}`); return null; }
    }
    return joined(chat, mem);
  }

  async function joined(chat, mem) {
    if (mem.status === 'active') { db.run('UPDATE memberships SET in_chat = 1 WHERE id = ?', mem.id); return { rejoined: true, membership: getMembership(mem.id) }; }
    const m = activate(mem);
    if (m.invite_link) api.revokeChatInviteLink(chat.id, m.invite_link).catch(() => {});
    await send(m.user_id, M.welcomeText(chat, m), M.renewKeyboard(chat, L()));
    return { approved: true, membership: m };
  }

  /** chat_member: someone joined / left. */
  async function onChatMember(upd) {
    const chat = getChat(upd.chat.id);
    const user = upd.new_chat_member?.user;
    if (!chat || !user || user.is_bot) return null;
    const isIn = (m) => IN_CHAT.has(m?.status) || (m?.status === 'restricted' && m.is_member);
    const was = isIn(upd.old_chat_member), now_ = isIn(upd.new_chat_member);
    if (was === now_) return null;
    const mem = db.get("SELECT * FROM memberships WHERE chat_id = ? AND user_id = ? AND status IN ('paid','active') ORDER BY id DESC LIMIT 1", chat.id, user.id);
    if (!mem) return null;
    if (now_) { upsertUser(user); return joined(chat, mem); }
    db.run('UPDATE memberships SET in_chat = 0 WHERE id = ?', mem.id); // countdown keeps running
    return { left: true };
  }

  // ------------------------------------------------------------ scheduler
  async function kick(chatId, userId) {
    await api.banChatMember(chatId, userId, { until_date: sec(now()) + 60 });
    await api.unbanChatMember(chatId, userId, { only_if_banned: true }).catch(() => {}); // allow re-joining after renewal
  }

  async function endMembership(mem, reason) {
    const chat = getChat(mem.chat_id);
    let note = null;
    if (chat && chat.status !== 'removed') {
      try { await kick(chat.id, mem.user_id); } catch (e) { note = tgErr(e); log.warn?.(`[kick] ${chat.id}/${mem.user_id}: ${note}`); }
    }
    if (mem.invite_link && chat) api.revokeChatInviteLink(chat.id, mem.invite_link).catch(() => {});
    db.run('UPDATE memberships SET status = ?, ended_at = ?, end_reason = ?, in_chat = 0 WHERE id = ?',
      reason === 'expired' ? 'expired' : 'removed', now(), note ? `${reason}: ${note}`.slice(0, 200) : reason, mem.id);
    if (chat) await send(mem.user_id, reason === 'expired' ? M.expiredText(chat) : `🚫 Your membership in <b>${M.esc(chat.title)}</b> was ended by the owner.`, M.renewKeyboard(chat, L()));
    return { kicked: !note, error: note };
  }

  let ticking = false;
  async function tick() {
    if (ticking) return { skipped: true };
    ticking = true;
    const res = { expired: 0, reminded: 0 };
    try {
      const t = now();
      for (const mem of db.all("SELECT * FROM memberships WHERE status = 'active' AND expires_at <= ? ORDER BY expires_at LIMIT 100", t)) {
        await endMembership(mem, 'expired'); res.expired++;
      }
      const due = db.all("SELECT * FROM memberships WHERE status = 'active' AND reminded = 0 AND expires_at > ? ORDER BY expires_at LIMIT 100", t);
      for (const mem of due) {
        const window = Math.min(config.remindHours * HOUR, mem.days * DAY * 0.25);
        if (mem.expires_at - t > window) continue;
        db.run('UPDATE memberships SET reminded = 1 WHERE id = ?', mem.id);
        const chat = getChat(mem.chat_id);
        if (chat) await send(mem.user_id, M.reminderText(chat, mem, t), M.renewKeyboard(chat, L()));
        res.reminded++;
      }
    } catch (e) { log.error?.(`[tick] ${tgErr(e)}`); } finally { ticking = false; }
    return res;
  }

  // ------------------------------------------------------- mini app API
  const publicPlan = (p) => ({ id: p.id, title: p.title, days: p.days, stars: p.stars, active: !!p.active });
  const publicChat = (c) => ({
    slug: c.slug, title: c.title, type: c.type, kind: M.kindOf(c), username: c.username, description: c.description,
    memberCount: c.member_count, hasPhoto: !!c.photo_file_id, available: !!canSell(c),
  });
  function publicMembership(m, t = now()) {
    const out = {
      id: m.id, status: m.status, days: m.days, paidAt: m.paid_at, joinedAt: m.joined_at, expiresAt: m.expires_at,
      leftMs: m.status === 'active' ? Math.max(0, m.expires_at - t) : null, inChat: !!m.in_chat, endReason: m.end_reason,
    };
    if (m.status === 'paid') { out.inviteLink = m.link_expires_at > t ? m.invite_link : null; out.linkExpiresAt = m.link_expires_at; }
    return out;
  }

  function me(user) {
    upsertUser(user);
    const owned = db.get('SELECT COUNT(*) n FROM chats WHERE owner_id = ?', user.id).n;
    const L_ = L();
    return { user: { id: user.id, name: displayName(user), username: user.username || null }, ownedChats: owned, isAdmin: isAdmin(user.id),
      bot: { username: botInfo.username, addToGroup: L_.addToGroup, addToChannel: L_.addToChannel } };
  }

  function explore() {
    const rows = db.all(`SELECT c.*, MIN(p.stars) min_stars, COUNT(p.id) plan_count,
      (SELECT COUNT(*) FROM memberships m WHERE m.chat_id = c.id AND m.status = 'active') active_members
      FROM chats c JOIN plans p ON p.chat_id = c.id AND p.deleted = 0 AND p.active = 1
      WHERE c.status = 'active' AND c.sales_enabled = 1 AND c.listed = 1 GROUP BY c.id ORDER BY active_members DESC, c.created_at DESC LIMIT 100`);
    return rows.map((c) => ({ ...publicChat(c), minStars: c.min_stars, planCount: c.plan_count, activeMembers: c.active_members }));
  }

  function chatPublic(slug, userId) {
    const chat = getChatBySlug(slug);
    if (!chat || chat.status === 'removed') fail(404, 'chat_not_found', 'Group / channel not found');
    const mem = userId ? db.get("SELECT * FROM memberships WHERE chat_id = ? AND user_id = ? AND status IN ('paid','active') ORDER BY id DESC LIMIT 1", chat.id, userId) : null;
    return { chat: publicChat(chat), plans: canSell(chat) ? activePlans(chat.id).map(publicPlan) : [], membership: mem ? publicMembership(mem) : null,
      isOwner: chat.owner_id === Number(userId) || isAdmin(userId), shareLink: L().direct(chat.slug) };
  }

  function myMemberships(userId) {
    const t = now();
    return db.all(`SELECT m.*, c.slug, c.title, c.type, c.photo_file_id, c.username FROM memberships m JOIN chats c ON c.id = m.chat_id
      WHERE m.user_id = ? ORDER BY CASE m.status WHEN 'paid' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, COALESCE(m.expires_at, m.paid_at) DESC LIMIT 100`, userId)
      .map((m) => ({ ...publicMembership(m, t), chat: { slug: m.slug, title: m.title, kind: m.type === 'channel' ? 'channel' : 'group', hasPhoto: !!m.photo_file_id, username: m.username } }));
  }

  function orderStatus(userId, orderId) {
    const o = db.get('SELECT * FROM orders WHERE id = ? AND user_id = ?', String(orderId), userId);
    if (!o) fail(404, 'order_not_found', 'Order not found');
    const m = o.membership_id ? getMembership(o.membership_id) : null;
    return { status: o.status, membership: m ? publicMembership(m) : null };
  }

  // ---------------------------------------------------- owner control panel
  function chatStats(chatId) {
    const t = now();
    const q = (sql, ...a) => db.get(sql, ...a);
    return {
      active: q("SELECT COUNT(*) n FROM memberships WHERE chat_id = ? AND status = 'active'", chatId).n,
      waiting: q("SELECT COUNT(*) n FROM memberships WHERE chat_id = ? AND status = 'paid'", chatId).n,
      ended: q("SELECT COUNT(*) n FROM memberships WHERE chat_id = ? AND status IN ('expired','removed')", chatId).n,
      sales: q("SELECT COUNT(*) n FROM orders WHERE chat_id = ? AND status = 'paid'", chatId).n,
      revenue: q("SELECT COALESCE(SUM(stars),0) s FROM orders WHERE chat_id = ? AND status = 'paid'", chatId).s,
      revenue30d: q("SELECT COALESCE(SUM(stars),0) s FROM orders WHERE chat_id = ? AND status = 'paid' AND paid_at >= ?", chatId, t - 30 * DAY).s,
    };
  }

  function ownerChats(userId) {
    const rows = db.all("SELECT * FROM chats WHERE owner_id = ? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC", userId);
    return rows.map((c) => ({ ...publicChat(c), status: c.status, salesEnabled: !!c.sales_enabled, listed: !!c.listed, planCount: activePlans(c.id).length, stats: chatStats(c.id) }));
  }

  function ownerChatDetail(userId, slug) {
    const chat = ownedChat(userId, slug);
    const t = now();
    const members = db.all(`SELECT m.*, u.first_name, u.last_name, u.username FROM memberships m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.chat_id = ? ORDER BY CASE m.status WHEN 'active' THEN 0 WHEN 'paid' THEN 1 ELSE 2 END, COALESCE(m.expires_at, m.paid_at) ASC LIMIT 300`, chat.id)
      .map((m) => ({ ...publicMembership(m, t), inviteLink: undefined, user: { id: m.user_id, name: displayName({ ...m, id: m.user_id }), username: m.username } }));
    const orders = db.all(`SELECT o.*, u.first_name, u.last_name, u.username FROM orders o LEFT JOIN users u ON u.id = o.user_id
      WHERE o.chat_id = ? AND o.status != 'pending' ORDER BY o.paid_at DESC LIMIT 50`, chat.id)
      .map((o) => ({ id: o.id, stars: o.stars, days: o.days, status: o.status, paidAt: o.paid_at, user: { id: o.user_id, name: displayName({ ...o, id: o.user_id }), username: o.username } }));
    return {
      chat: { ...publicChat(chat), status: chat.status, salesEnabled: !!chat.sales_enabled, listed: !!chat.listed, canInvite: !!chat.can_invite, canRestrict: !!chat.can_restrict },
      plans: allPlans(chat.id).map(publicPlan), stats: chatStats(chat.id), members, orders, shareLink: L().direct(chat.slug), botLink: L().share(chat.slug),
    };
  }

  function updateChat(userId, slug, body = {}) {
    const chat = ownedChat(userId, slug);
    const sets = [], vals = [];
    if (typeof body.salesEnabled === 'boolean') { sets.push('sales_enabled = ?'); vals.push(+body.salesEnabled); }
    if (typeof body.listed === 'boolean') { sets.push('listed = ?'); vals.push(+body.listed); }
    if (typeof body.description === 'string') { sets.push('description = ?'); vals.push(body.description.trim().slice(0, 500) || null); }
    if (sets.length) db.run(`UPDATE chats SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...vals, now(), chat.id);
    return ownerChatDetail(userId, slug);
  }

  function savePlan(userId, slug, body = {}, planId = null) {
    const chat = ownedChat(userId, slug);
    const days = Number(body.days), stars = Number(body.stars);
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 40) || null : null;
    if (planId == null) { addPlan(chat, days, stars, title); return ownerChatDetail(userId, slug); }
    const plan = db.get('SELECT * FROM plans WHERE id = ? AND chat_id = ? AND deleted = 0', Number(planId), chat.id);
    if (!plan) fail(404, 'plan_not_found', 'Plan not found');
    const d = body.days === undefined ? plan.days : days, s = body.stars === undefined ? plan.stars : stars;
    if (!isInt(d, 1, config.maxDays)) fail(400, 'bad_days', `Days must be 1–${config.maxDays}`);
    if (!isInt(s, config.minStars, config.maxStars)) fail(400, 'bad_stars', `Price must be ${config.minStars}–${config.maxStars} stars`);
    if (db.get('SELECT id FROM plans WHERE chat_id = ? AND days = ? AND deleted = 0 AND id != ?', chat.id, d, plan.id)) fail(409, 'duplicate', `A ${d}-day plan already exists`);
    const active = typeof body.active === 'boolean' ? +body.active : plan.active;
    db.run('UPDATE plans SET days = ?, stars = ?, active = ?, title = ? WHERE id = ?', d, s, active, body.title === undefined ? plan.title : title, plan.id);
    return ownerChatDetail(userId, slug);
  }

  function deletePlan(userId, slug, planId) {
    const chat = ownedChat(userId, slug);
    db.run('UPDATE plans SET deleted = 1, active = 0 WHERE id = ? AND chat_id = ?', Number(planId), chat.id);
    return ownerChatDetail(userId, slug);
  }

  function ownedMembership(userId, slug, memId) {
    const chat = ownedChat(userId, slug);
    const mem = db.get('SELECT * FROM memberships WHERE id = ? AND chat_id = ?', Number(memId), chat.id);
    if (!mem) fail(404, 'not_found', 'Member not found');
    return { chat, mem };
  }

  async function kickMember(userId, slug, memId) {
    const { mem } = ownedMembership(userId, slug, memId);
    if (!['paid', 'active'].includes(mem.status)) fail(409, 'not_active', 'Membership already ended');
    const r = await endMembership(mem, 'removed_by_owner');
    return { ...ownerChatDetail(userId, slug), result: r };
  }

  async function extendMember(userId, slug, memId, days) {
    const { chat, mem } = ownedMembership(userId, slug, memId);
    days = Number(days);
    if (!isInt(days, 1, config.maxDays)) fail(400, 'bad_days', `Days must be 1–${config.maxDays}`);
    if (!['paid', 'active'].includes(mem.status)) fail(409, 'not_active', 'Membership already ended');
    db.run("UPDATE memberships SET days = days + ?, reminded = 0, expires_at = CASE WHEN status = 'active' THEN expires_at + ? ELSE expires_at END WHERE id = ?", days, days * DAY, mem.id);
    const m = getMembership(mem.id);
    await send(m.user_id, `🎁 The owner of <b>${M.esc(chat.title)}</b> gave you <b>+${M.plural(days, 'day')}</b>!` + (m.expires_at ? `\nNew end date: <b>${M.fmtDate(m.expires_at)}</b>.` : ''));
    return ownerChatDetail(userId, slug);
  }

  async function refreshChat(userId, slug) {
    const chat = ownedChat(userId, slug);
    let r = { admin: false, invite: false, restrict: false };
    try { r = rightsOf(await api.getChatMember(chat.id, botInfo.id)); } catch (e) { log.warn?.(`[refresh] ${tgErr(e)}`); }
    const status = !r.admin ? (chat.status === 'removed' ? 'removed' : 'no_rights') : rightsOk(chat.type, r) ? 'active' : 'no_rights';
    db.run('UPDATE chats SET status = ?, can_invite = ?, can_restrict = ?, updated_at = ? WHERE id = ?', status, +r.invite, +r.restrict, now(), chat.id);
    await refreshInfo(chat).catch(() => {});
    return ownerChatDetail(userId, slug);
  }

  function globalStats() {
    const q = (sql) => db.get(sql);
    return {
      chats: q("SELECT COUNT(*) n FROM chats WHERE status = 'active'").n,
      users: q('SELECT COUNT(*) n FROM users').n,
      active: q("SELECT COUNT(*) n FROM memberships WHERE status = 'active'").n,
      revenue: q("SELECT COALESCE(SUM(stars),0) s FROM orders WHERE status = 'paid'").s,
    };
  }

  return {
    setBotInfo: (info) => { botInfo = { id: info.id, username: info.username }; },
    get botInfo() { return botInfo; },
    links: L, upsertUser, getChatBySlug,
    // bot
    onMyChatMember, onStart, onCallback, onText, onPreCheckout, onSuccessfulPayment, onJoinRequest, onChatMember, sendOwnerSetup,
    // scheduler
    tick,
    // mini app
    me, explore, chatPublic, myMemberships, orderStatus, createOrder, renewLink,
    ownerChats, ownerChatDetail, updateChat, savePlan, deletePlan, kickMember, extendMember, refreshChat, globalStats,
  };
}
