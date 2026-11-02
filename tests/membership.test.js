// End-to-end tests of the membership flow with a fake Telegram API and a fake clock.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { createService } from '../src/service.js';
import { signInitData, verifyInitData } from '../src/auth.js';

const DAY = 86_400_000;
const BOT = { id: 999, username: 'StarPassBot', is_bot: true };
const OWNER = { id: 1, first_name: 'Owner', username: 'owner' };
const BUYER = { id: 2, first_name: 'Buyer', username: 'buyer' };
const STRANGER = { id: 3, first_name: 'Stranger' };
const GROUP = { id: -1001, type: 'supergroup', title: 'VIP Signals' };

function fakeApi() {
  const calls = [];
  const members = new Map(); // `${chat}:${user}` -> status
  let linkN = 0;
  const rec = (name, fn) => async (...a) => { calls.push({ name, a }); return fn(...a); };
  const api = {
    calls, members,
    sent: (uid) => calls.filter((c) => c.name === 'sendMessage' && c.a[0] === uid),
    last: (uid) => api.sent(uid).at(-1),
    count: (name) => calls.filter((c) => c.name === name).length,
    sendMessage: rec('sendMessage', () => ({ message_id: 1 })),
    getChat: rec('getChat', (id) => ({ id, title: GROUP.title, description: 'Daily signals', photo: null })),
    getChatMemberCount: rec('getChatMemberCount', () => 42),
    getChatAdministrators: rec('getChatAdministrators', () => [{ status: 'creator', user: OWNER }]),
    getChatMember: rec('getChatMember', (chat, user) => {
      if (user === BOT.id) return { status: 'administrator', can_invite_users: true, can_restrict_members: true, user: BOT };
      return { status: members.get(`${chat}:${user}`) || 'left', user: { id: user } };
    }),
    createInvoiceLink: rec('createInvoiceLink', (_t, _d, payload) => `https://t.me/$inv_${payload}`),
    createChatInviteLink: rec('createChatInviteLink', () => ({ invite_link: `https://t.me/+link${++linkN}`, creator: BOT })),
    revokeChatInviteLink: rec('revokeChatInviteLink', () => ({})),
    approveChatJoinRequest: rec('approveChatJoinRequest', (chat, user) => { members.set(`${chat}:${user}`, 'member'); return true; }),
    declineChatJoinRequest: rec('declineChatJoinRequest', () => true),
    banChatMember: rec('banChatMember', (chat, user) => { members.set(`${chat}:${user}`, 'kicked'); return true; }),
    unbanChatMember: rec('unbanChatMember', (chat, user) => { members.set(`${chat}:${user}`, 'left'); return true; }),
    refundStarPayment: rec('refundStarPayment', () => true),
  };
  return api;
}

let svc, api, db, clock;
const config = loadConfig({ PUBLIC_URL: 'https://app.example.com', LINK_TTL_HOURS: '24', REMIND_HOURS: '24' });
const silent = { warn() {}, error() {} };

beforeEach(async () => {
  db = await openDb(':memory:');
  api = fakeApi();
  clock = Date.UTC(2026, 10, 2, 12, 0, 0);
  svc = createService({ db, api, config, now: () => clock, log: silent });
  svc.setBotInfo(BOT);
  await svc.onStart(OWNER, '');
});

const adminUpdate = (rights = { can_invite_users: true, can_restrict_members: true }, status = 'administrator') => ({
  chat: GROUP, from: OWNER, old_chat_member: { status: 'left', user: BOT }, new_chat_member: { status, user: BOT, ...rights },
});

async function connectWithPlan(stars = 100, days = 30) {
  const chat = await svc.onMyChatMember(adminUpdate());
  const r = await svc.onCallback(OWNER, `pd:${chat.slug}:${stars}:${days}`);
  assert.match(r.text, /Plan created/);
  return { chat: svc.getChatBySlug(chat.slug), plan: svc.chatPublic(chat.slug, BUYER.id).plans[0] };
}

async function pay(user, planId, charge = `ch_${Math.random()}`) {
  const o = await svc.createOrder(user, planId);
  const pre = svc.onPreCheckout({ id: 'q', from: user, currency: 'XTR', total_amount: o.stars, invoice_payload: o.orderId });
  assert.equal(pre.ok, true, pre.error);
  await svc.onSuccessfulPayment(user, { currency: 'XTR', total_amount: o.stars, invoice_payload: o.orderId, telegram_payment_charge_id: charge });
  return o;
}

const joinReq = (user, link) => ({ chat: GROUP, from: user, user_chat_id: user.id, date: 0, invite_link: { invite_link: link, creator: BOT } });

