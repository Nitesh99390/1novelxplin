import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const base = 'http://127.0.0.1:3101';
let child;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '3101' }, stdio: 'pipe' });
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

test('serves index with English UI strings', async () => {
  const html = await (await fetch(base)).text();
  for (const s of ['Hit the BOSS!', 'Points<br>tapped:', 'My stars', 'Hit the boss!', 'This is your first boss', 'You killed the boss!', 'BOSS DEFEATED', 'Telegram Stars', 'Watch ad', 'Skip and start over', 'ad-overlay']) assert.ok(html.includes(s), `missing: ${s}`);
  assert.ok(!/[а-яА-Я]/.test(html), 'no Cyrillic left in the UI');
});

test('serves static assets and vendor confetti', async () => {
  for (const p of ['/style.css', '/app.js', '/rewards.js', '/ads.js', '/vendor/confetti.js', '/assets/star.png', '/assets/boss.webp', '/assets/pedestal.webp', '/assets/card-bg.jpg']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
  }
});

test('SPA fallback returns index for unknown routes', async () => {
  const r = await fetch(`${base}/some/deep/route`);
  assert.equal(r.status, 200);
  assert.ok((await r.text()).includes('screen-game'));
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
