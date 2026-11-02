/* ============================================================
   Бей БОССА! — фронтенд-логика (без бэкенда)
   Состояние хранится в localStorage. Когда появится API,
   замените функции load()/save()/onHit() на запросы к серверу.
   ============================================================ */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU'); // 5 000
  const fmtEn = (n) => Number(n || 0).toLocaleString('en-US'); // 5,000 (на карточке)
  const rnd = (a, b) => a + Math.random() * (b - a);
  const KEY = 'boss_state_v1';

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
      if (type === 'success' || type === 'error') tg?.HapticFeedback?.notificationOccurred(type);
      else tg?.HapticFeedback?.impactOccurred(type);
    } catch {}
    if (!tg && navigator.vibrate) navigator.vibrate(type === 'success' ? [30, 40, 60] : 10);
  };

  // ---------- Состояние ----------
  const defaults = { score: 0, level: 1, damage: 0, defeated: 0 };
  let state = load();
  function load() { try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...defaults }; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }

  const maxHp = () => 40 + (state.level - 1) * 15;                 // ударов до победы
  const reward = () => 5000 + (state.level - 1) * 1000;            // награда за босса
  const titles = [
    ['Это твой первый босс', 'Ударь его!'],
    ['Босс ещё держится', 'Продолжай бить!'],
    ['Он слабеет!', 'Не останавливайся!'],
    ['Последний рывок!', 'Добей его!'],
  ];

  // ---------- Элементы ----------
  const el = {
    game: $('#screen-game'), win: $('#screen-win'),
    score: $('#score'), boss: $('#boss'), hpFill: $('#hp-fill'), hpBar: $('#hp-bar'),
    title: $('#boss-title'), sub: $('#boss-sub'), hit: $('#hit-btn'),
    floaters: $('#floaters'), particles: $('#particles'), flash: $('#flash'),
    prizeAmount: $('#prize-amount'), winAmount: $('#win-amount'), claimAmount: $('#claim-amount'),
    claim: $('#claim-btn'), again: $('#again-btn'), withdraw: $('#withdraw-btn'),
    sheet: $('#sheet-backdrop'), sheetTitle: $('#sheet-title'), sheetText: $('#sheet-text'), sheetOk: $('#sheet-ok'),
    toast: $('#toast'),
  };

  // ---------- Фон: звёздочки и искры ----------
  (function background() {
    const stars = $('#bg-stars');
    for (let i = 0; i < 18; i++) {
      const s = document.createElement('span');
      s.textContent = Math.random() > .5 ? '★' : '✦';
      s.style.cssText = `left:${rnd(0, 100)}%;top:${rnd(0, 100)}%;font-size:${rnd(8, 22)}px;--dur:${rnd(5, 10)}s;--delay:${rnd(-10, 0)}s;`;
      stars.appendChild(s);
    }
    const embers = $('#embers');
    for (let i = 0; i < 22; i++) {
      const e = document.createElement('i');
      e.style.cssText = `--x:${rnd(15, 85)}%;--s:${rnd(3, 7)}px;--dur:${rnd(3, 6)}s;--delay:${rnd(-6, 0)}s;--dx:${rnd(-60, 60)}px;`;
      embers.appendChild(e);
    }
  })();

  // ---------- Рендер ----------
  let lastStage = -1;
  function render() {
    el.score.textContent = fmt(state.score);
    const pct = Math.max(0, 1 - state.damage / maxHp());
    el.hpFill.style.width = `${pct * 100}%`;
    el.hpBar.setAttribute('aria-valuenow', Math.round(pct * 100));
    el.hpFill.classList.toggle('low', pct < .25);
    el.boss.classList.toggle('weak', pct < .35);

    const stage = state.level === 1 && state.damage === 0 ? 0 : pct > .6 ? 1 : pct > .25 ? 2 : 3;
    if (stage !== lastStage) {
      lastStage = stage;
      const [t, s] = stage === 0 ? titles[0] : stage === 1 && state.level > 1 ? [`Босс №${state.level}`, 'Ударь его!'] : titles[stage];
      el.title.textContent = t; el.sub.textContent = s;
      el.title.classList.remove('swap'); void el.title.offsetWidth; el.title.classList.add('swap');
    }
  }

  // ---------- Эффекты ----------
  let hitFlip = false;
  function bossShake() {
    el.boss.classList.remove('hit', 'hit-alt'); void el.boss.offsetWidth;
    el.boss.classList.add(hitFlip ? 'hit-alt' : 'hit'); hitFlip = !hitFlip;
  }
  function bossCenter() {
    const a = el.floaters.getBoundingClientRect(), b = el.boss.getBoundingClientRect();
    return { x: b.left + b.width / 2 - a.left, y: b.top + b.height / 2 - a.top };
  }
  function floater(text, big = false) {
    const c = bossCenter();
    const f = document.createElement('span');
    f.className = 'floater' + (big ? ' big' : '');
    f.textContent = text;
    f.style.cssText = `--x:${c.x + rnd(-70, 70)}px;--y:${c.y + rnd(-50, 30)}px;--dx:${rnd(-50, 50)}px;`;
    el.floaters.appendChild(f);
    f.addEventListener('animationend', () => f.remove());
  }
  function sparks(count = 10) {
    const c = bossCenter();
    const colors = ['#fff', '#ffe08a', '#ffc93c', '#ff9a1f'];
    for (let i = 0; i < count; i++) {
      const s = document.createElement('i');
      const ang = rnd(0, Math.PI * 2), dist = rnd(70, 170);
      s.className = 'spark';
      s.style.cssText = `--x:${c.x}px;--y:${c.y}px;--s:${rnd(4, 10)}px;--c:${colors[i % colors.length]};--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist}px;`;
      el.particles.appendChild(s);
      s.addEventListener('animationend', () => s.remove());
    }
  }
  function bumpScore() { el.score.classList.remove('bump'); void el.score.offsetWidth; el.score.classList.add('bump'); }
  let toastTimer;
  function toast(msg) { el.toast.textContent = msg; el.toast.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('visible'), 2800); }

  // ---------- Удар ----------
  let busy = false;
  function onHit() {
    if (busy) return;
    const hp = maxHp();
    const gain = Math.floor(rnd(50, 150));                // очки за удар, как в оригинале (+75, +127 ...)
    state.damage += 1; state.score += gain;
    const crit = Math.random() < .12;
    bossShake(); sparks(crit ? 18 : 10); floater(`+${crit ? gain * 2 : gain}`, crit);
    if (crit) state.score += gain;
    bumpScore(); haptic(crit ? 'medium' : 'light');
    render(); save();
    if (state.damage >= hp) defeat();
  }
  function pressBtn() { el.hit.classList.add('pressed'); setTimeout(() => el.hit.classList.remove('pressed'), 90); }

  // Мгновенный отклик на pointerdown (без задержки клика)
  el.hit.addEventListener('pointerdown', (e) => { e.preventDefault(); pressBtn(); onHit(); });
  el.boss.addEventListener('pointerdown', (e) => { e.preventDefault(); onHit(); });
  document.addEventListener('keydown', (e) => { if (e.code === 'Space' && el.game.classList.contains('active') && !el.sheet.classList.contains('open')) { e.preventDefault(); pressBtn(); onHit(); } });

  // ---------- Победа ----------
  function defeat() {
    busy = true;
    const prize = reward();
    state.defeated += 1; state.level += 1; state.damage = 0; save();
    haptic('success');
    el.boss.classList.remove('hit', 'hit-alt', 'weak'); void el.boss.offsetWidth; el.boss.classList.add('die');
    sparks(30); floater('БОСС ПОВЕРЖЕН!', true);
    setTimeout(() => { el.flash.classList.remove('go'); void el.flash.offsetWidth; el.flash.classList.add('go'); }, 300);
    setTimeout(() => showWin(prize), 650);
  }
  function showWin(prize) {
    el.prizeAmount.textContent = fmtEn(prize);
    el.winAmount.textContent = fmt(prize);
    el.claimAmount.textContent = fmt(prize);
    el.game.classList.remove('active'); el.win.classList.add('active');
    confettiBurst();
    try { tg?.BackButton?.show(); tg?.BackButton?.onClick(nextBoss); } catch {}
  }
  function confettiBurst() {
    if (typeof confetti !== 'function') return;
    const colors = ['#ffc93c', '#ffb020', '#ff8a00', '#fff3c4', '#ffffff'];
    confetti({ particleCount: 120, spread: 80, origin: { y: .55 }, colors, scalar: 1.1, shapes: ['star', 'circle'], zIndex: 30 });
    setTimeout(() => confetti({ particleCount: 70, angle: 60, spread: 60, origin: { x: 0, y: .7 }, colors, zIndex: 30 }), 250);
    setTimeout(() => confetti({ particleCount: 70, angle: 120, spread: 60, origin: { x: 1, y: .7 }, colors, zIndex: 30 }), 400);
    // медленно падающие звёзды сверху ~2.5 с
    const end = Date.now() + 2500;
    (function rain() {
      confetti({ particleCount: 3, startVelocity: 0, ticks: 220, gravity: .5, origin: { x: Math.random(), y: -.05 }, colors, shapes: ['star'], scalar: 1.3, zIndex: 30 });
      if (Date.now() < end) requestAnimationFrame(rain);
    })();
  }
  function nextBoss() {
    try { tg?.BackButton?.hide(); tg?.BackButton?.offClick(nextBoss); } catch {}
    el.win.classList.remove('active'); el.game.classList.add('active');
    el.boss.classList.remove('die'); void el.boss.offsetWidth; el.boss.classList.add('spawn');
    setTimeout(() => el.boss.classList.remove('spawn'), 750);
    lastStage = -1; busy = false; render();
  }
  el.again.addEventListener('click', nextBoss);

  // ---------- Листы (Вывести / Забрать) ----------
  function openSheet(title, text, ok = 'Понятно') {
    el.sheetTitle.textContent = title; el.sheetText.textContent = text; el.sheetOk.textContent = ok;
    el.sheet.classList.add('open'); haptic('light');
  }
  function closeSheet() { el.sheet.classList.remove('open'); }
  el.sheetOk.addEventListener('click', closeSheet);
  el.sheet.addEventListener('click', (e) => { if (e.target === el.sheet) closeSheet(); });

  el.withdraw.addEventListener('click', () => {
    const won = state.defeated * 5000 + Math.max(0, state.defeated - 1) * 500 * state.defeated;
    openSheet('Вывод звёзд', state.defeated
      ? `У тебя накликано ${fmt(state.score)} ★ и повержено боссов: ${state.defeated}. Забрать звёзды можно по ссылке после победы над боссом.`
      : 'Чтобы вывести звёзды, сначала победи босса — награда 5 000 ★ ждёт тебя!');
  });

  el.claim.addEventListener('click', () => {
    haptic('medium');
    // TODO(backend): сюда подставится ссылка/инвойс от сервера
    const url = window.CLAIM_URL || '';
    if (url) { tg?.openTelegramLink ? tg.openTelegramLink(url) : window.open(url, '_blank'); return; }
    openSheet('Забрать звёзды', 'Ссылка на получение награды появится после подключения бэкенда. Напиши мне — и я выдам звёзды вручную!', 'Хорошо');
  });

  // ---------- Старт ----------
  render();
  window.addEventListener('resize', () => document.documentElement.style.setProperty('--vh', `${window.innerHeight}px`));
})();
