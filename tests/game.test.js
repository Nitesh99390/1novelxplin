import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const base = 'http://127.0.0.1:3101';
let child;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '3101', BOT_TOKEN: '', DB_PATH: ':memory:', DEV_AUTH: '1' }, stdio: 'pipe' });
  let ready = false;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {} await delay(100); }
  assert.ok(ready, 'server started');
});
after(() => child?.kill());

test('health endpoint', async () => {
  const r = await fetch(`${base}/api/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('serves the game at /game with English UI strings', async () => {
  const html = await (await fetch(`${base}/game`)).text();
  for (const s of ['Hit the BOSS!', 'Points<br>tapped:', 'My stars', 'Hit the boss!', 'This is your first boss', 'You killed the boss!', 'BOSS DEFEATED', 'Telegram Stars', 'Watch ad', 'Skip and start over', 'ad-overlay']) assert.ok(html.includes(s), `missing: ${s}`);
  assert.ok(!/[а-яА-Я]/.test(html), 'no Cyrillic left in the UI');
});

test('serves static assets and vendor confetti', async () => {
  for (const p of ['/game/style.css', '/game/app.js', '/game/rewards.js', '/game/ads.js', '/app.js', '/app.css', '/vendor/confetti.js', '/assets/star.png', '/assets/boss.webp', '/assets/pedestal.webp', '/assets/card-bg.jpg']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
  }
});

test('Mini App index + SPA fallback', async () => {
  for (const p of ['/', '/some/deep/route']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes('Star Pass') && html.includes('data-tab="manage"'), p);
  }
});

test('API requires Telegram auth', async () => {
  const r = await fetch(`${base}/api/me`);
  assert.equal(r.status, 401);
  const bad = await fetch(`${base}/api/me`, { headers: { 'X-Telegram-Init-Data': 'hash=00&user=%7B%22id%22%3A1%7D' } });
  assert.equal(bad.status, 401);
});

test('API works with dev auth (explore / my / owner / errors)', async () => {
  const headers = { 'X-Dev-User': '42', 'Content-Type': 'application/json' };
  const me = await (await fetch(`${base}/api/me`, { headers })).json();
  assert.equal(me.user.id, 42);
  assert.deepEqual(await (await fetch(`${base}/api/explore`, { headers })).json(), { chats: [] });
  assert.deepEqual(await (await fetch(`${base}/api/my`, { headers })).json(), { memberships: [] });
  assert.deepEqual(await (await fetch(`${base}/api/owner/chats`, { headers })).json(), { chats: [] });
  const nf = await fetch(`${base}/api/chats/nope`, { headers });
  assert.equal(nf.status, 404);
  assert.equal((await nf.json()).error, 'chat_not_found');
  const order = await fetch(`${base}/api/orders`, { method: 'POST', headers, body: JSON.stringify({ planId: 1 }) });
  assert.equal(order.status, 404);
  const admin = await fetch(`${base}/api/admin/stats`, { headers });
  assert.equal(admin.status, 403);
});

test('config.js exposes ad settings (demo by default)', async () => {
  const r = await fetch(`${base}/config.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  const txt = await r.text();
  assert.match(txt, /^window\.APP_CONFIG = /);
  const cfg = JSON.parse(txt.replace('window.APP_CONFIG = ', '').replace(/;$/, ''));
  assert.equal(typeof cfg.adsgramBlockId, 'string');
  assert.equal(cfg.demoAdSeconds > 0, true);
});