test('bot made admin → owner gets a private message with star price buttons', async () => {
  const chat = await svc.onMyChatMember(adminUpdate());
  assert.equal(chat.status, 'active');
  assert.equal(chat.owner_id, OWNER.id);
  const msg = api.last(OWNER.id);
  assert.match(msg.a[1], /Connected!/);
  assert.match(msg.a[1], /VIP Signals/);
  const kb = msg.a[2].reply_markup.inline_keyboard.flat();
  assert.ok(kb.some((b) => b.callback_data === `pp:${chat.slug}:100`), 'price preset button');
  assert.ok(kb.some((b) => b.web_app?.url.includes(`manage=${chat.slug}`)), 'control panel button');
});

test('price → days buttons create a plan; custom text input works', async () => {
  const chat = await svc.onMyChatMember(adminUpdate());
  const step2 = await svc.onCallback(OWNER, `pp:${chat.slug}:250`);
  assert.match(step2.text, /Step 2\/2/);
  assert.ok(step2.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === `pd:${chat.slug}:250:30`));
  // custom price + custom days via text
  await svc.onCallback(OWNER, `pc:${chat.slug}`);
  assert.match(svc.onText(OWNER, 'abc').text, /whole number/);
  const d = svc.onText(OWNER, '150');
  assert.match(d.text, /⭐ 150/);
  await svc.onCallback(OWNER, `dc:${chat.slug}:150`);
  const done = svc.onText(OWNER, '45');
  assert.match(done.text, /45 days for ⭐ 150/);
  assert.equal(svc.onText(OWNER, 'hello'), null, 'no pending input anymore');
  // strangers cannot configure
  const r = await svc.onCallback(STRANGER, `pd:${chat.slug}:1:1`);
  assert.equal(r.alert, true);
});

test('missing rights → warning; removed → paused; re-added → active again', async () => {
  let chat = await svc.onMyChatMember(adminUpdate({ can_invite_users: true, can_restrict_members: false }));
  assert.equal(chat.status, 'no_rights');
  assert.match(api.last(OWNER.id).a[1], /Ban users/);
  chat = await svc.onMyChatMember(adminUpdate());
  assert.equal(chat.status, 'active');
  chat = await svc.onMyChatMember({ ...adminUpdate(), new_chat_member: { status: 'left', user: BOT } });
  assert.equal(chat.status, 'removed');
  assert.match(api.last(OWNER.id).a[1], /removed/);
});

test('owner who never started the bot gets the setup DM after /start', async () => {
  api.sendMessage = async (uid, ...rest) => { api.calls.push({ name: 'sendMessage', a: [uid, ...rest] }); if (uid === 7) throw new Error('Forbidden'); return {}; };
  api.getChatAdministrators = async () => [{ status: 'creator', user: { id: 7, first_name: 'New' } }];
  const chat = await svc.onMyChatMember({ ...adminUpdate(), from: { id: 7, first_name: 'New' } });
  assert.equal(chat.owner_notified, 0);
  assert.ok(api.sent(GROUP.id).length, 'hint posted in the group');
  api.sendMessage = async (uid, ...rest) => { api.calls.push({ name: 'sendMessage', a: [uid, ...rest] }); return {}; };
  await svc.onStart({ id: 7, first_name: 'New' }, '');
  assert.match(api.last(7).a[1], /Connected!/);
  assert.equal(svc.getChatBySlug(chat.slug).owner_notified, 1);
});

