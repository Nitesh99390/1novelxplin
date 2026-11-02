/* ============================================================
   Hit the BOSS! — tap → milestone → watch ads → collect stars
   Ladder rules live in rewards.js, ads in ads.js.
   State lives in localStorage (backend comes later — see README).
   ============================================================ */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Number(n || 0).toLocaleString('en-US'); // 5,000
  const rnd = (a, b) => a + Math.random() * (b - a);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const KEY = 'boss_rewards_v1';
  const R = window.Rewards;
  const Ads = window.Ads;

  // ---------- Telegram WebApp ----------
  const tg = window.Telegram?.WebApp;
  if (tg) {
    try {
      tg.ready(); tg.expand();
      tg.setHeaderColor('#000000'); tg.setBackgroundColor('#000000');
      tg.disableVerticalSwipes?.();
    } catch {}
  }
  const haptic = (type = 'light') => {
    try {
      if (type === 'success' || type === 'error' || type === 'warning') tg?.HapticFeedback?.notificationOccurred(type);
      else tg?.HapticFeedback?.impactOccurred(type);
    } catch {}
    if (!tg?.HapticFeedback && navigator.vibrate) navigator.vibrate(type === 'success' ? [30, 40, 60] : 10);
  };

  // ---------- State ----------
  let state = load();
  function load() { try { return R.normalize(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return R.initial(); } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }

  // Boss titles change with the boss health (like the original flow)
  const titles = [
    ['This is your first boss', 'Hit him!'],
    ["He's getting weaker!", "Don't stop!"],
    ['The boss is resisting', 'Hit harder!'],
    ['Final push!', 'Finish him!'],
  ];
  const bossNames = ['This is your first boss', 'Boss #2 — stronger!', 'Boss #3 — the big one!'];

  // ---------- Elements ----------
  const el = {
    game: $('#screen-game'), win: $('#screen-win'),
    score: $('#score'), stars: $('#stars'), starsChip: $('#stars-chip'),
    boss: $('#boss'), hpFill: $('#hp-fill'), hpBar: $('#hp-bar'),
    goalSteps: $('#goal-steps'), goalText: $('#goal-text'),
    title: $('#boss-title'), sub: $('#boss-sub'), hit: $('#hit-btn'), hitLabel: $('#hit-btn .btn-label'),
    floaters: $('#floaters'), particles: $('#particles'), flash: $('#flash'), fly: $('#fly-layer'),
    prizeAmount: $('#prize-amount'), winAmount: $('#win-amount'), winAds: $('#win-ads'),
    winBadge: $('#win-badge'), winTitle: $('#win-title'), winHint: $('#win-hint'), adSteps: $('#ad-steps'),
    adBtn: $('#ad-btn'), adBtnLabel: $('#ad-btn-label'), skip: $('#skip-btn'),
    sheet: $('#sheet-backdrop'), sheetTitle: $('#sheet-title'), sheetText: $('#sheet-text'),
    sheetOk: $('#sheet-ok'), sheetCancel: $('#sheet-cancel'),
    toast: $('#toast'),
  };

  // ---------- Background: stars & embers ----------
  (function background() {
    const stars = $('#bg-stars');
    for (let i = 0; i < 18; i++) {
      const s = document.createElement('span');
      s.textContent = Math.random() > .5 ? '★' : '✦';
      s.style.cssText = `left:${rnd(0, 100)}%;top:${rnd(0, 100)}%;font-size:${rnd(8, 22)}px;--dur:${rnd(5, 10)}s;--delay:${rnd(-10, 0)}s;`;
      stars.appendChild(s);
    }
    const embers = $('#embers');
    for (let i = 0; i < 26; i++) {
      const e = document.createElement('i');
      e.style.cssText = `--x:${rnd(12, 88)}%;--s:${rnd(3, 7)}px;--dur:${rnd(3, 6)}s;--delay:${rnd(-6, 0)}s;--dx:${rnd(-70, 70)}px;`;
      embers.appendChild(e);
    }
  })();

  // ---------- Goal strip: 1,000 → 3,000 → 5,000 ----------
  el.goalSteps.innerHTML = R.TIERS.map((t, i) => `
    <div class="goal-step" data-i="${i}">
      <span class="gs-dot">${i + 1}</span>
      <span class="gs-at">${fmt(t.target)}</span>
      <span class="gs-meta"><img src="/assets/star.png" alt="">+${fmt(t.reward)} · ${plural(t.ads, 'ad')}</span>
    </div>`).join('<i class="gs-line"></i>');
  const goalNodes = [...el.goalSteps.querySelectorAll('.goal-step')];

  // ---------- Render ----------
  let lastStage = -1, lastTier = -1;
  function render() {
    el.score.textContent = fmt(state.points);
    el.stars.textContent = fmt(state.stars);
    const t = R.current(state);
    const pct = 1 - R.progress(state);
    el.hpFill.style.width = `${pct * 100}%`;
    el.hpBar.setAttribute('aria-valuenow', Math.round(pct * 100));
    el.hpFill.classList.toggle('low', pct < .25);
    el.boss.classList.toggle('weak', pct < .35);

    goalNodes.forEach((n, i) => {
      n.classList.toggle('done', i < state.tier);
      n.classList.toggle('now', i === state.tier);
    });
    const left = Math.max(0, t.target - state.points);
    const locked = R.isLocked(state);
    el.goalText.innerHTML = locked
      ? `Goal reached! Watch <b>${plural(t.ads, 'ad')}</b> → <b>+${fmt(t.reward)} ★</b>`
      : `<b>${fmt(left)}</b> points to go → watch ${plural(t.ads, 'ad')} → <b>+${fmt(t.reward)} ★</b>`;

    const stage = pct >= 1 ? 0 : pct > .66 ? 1 : pct > .33 ? 2 : 3;
    if (stage !== lastStage || state.tier !== lastTier) {
      lastStage = stage; lastTier = state.tier;
      const [tt, ss] = stage === 0 ? [bossNames[state.tier] || titles[0][0], 'Hit him!'] : titles[stage];
      el.title.textContent = tt; el.sub.textContent = ss;
      el.title.classList.remove('swap'); void el.title.offsetWidth; el.title.classList.add('swap');
    }
  }

  // ---------- Effects ----------
  let hitFlip = false;
  function bossShake() {
    el.boss.classList.remove('hit', 'hit-alt'); void el.boss.offsetWidth;
    el.boss.classList.add(hitFlip ? 'hit-alt' : 'hit'); hitFlip = !hitFlip;
  }
  function centerOf(node, layer) {
    const a = layer.getBoundingClientRect(), b = node.getBoundingClientRect();
    return { x: b.left + b.width / 2 - a.left, y: b.top + b.height / 2 - a.top };
  }
  function floater(text, big = false) {
    const c = centerOf(el.boss, el.floaters);
    const f = document.createElement('span');
    f.className = 'floater' + (big ? ' big' : '');
    f.textContent = text;
    f.style.cssText = `--x:${c.x + rnd(-70, 70)}px;--y:${c.y + rnd(-70, 10)}px;--dx:${rnd(-40, 40)}px;`;
    el.floaters.appendChild(f);
    f.addEventListener('animationend', () => f.remove());
  }
  function sparks(count = 10) {
    const c = centerOf(el.boss, el.particles);
    const colors = ['#fff', '#ffe08a', '#ffc93c', '#ff9a1f'];
    for (let i = 0; i < count; i++) {
      const s = document.createElement('i');
      const ang = rnd(0, Math.PI * 2), dist = rnd(70, 170);
      s.className = 'spark' + (i % 3 === 0 ? ' cross' : '');
      s.style.cssText = `--x:${c.x}px;--y:${c.y}px;--s:${rnd(4, 10)}px;--c:${colors[i % colors.length]};--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist}px;`;
      el.particles.appendChild(s);
      s.addEventListener('animationend', () => s.remove());
    }
  }
  function bump(node) { node.classList.remove('bump'); void node.offsetWidth; node.classList.add('bump'); }
  let toastTimer;
  function toast(msg) { el.toast.textContent = msg; el.toast.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('visible'), 2800); }

  // Stars fly from a source element into the "My stars" chip
  function flyStars(fromNode, count = 12) {
    const from = fromNode.getBoundingClientRect(), to = el.starsChip.getBoundingClientRect();
    const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
    const tx = to.left + 30, ty = to.top + to.height / 2;
    for (let i = 0; i < count; i++) {
      const s = document.createElement('img');
      s.src = '/assets/star.png'; s.className = 'fly-star';
      s.style.cssText = `left:${fx}px;top:${fy}px;--sx:${rnd(-90, 90)}px;--sy:${rnd(-90, 40)}px;--tx:${tx - fx}px;--ty:${ty - fy}px;animation-delay:${i * 45}ms;`;
      el.fly.appendChild(s);
      s.addEventListener('animationend', () => s.remove());
    }
  }

  // ---------- Hit ----------
  let busy = false;
  function onHit() {
    if (busy || R.isLocked(state)) return;
    const crit = Math.random() < .12;
    const gain = Math.floor(rnd(95, 135)) * (crit ? 2 : 1);   // +95 … +135 like the original (crit ×2)
    const res = R.tap(state, gain);
    state = res.state;
    bossShake(); sparks(crit ? 18 : 10); floater(`+${res.added}`, crit);
    bump(el.score); haptic(crit ? 'medium' : 'light');
    el.hit.classList.add('touched');
    render(); save();
    if (res.reached) defeat();
  }
  function pressBtn() { el.hit.classList.add('pressed'); setTimeout(() => el.hit.classList.remove('pressed'), 90); }

  // Instant response on pointerdown (no click delay)
  el.hit.addEventListener('pointerdown', (e) => { e.preventDefault(); pressBtn(); onHit(); });
  el.boss.addEventListener('pointerdown', (e) => { e.preventDefault(); onHit(); });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && el.game.classList.contains('active') && !el.sheet.classList.contains('open')) { e.preventDefault(); pressBtn(); onHit(); }
  });

  // ---------- Milestone reached → boss defeated ----------
  function defeat() {
    busy = true;
    haptic('success');
    el.boss.classList.remove('hit', 'hit-alt', 'weak'); void el.boss.offsetWidth; el.boss.classList.add('die');
    sparks(30); floater('BOSS DEFEATED!', true);
    setTimeout(() => { el.flash.classList.remove('go'); void el.flash.offsetWidth; el.flash.classList.add('go'); }, 300);
    setTimeout(() => showOffer(true), 650);
  }

  // ---------- Reward / ads screen ----------
  function renderOffer() {
    const t = R.current(state);
    const left = t.ads - state.adsWatched;
    el.prizeAmount.textContent = fmt(t.reward);
    el.winAmount.textContent = fmt(t.reward);
    el.winAds.textContent = plural(t.ads, 'ad');
    el.winBadge.textContent = `BOSS ${state.tier + 1} DEFEATED · ${fmt(t.target)} POINTS`;
    el.adSteps.innerHTML = Array.from({ length: t.ads }, (_, i) =>
      `<span class="ad-step${i < state.adsWatched ? ' done' : ''}${i === state.adsWatched ? ' next' : ''}">${i < state.adsWatched ? '✓' : '▶'}<small>Ad ${i + 1}</small></span>`).join('');
    el.adBtnLabel.textContent = t.ads === 1 ? `Watch ad · get ${fmt(t.reward)} ★`
      : state.adsWatched === 0 ? `Watch ad 1 of ${t.ads}` : `Watch ad ${state.adsWatched + 1} of ${t.ads} · ${plural(left, 'left')}`;
    el.winHint.textContent = state.adsWatched
      ? `${plural(left, 'more ad')} and ${fmt(t.reward)} stars are yours!`
      : 'Skip the ad and the boss comes back — you start again from 0';
  }
  function showOffer(celebrate = false) {
    renderOffer();
    el.game.classList.remove('active'); el.win.classList.add('active');
    if (celebrate) { confettiBurst(); countUp(el.winAmount, Math.round(R.current(state).reward * .7), R.current(state).reward, 1000); }
    try { tg?.BackButton?.show(); tg?.BackButton?.onClick(askSkip); } catch {}
  }

  let adBusy = false;
  el.adBtn.addEventListener('click', async () => {
    if (adBusy || !R.isLocked(state)) return;
    adBusy = true; el.adBtn.classList.add('loading'); el.adBtn.disabled = true; haptic('medium');
    const res = await Ads.show();
    adBusy = false; el.adBtn.classList.remove('loading'); el.adBtn.disabled = false;
    if (!res.done) { haptic('warning'); toast(`No reward — watch the ad to the end${res.reason ? ` (${res.reason})` : ''}`); return; }

    const tier = R.current(state);
    const r = R.adWatched(state);
    state = r.state; save();
    if (!r.claimed) {
      haptic('light'); renderOffer();
      const step = el.adSteps.children[state.adsWatched - 1];
      step?.classList.add('pop');
      toast(`Ad ${state.adsWatched} of ${tier.ads} watched ✓`);
      return;
    }
    // All ads watched → stars go into the balance, the next boss starts
    haptic('success');
    collect(r.claimed, r.roundComplete);
  });

  function collect(amount, restarted) {
    const before = state.stars - amount;
    nextBoss();
    flyStars(el.boss, 14);
    countUp(el.stars, before, state.stars, 1100);
    setTimeout(() => { bump(el.stars); el.starsChip.classList.remove('glow'); void el.starsChip.offsetWidth; el.starsChip.classList.add('glow'); }, 700);
    toast(restarted ? `+${fmt(amount)} ★ — all 3 bosses beaten! New round starts` : `+${fmt(amount)} ★ added to your stars!`);
  }

  // ---------- Skip → start again from 0 ----------
  function askSkip() {
    const t = R.current(state);
    openSheet('Start over?', `If you skip, you lose the ${fmt(t.reward)} ★ reward and your points go back to 0. Your ${fmt(state.stars)} ★ stay safe.`,
      'Watch ad instead', () => {}, 'Skip and start over', () => {
        state = R.skip(state); save(); haptic('warning');
        nextBoss();
        toast('Points reset — start again from 0');
      });
  }
  el.skip.addEventListener('click', askSkip);

  function nextBoss() {
    try { tg?.BackButton?.hide(); tg?.BackButton?.offClick(askSkip); } catch {}
    el.win.classList.remove('active'); el.game.classList.add('active');
    // Effects created while the game screen was hidden never fire animationend — clear them
    el.floaters.replaceChildren(); el.particles.replaceChildren();
    el.boss.classList.remove('die'); void el.boss.offsetWidth; el.boss.classList.add('spawn');
    setTimeout(() => el.boss.classList.remove('spawn'), 750);
    lastStage = -1; busy = false; render();
  }

  function countUp(node, from, to, ms) {
    const t0 = performance.now();
    (function step(t) {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      node.textContent = fmt(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  function confettiBurst() {
    if (typeof confetti !== 'function') return;
    const colors = ['#ffc93c', '#ffb020', '#ff8a00', '#fff3c4', '#ffffff'];
    confetti({ particleCount: 120, spread: 80, origin: { y: .55 }, colors, scalar: 1.1, shapes: ['star', 'circle'], zIndex: 30 });
    setTimeout(() => confetti({ particleCount: 70, angle: 60, spread: 60, origin: { x: 0, y: .7 }, colors, zIndex: 30 }), 250);
    setTimeout(() => confetti({ particleCount: 70, angle: 120, spread: 60, origin: { x: 1, y: .7 }, colors, zIndex: 30 }), 400);
    const end = Date.now() + 2500;
    (function rain() {
      confetti({ particleCount: 3, startVelocity: 0, ticks: 220, gravity: .5, origin: { x: Math.random(), y: -.05 }, colors, shapes: ['star'], scalar: 1.3, zIndex: 30 });
      if (Date.now() < end) requestAnimationFrame(rain);
    })();
  }

  // ---------- Bottom sheet ----------
  let sheetActions = {};
  function openSheet(title, text, ok = 'Got it', onOk = null, cancel = '', onCancel = null) {
    el.sheetTitle.textContent = title; el.sheetText.textContent = text; el.sheetOk.textContent = ok;
    el.sheetCancel.hidden = !cancel; el.sheetCancel.textContent = cancel;
    sheetActions = { onOk, onCancel };
    el.sheet.classList.add('open'); haptic('light');
  }
  function closeSheet() { el.sheet.classList.remove('open'); }
  el.sheetOk.addEventListener('click', () => { closeSheet(); sheetActions.onOk?.(); });
  el.sheetCancel.addEventListener('click', () => { closeSheet(); sheetActions.onCancel?.(); });
  el.sheet.addEventListener('click', (e) => { if (e.target === el.sheet) closeSheet(); });

  el.starsChip.addEventListener('click', () => {
    openSheet(`You have ${fmt(state.stars)} ★`,
      `Tap to 1,000 → watch 1 ad → +1,000 ★. Then 3,000 → 2 ads → +3,000 ★. Then 5,000 → 3 ads → +5,000 ★. Ads watched: ${state.totalAds}. Soon you will be able to spend stars in the shop!`);
  });

  // ---------- Start ----------
  render();
  // Re-open the offer if the app was closed while it was waiting
  if (R.isLocked(state)) { busy = true; showOffer(false); }
})();