test('full flow: pay with stars → one-time link → join → countdown → reminder → auto kick', async () => {
  const { chat, plan } = await connectWithPlan(100, 30);
  assert.equal(plan.stars, 100);
  const o = await svc.createOrder(BUYER, plan.id);
  const inv = api.calls.find((c) => c.name === 'createInvoiceLink');
  assert.equal(inv.a[4], 'XTR');
  assert.deepEqual(inv.a[5], [{ label: '30 days access', amount: 100 }]);

  // wrong amount is rejected at pre-checkout
  assert.equal(svc.onPreCheckout({ from: BUYER, currency: 'XTR', total_amount: 1, invoice_payload: o.orderId }).ok, false);
  assert.equal(svc.onPreCheckout({ from: STRANGER, currency: 'XTR', total_amount: 100, invoice_payload: o.orderId }).ok, false);

  await svc.onSuccessfulPayment(BUYER, { invoice_payload: o.orderId, telegram_payment_charge_id: 'c1', total_amount: 100, currency: 'XTR' });
  const link = api.calls.find((c) => c.name === 'createChatInviteLink');
  assert.equal(link.a[1].creates_join_request, true, 'personal link: only the buyer is approved');
  assert.equal(link.a[1].expire_date, Math.floor(clock / 1000) + 24 * 3600);
  const dm = api.last(BUYER.id);
  assert.match(dm.a[1], /one-time link/);
  assert.equal(dm.a[2].reply_markup.inline_keyboard[0][0].url, 'https://t.me/+link1');

  // duplicate successful_payment update is ignored
  await svc.onSuccessfulPayment(BUYER, { invoice_payload: o.orderId, telegram_payment_charge_id: 'c1' });
  assert.equal(api.count('createChatInviteLink'), 1);

  let my = svc.myMemberships(BUYER.id)[0];
  assert.equal(my.status, 'paid');
  assert.equal(my.inviteLink, 'https://t.me/+link1');
  assert.equal(my.expiresAt, null, 'countdown has not started before joining');

  // someone else tries the link → declined
  const r1 = await svc.onJoinRequest(joinReq(STRANGER, 'https://t.me/+link1'));
  assert.equal(r1.declined, true);
  assert.equal(api.count('approveChatJoinRequest'), 0);

  // 3 hours later the buyer joins → approved, countdown starts now
  clock += 3 * 3600_000;
  const joinedAt = clock;
  const r2 = await svc.onJoinRequest(joinReq(BUYER, 'https://t.me/+link1'));
  assert.equal(r2.approved, true);
  assert.ok(api.calls.some((c) => c.name === 'revokeChatInviteLink' && c.a[1] === 'https://t.me/+link1'), 'link revoked after use');
  assert.match(api.last(BUYER.id).a[1], /countdown has started/);
  my = svc.myMemberships(BUYER.id)[0];
  assert.equal(my.status, 'active');
  assert.equal(my.joinedAt, joinedAt);
  assert.equal(my.expiresAt, joinedAt + 30 * DAY);
  assert.equal(my.leftMs, 30 * DAY);

  // chat_member "joined" update for the same user does not restart the countdown
  clock += 1000;
  await svc.onChatMember({ chat: GROUP, old_chat_member: { status: 'left', user: BUYER }, new_chat_member: { status: 'member', user: BUYER } });
  assert.equal(svc.myMemberships(BUYER.id)[0].expiresAt, joinedAt + 30 * DAY);

  // day 28: nothing; day 29+: reminder (once)
  clock = joinedAt + 28 * DAY;
  assert.deepEqual(await svc.tick(), { expired: 0, reminded: 0 });
  clock = joinedAt + 29 * DAY + 60_000;
  assert.deepEqual(await svc.tick(), { expired: 0, reminded: 1 });
  assert.match(api.last(BUYER.id).a[1], /ends in/);
  assert.deepEqual(await svc.tick(), { expired: 0, reminded: 0 });

  // day 30: removed from the group
  clock = joinedAt + 30 * DAY;
  assert.deepEqual(await svc.tick(), { expired: 1, reminded: 0 });
  const ban = api.calls.find((c) => c.name === 'banChatMember');
  assert.deepEqual(ban.a.slice(0, 2), [GROUP.id, BUYER.id]);
  assert.ok(api.calls.some((c) => c.name === 'unbanChatMember' && c.a[1] === BUYER.id), 'unbanned so they can buy again');
  assert.match(api.last(BUYER.id).a[1], /has ended/);
  assert.equal(svc.myMemberships(BUYER.id)[0].status, 'expired');

  // owner stats
  const d = svc.ownerChatDetail(OWNER.id, chat.slug);
  assert.equal(d.stats.revenue, 100);
  assert.equal(d.stats.sales, 1);
  assert.equal(d.stats.ended, 1);
});

test('renewing an active membership extends the end date (no new link)', async () => {
  const { plan } = await connectWithPlan(50, 7);
  await pay(BUYER, plan.id, 'a');
  await svc.onJoinRequest(joinReq(BUYER, 'https://t.me/+link1'));
  const end1 = svc.myMemberships(BUYER.id)[0].expiresAt;
  clock += 2 * DAY;
  await pay(BUYER, plan.id, 'b');
  const m = svc.myMemberships(BUYER.id);
  assert.equal(m.length, 1);
  assert.equal(m[0].expiresAt, end1 + 7 * DAY);
  assert.equal(m[0].days, 14);
  assert.equal(api.count('createChatInviteLink'), 1);
  assert.match(api.last(BUYER.id).a[1], /Renewed/);
});

test('buyer already in the group: countdown starts right after payment', async () => {
  const { plan } = await connectWithPlan(10, 1);
  api.members.set(`${GROUP.id}:${BUYER.id}`, 'member');
  await pay(BUYER, plan.id);
  const m = svc.myMemberships(BUYER.id)[0];
  assert.equal(m.status, 'active');
  assert.equal(m.expiresAt, clock + DAY);
  assert.equal(api.count('createChatInviteLink'), 0);
});

test('expired link → user requests a new one; payment refunded if link cannot be created', async () => {
  const { plan } = await connectWithPlan(10, 3);
  await pay(BUYER, plan.id);
  clock += 25 * 3600_000;
  const mem = svc.myMemberships(BUYER.id)[0];
  assert.equal(mem.inviteLink, null, 'expired link is hidden');
  await svc.renewLink(BUYER.id, mem.id);
  assert.equal(svc.myMemberships(BUYER.id)[0].inviteLink, 'https://t.me/+link2');
  await assert.rejects(svc.renewLink(STRANGER.id, mem.id), /not found/);

  api.createChatInviteLink = async () => { throw new Error('not enough rights'); };
  await pay(STRANGER, plan.id, 'zz');
  assert.equal(api.count('refundStarPayment'), 1);
  assert.equal(svc.myMemberships(STRANGER.id)[0].status, 'removed');
  assert.match(api.last(STRANGER.id).a[1], /refunded/);
});

test('mini app owner panel: plans, settings, gift days, kick, permissions', async () => {
  const { chat, plan } = await connectWithPlan(100, 30);
  assert.throws(() => svc.ownerChatDetail(BUYER.id, chat.slug), /owner/);
  let d = svc.savePlan(OWNER.id, chat.slug, { days: 7, stars: 30, title: 'Weekly' });
  assert.equal(d.plans.length, 2);
  assert.throws(() => svc.savePlan(OWNER.id, chat.slug, { days: 0, stars: 5 }), /Days/);
  assert.throws(() => svc.savePlan(OWNER.id, chat.slug, { days: 5, stars: 0 }), /Price/);
  d = svc.savePlan(OWNER.id, chat.slug, { stars: 120, active: false }, plan.id);
  assert.equal(d.plans.find((p) => p.id === plan.id).stars, 120);
  assert.equal(svc.chatPublic(chat.slug, BUYER.id).plans.length, 1, 'hidden plan not offered');
  await assert.rejects(svc.createOrder(BUYER, plan.id), /not available/);

  d = svc.updateChat(OWNER.id, chat.slug, { listed: false, description: '  Best signals  ' });
  assert.equal(d.chat.listed, false);
  assert.equal(d.chat.description, 'Best signals');
  assert.equal(svc.explore().length, 0);
  svc.updateChat(OWNER.id, chat.slug, { listed: true });
  assert.equal(svc.explore().length, 1);

  const weekly = d.plans.find((p) => p.days === 7);
  await pay(BUYER, weekly.id);
  await svc.onJoinRequest(joinReq(BUYER, 'https://t.me/+link1'));
  const memId = svc.myMemberships(BUYER.id)[0].id;
  d = await svc.extendMember(OWNER.id, chat.slug, memId, 3);
  assert.equal(d.members[0].expiresAt, clock + 10 * DAY);
  assert.match(api.last(BUYER.id).a[1], /\+3 days/);

  d = await svc.kickMember(OWNER.id, chat.slug, memId);
  assert.equal(d.result.kicked, true);
  assert.equal(svc.myMemberships(BUYER.id)[0].status, 'removed');

  svc.updateChat(OWNER.id, chat.slug, { salesEnabled: false });
  await assert.rejects(svc.createOrder(STRANGER, weekly.id), /paused/);
  await assert.rejects(svc.createOrder(OWNER, weekly.id), /paused|own/);

  d = svc.deletePlan(OWNER.id, chat.slug, weekly.id);
  assert.equal(d.plans.length, 1);
  assert.equal(svc.ownerChats(OWNER.id)[0].stats.revenue, 30);
});

test('Telegram initData signature check', () => {
  const token = '123:ABC';
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 5, first_name: 'A' }), query_id: 'x' });
  p.set('hash', signInitData(p, token));
  assert.equal(verifyInitData(p.toString(), token).user.id, 5);
  assert.equal(verifyInitData(p.toString(), '123:XYZ'), null, 'wrong token');
  const t = new URLSearchParams(p); t.set('user', JSON.stringify({ id: 6 }));
  assert.equal(verifyInitData(t.toString(), token), null, 'tampered');
  assert.equal(verifyInitData(p.toString(), token, 60, Date.now() + 120_000), null, 'expired');
});
