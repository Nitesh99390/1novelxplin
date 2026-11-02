/* ============================================================
   Star Pass — Mini App for paid groups & channels (Telegram Stars)
   Tabs: Explore · My memberships · Manage (owner control panel)
   ============================================================ */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const CFG = window.APP_CONFIG || {};
  const DAY = 86400000;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const plural = (n, w) => `${fmt(n)} ${w}${Number(n) === 1 ? '' : 's'}`;
  const star = '<img src="/assets/star.png" alt="" class="star-ico">';
  const date = (ms) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const initial = (t) => esc((String(t || '?').trim()[0] || '?').toUpperCase());
  const avatar = (c, cls = '') => `<div class="avatar ${cls}">${c.hasPhoto ? `<img src="/photo/${esc(c.slug)}" alt="" onerror="this.remove()">` : ''}${c.hasPhoto ? '' : initial(c.title)}</div>`;
  const kindIco = (k) => (k === 'channel' ? '📢' : '👥');

  // ---------- Telegram WebApp ----------
  const tg = window.Telegram?.WebApp;
  const inTelegram = !!tg?.initData;
  if (tg) {
    try {
      tg.ready(); tg.expand();
      if (tg.isVersionAtLeast?.('6.1')) { tg.setHeaderColor('#000000'); tg.setBackgroundColor('#000000'); }
      if (tg.isVersionAtLeast?.('7.10')) tg.setBottomBarColor('#0a0a0a');
    } catch {}
  }
  const haptic = (t = 'light') => {
    try { if (['success', 'error', 'warning'].includes(t)) tg?.HapticFeedback?.notificationOccurred(t); else tg?.HapticFeedback?.impactOccurred(t); } catch {}
  };
  const openTg = (url) => { if (tg?.openTelegramLink && /^https:\/\/t\.me\//.test(url)) tg.openTelegramLink(url); else window.open(url, '_blank'); };

  // Dev mode (browser testing only, server must run with DEV_AUTH=1): ?dev=<telegram id>
  const qs = new URLSearchParams(location.search);
  if (qs.get('dev')) localStorage.setItem('dev_user', qs.get('dev'));
  const devUser = CFG.devAuth ? localStorage.getItem('dev_user') : null;

  // ---------- API ----------
  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (tg?.initData) headers['X-Telegram-Init-Data'] = tg.initData;
    else if (devUser) headers['X-Dev-User'] = devUser;
    const r = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.message || `Error ${r.status}`); e.status = r.status; e.code = data.error; throw e; }
    return data;
  }

  // ---------- UI helpers ----------
  const view = $('#view');
  let toastTimer;
  function toast(msg, type = '') {
    const t = $('#toast');
    t.textContent = msg; t.className = `toast show ${type}`;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function confirmDlg(message) {
    return new Promise((res) => {
      if (tg?.showConfirm && inTelegram) { try { return tg.showConfirm(message, res); } catch {} }
      res(window.confirm(message));
    });
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied ✅'); haptic('success'); } catch { toast(text); }
  }
  function celebrate() {
    haptic('success');
    try { window.confetti?.({ particleCount: 120, spread: 80, origin: { y: .6 }, colors: ['#ffc93c', '#ff8a00', '#ffffff'] }); } catch {}
  }

  const sheet = $('#sheet');
  function openSheet(html, onMount) {
    $('#sheet-body').innerHTML = html;
    sheet.hidden = false;
    onMount?.($('#sheet-body'));
  }
  function closeSheet() { sheet.hidden = true; $('#sheet-body').innerHTML = ''; }
  sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-close]')) closeSheet(); });

  // Busy button wrapper: disables the button while the promise runs
  async function busy(btn, fn) {
    if (btn?.disabled) return;
    const html = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loader" style="padding:0"><span style="width:18px;height:18px;border-width:3px"></span></span>'; }
    try { return await fn(); } catch (e) { toast(e.message || 'Something went wrong', 'error'); haptic('error'); } finally {
      if (btn?.isConnected) { btn.disabled = false; btn.innerHTML = html; }
    }
  }

  // ---------- Router ----------
  // Routes: explore | chat:<slug> | my | manage | manage:<slug>
  const stack = [];
  let current = null;
  let timers = [];
  const clearTimers = () => { timers.forEach(clearInterval); timers = []; };
  const tabOf = (r) => (r.startsWith('chat') ? 'explore' : r.split(':')[0]);

  function go(route, { push = true } = {}) {
    if (push && current && current !== route) stack.push(current);
    current = route;
    clearTimers();
    closeSheet();
    const tab = tabOf(route);
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const canBack = stack.length > 0 && route.includes(':');
    $('#back').hidden = !canBack;
    if (tg?.isVersionAtLeast?.('6.1')) { try { canBack ? tg.BackButton.show() : tg.BackButton.hide(); } catch {} }
    window.scrollTo(0, 0);
    view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
    const [name, arg] = route.split(':');
    const pages = { explore: pageExplore, chat: pageChat, my: pageMy, manage: arg ? pageManageChat : pageManage };
    (pages[name] || pageExplore)(arg).catch(showError);
  }
  function back() {
    const prev = stack.pop();
    go(prev || tabOf(current || 'explore'), { push: false });
  }
  $('#back').addEventListener('click', back);
  if (tg?.isVersionAtLeast?.('6.1')) { try { tg.BackButton.onClick(back); } catch {} }
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    haptic('light');
    stack.length = 0;
    go(b.dataset.tab, { push: false });
  });

  function setTitle(t) { $('#title').textContent = t; }
  function loading() { view.innerHTML = '<div class="list"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>'; }
  function showError(e) {
    if (e?.status === 401) {
      view.innerHTML = `<div class="empty"><div class="big">🔒</div><h1>Open in Telegram</h1><p class="sub">This Mini App works inside Telegram. Open it from the bot${CFG.botUsername ? ` <a href="https://t.me/${esc(CFG.botUsername)}">@${esc(CFG.botUsername)}</a>` : ''}.</p></div>`;
      return;
    }
    view.innerHTML = `<div class="empty"><div class="big">😕</div><h1>Oops</h1><p class="sub">${esc(e?.message || 'Something went wrong')}</p><button class="btn gold" id="retry">Try again</button></div>`;
    $('#retry').onclick = () => go(current, { push: false });
  }

  // ======================================================== EXPLORE
  async function pageExplore() {
    setTitle('Star Pass');
    loading();
    const { chats } = await api('/explore');
    const card = (c) => `
      <button class="card chat-card" data-slug="${esc(c.slug)}" data-q="${esc((c.title + ' ' + (c.username || '')).toLowerCase())}">
        ${avatar(c)}
        <div class="grow">
          <div class="ellipsis" style="font-weight:900">${esc(c.title)}</div>
          <div class="muted ellipsis">${kindIco(c.kind)} ${c.kind === 'channel' ? 'Channel' : 'Group'}${c.activeMembers ? ` · ${plural(c.activeMembers, 'member')}` : ''} · ${plural(c.planCount, 'plan')}</div>
        </div>
        <div class="price"><span class="muted">from</span><b>${star}${fmt(c.minStars)}</b></div>
      </button>`;
    view.innerHTML = `
      <div class="hero"><img src="/assets/star.png" alt=""><h1>Paid groups & channels</h1>
        <p class="sub">Pay with ⭐ Telegram Stars, get a personal one-time invite link, enjoy your access.</p></div>
      ${chats.length > 4 ? '<input class="search" id="search" type="search" placeholder="🔍  Search groups & channels">' : ''}
      <div class="list" id="chat-list">${chats.map(card).join('') || `
        <div class="empty"><div class="big">🌟</div><h1>Nothing here yet</h1>
          <p class="sub">Own a group or channel? Add the bot as admin and start selling memberships.</p>
          <button class="btn gold" data-go="manage">⚙️ Start selling</button></div>`}
      </div>`;
    $('#search')?.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      $$('#chat-list .chat-card').forEach((n) => n.classList.toggle('hidden', q && !n.dataset.q.includes(q)));
    });
  }

  // ======================================================== CHAT (buy)
  async function pageChat(slug) {
    loading();
    const d = await api(`/chats/${encodeURIComponent(slug)}`);
    const c = d.chat;
    setTitle(c.title);
    const plans = d.plans;
    // "Best value" = lowest stars per day (only when there are 2+ plans)
    let best = null;
    if (plans.length > 1) best = plans.reduce((a, p) => (p.stars / p.days < a.stars / a.days ? p : a)).id;
    let sel = plans.find((p) => p.id === best)?.id || plans[0]?.id;
    const m = d.membership;

    const memBox = m ? `<div class="card" style="margin-top:14px;border-color:rgba(255,201,60,.35)">
        <div class="row"><span style="font-size:22px">${m.status === 'active' ? '✅' : '🎟️'}</span>
          <div class="grow"><b>${m.status === 'active' ? 'You are a member' : 'Payment received — join now!'}</b>
            <div class="muted">${m.status === 'active' ? `Ends ${date(m.expiresAt)}` : `${plural(m.days, 'day')} start when you join`}</div></div>
          <button class="btn sm" data-go="my">View</button></div></div>` : '';

    view.innerHTML = `
      <div class="chat-head">
        ${avatar(c, 'lg')}
        <h1>${esc(c.title)}</h1>
        <div class="chips">
          <span class="chip">${kindIco(c.kind)} ${c.kind === 'channel' ? 'Channel' : 'Group'}</span>
          ${c.memberCount ? `<span class="chip">${plural(c.memberCount, 'member')}</span>` : ''}
          <span class="chip gold">🔒 Private</span>
        </div>
        ${c.description ? `<p class="desc">${esc(c.description)}</p>` : ''}
      </div>
      ${memBox}
      ${d.isOwner ? `<div class="card" style="margin-top:14px"><div class="row"><span>👑</span><div class="grow"><b>You own this ${c.kind}</b><div class="muted">Manage plans, members and earnings</div></div><button class="btn sm" data-go="manage:${esc(c.slug)}">Manage</button></div></div>` : ''}
      ${!c.available || !plans.length ? `<div class="empty"><div class="big">⏸️</div><h1 style="font-size:20px">Not available right now</h1><p class="sub">The owner has paused sales. Please check back later.</p></div>` : `
      <h2>${m ? 'Extend your membership' : 'Choose your plan'}</h2>
      <div class="plans" id="plans">${plans.map((p) => `
        <button class="plan ${p.id === sel ? 'sel' : ''}" data-plan="${p.id}">
          ${p.id === best ? '<span class="best">BEST VALUE</span>' : ''}
          <span class="radio"></span>
          <div class="grow"><div class="days">${p.title ? esc(p.title) : plural(p.days, 'day')}</div>
            <div class="per">${p.title ? plural(p.days, 'day') + ' · ' : ''}≈ ${fmt(Math.round((p.stars / p.days) * 10) / 10)} ⭐ / day</div></div>
          <div class="stars">${star}${fmt(p.stars)}</div>
        </button>`).join('')}</div>
      <h2>How it works</h2>
      <div class="how">
        <div><b>1</b>Pay with Telegram Stars — safe, inside Telegram.</div>
        <div><b>2</b>The bot sends you a <span class="gold">personal one-time invite link</span>.</div>
        <div><b>3</b>Your days start counting <span class="gold">when you join</span>. You'll get a reminder before it ends.</div>
      </div>
      <div class="sticky-cta"><button class="btn gold" id="buy"></button></div>`}`;

    const buyBtn = $('#buy');
    const label = () => {
      const p = plans.find((x) => x.id === sel);
      if (buyBtn && p) buyBtn.innerHTML = `${m ? 'Extend' : 'Get access'} · ${plural(p.days, 'day')} for ${star}${fmt(p.stars)}`;
    };
    label();
    $('#plans')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-plan]');
      if (!b) return;
      sel = Number(b.dataset.plan); haptic('light');
      $$('#plans .plan').forEach((n) => n.classList.toggle('sel', Number(n.dataset.plan) === sel));
      label();
    });
    buyBtn?.addEventListener('click', () => busy(buyBtn, () => buy(sel, c)));
  }

  async function buy(planId, chat) {
    const o = await api('/orders', { method: 'POST', body: { planId } });
    if (!tg?.openInvoice || !inTelegram) { window.open(o.invoiceLink, '_blank'); return; }
    await new Promise((resolve) => {
      tg.openInvoice(o.invoiceLink, async (status) => {
        resolve();
        if (status === 'paid') { await afterPaid(o.orderId, chat); }
        else if (status === 'failed') { toast('Payment failed', 'error'); haptic('error'); }
        else if (status === 'pending') toast('Payment is processing…');
      });
    });
  }

  /** Waits for the bot to confirm the payment, then shows the join screen. */
  async function afterPaid(orderId, chat) {
    view.innerHTML = '<div class="empty"><div class="loader"><span></span></div><h1 style="font-size:20px">Confirming payment…</h1><p class="sub">Creating your personal invite link</p></div>';
    let res = null;
    for (let i = 0; i < 20; i++) {
      try { res = await api(`/orders/${orderId}`); if (res.status !== 'pending' && res.membership) break; } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    const m = res?.membership;
    celebrate();
    if (res?.status === 'refunded') {
      view.innerHTML = `<div class="empty"><div class="big">😔</div><h1>Refunded</h1><p class="sub">The bot couldn't create an invite link, so your Stars were refunded.</p><button class="btn" data-go="explore">Back</button></div>`;
      return;
    }
    const joinBtn = m?.inviteLink ? `<button class="btn gold" id="join">🚀 Join ${esc(chat.title)}</button>` : '';
    view.innerHTML = `
      <div class="empty">
        <div class="big">🎉</div>
        <h1>${m?.status === 'active' ? 'Membership extended!' : 'Payment successful!'}</h1>
        <p class="sub">${m?.status === 'active'
          ? `Your access to <b>${esc(chat.title)}</b> now ends on <b>${date(m.expiresAt)}</b>.`
          : `Your <b>one-time invite link</b> for <b>${esc(chat.title)}</b> was sent to your chat with the bot.<br>⏳ Your ${plural(m?.days || 0, 'day')} start when you join.`}</p>
        <div class="list">${joinBtn}<button class="btn" data-go="my">🎟️ My memberships</button></div>
      </div>`;
    $('#join')?.addEventListener('click', () => openTg(m.inviteLink));
  }

  // Generic [data-go] navigation
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) { haptic('light'); go(g.dataset.go); return; }
    const c = e.target.closest('.chat-card[data-slug]');
    if (c) { haptic('light'); go(`chat:${c.dataset.slug}`); }
  });

  // ======================================================== MY MEMBERSHIPS
  function splitLeft(ms) {
    ms = Math.max(0, ms);
    return { d: Math.floor(ms / DAY), h: Math.floor((ms % DAY) / 3600000), m: Math.floor((ms % 3600000) / 60000), s: Math.floor((ms % 60000) / 1000) };
  }
  const pad = (n) => String(n).padStart(2, '0');

  async function pageMy() {
    setTitle('My memberships');
    loading();
    const { memberships } = await api('/my');
    const live = memberships.filter((m) => m.status === 'paid' || m.status === 'active');
    const past = memberships.filter((m) => m.status !== 'paid' && m.status !== 'active');
    $('#my-dot').hidden = !live.some((m) => m.status === 'paid');
    const statusChip = (m) => ({
      active: '<span class="chip green">● Active</span>', paid: '<span class="chip blue">Waiting to join</span>',
      expired: '<span class="chip">Expired</span>', removed: '<span class="chip red">Removed</span>',
    }[m.status] || '');

    const card = (m) => {
      const c = m.chat;
      let body = '';
      if (m.status === 'active') {
        const total = m.expiresAt - m.joinedAt;
        const pct = total > 0 ? Math.max(0, Math.min(100, (m.leftMs / total) * 100)) : 0;
        body = `<div class="countdown" data-exp="${m.expiresAt}">${['d', 'h', 'm', 's'].map((k, i) => `<div><b data-k="${k}">--</b><span>${['days', 'hours', 'min', 'sec'][i]}</span></div>`).join('')}</div>
          <div class="bar ${pct < 15 ? 'low' : ''}"><i style="width:${pct}%"></i></div>
          <div class="muted" style="margin-top:8px">Ends ${date(m.expiresAt)}${m.inChat ? '' : ' · <span style="color:var(--red)">you left the chat</span>'}</div>
          <div class="btn-row" style="margin-top:12px">${c.username ? `<button class="btn sm" data-open="https://t.me/${esc(c.username)}">Open</button>` : ''}
            <button class="btn sm gold" data-go="chat:${esc(c.slug)}">⭐ Extend</button></div>`;
      } else if (m.status === 'paid') {
        body = `<div class="waiting">⏳ <b>${plural(m.days, 'day')}</b> are waiting for you. The countdown starts <b>when you join</b>.${m.inviteLink ? '' : '<br>Your link expired — get a new one below.'}</div>
          <div class="btn-row" style="margin-top:12px">${m.inviteLink ? `<button class="btn gold" data-open="${esc(m.inviteLink)}">🚀 Join now</button>` : ''}
            <button class="btn ${m.inviteLink ? 'sm' : 'gold'}" data-newlink="${m.id}">${m.inviteLink ? '🔄 New link' : '🔗 Get a new link'}</button></div>`;
      } else {
        body = `<div class="muted" style="margin-top:6px">${m.status === 'expired' ? 'Ended' : 'Removed'} · ${plural(m.days, 'day')}</div>
          <button class="btn sm" style="margin-top:10px" data-go="chat:${esc(c.slug)}">⭐ Buy again</button>`;
      }
      return `<div class="card mem"><div class="row">${avatar(c, 'sm')}<div class="grow"><div class="ellipsis" style="font-weight:900">${esc(c.title)}</div>
        <div class="muted">${kindIco(c.kind)} ${c.kind === 'channel' ? 'Channel' : 'Group'}</div></div>${statusChip(m)}</div>${body}</div>`;
    };

    view.innerHTML = memberships.length ? `
      ${live.length ? `<div class="list">${live.map(card).join('')}</div>` : '<div class="empty" style="padding:20px"><p class="sub">No active memberships.</p></div>'}
      ${past.length ? `<h2>History</h2><div class="list">${past.map(card).join('')}</div>` : ''}` : `
      <div class="empty"><div class="big">🎟️</div><h1>No memberships yet</h1>
        <p class="sub">Find a group or channel you like and join it with Telegram Stars.</p>
        <button class="btn gold" data-go="explore">🔍 Explore</button></div>`;

    // Live countdown
    const tickCd = () => $$('.countdown[data-exp]').forEach((el) => {
      const left = Number(el.dataset.exp) - Date.now();
      const t = splitLeft(left);
      el.querySelector('[data-k=d]').textContent = t.d;
      el.querySelector('[data-k=h]').textContent = pad(t.h);
      el.querySelector('[data-k=m]').textContent = pad(t.m);
      el.querySelector('[data-k=s]').textContent = pad(t.s);
      if (left <= 0 && !el.dataset.done) { el.dataset.done = 1; setTimeout(() => current === 'my' && go('my', { push: false }), 4000); }
    });
    tickCd();
    timers.push(setInterval(tickCd, 1000));

    view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openTg(b.dataset.open)));
    view.querySelectorAll('[data-newlink]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      await api(`/memberships/${b.dataset.newlink}/link`, { method: 'POST' });
      toast('New link sent to your chat ✅'); haptic('success');
      go('my', { push: false });
    })));
  }

  // ======================================================== MANAGE (owner)
  let meInfo = null;
  async function pageManage() {
    setTitle('Manage');
    loading();
    const [{ chats }, me] = await Promise.all([api('/owner/chats'), meInfo ? Promise.resolve(meInfo) : api('/me')]);
    meInfo = me;
    const addBtns = `<div class="btn-row">
        ${me.bot.addToGroup ? `<button class="btn ${chats.length ? '' : 'gold'}" data-open="${esc(me.bot.addToGroup)}">👥 Add to group</button>` : ''}
        ${me.bot.addToChannel ? `<button class="btn ${chats.length ? '' : 'gold'}" data-open="${esc(me.bot.addToChannel)}">📢 Add to channel</button>` : ''}</div>`;
    const totals = chats.reduce((a, c) => ({ rev: a.rev + c.stats.revenue, act: a.act + c.stats.active, sales: a.sales + c.stats.sales }), { rev: 0, act: 0, sales: 0 });
    const statusChip = (c) => (c.status === 'active' ? (c.salesEnabled ? '<span class="chip green">● Selling</span>' : '<span class="chip">Paused</span>')
      : c.status === 'no_rights' ? '<span class="chip red">Needs rights</span>' : c.status === 'removed' ? '<span class="chip red">Bot removed</span>' : '<span class="chip">Setup</span>');

    view.innerHTML = chats.length ? `
      <div class="stats">
        <div class="stat wide"><span>Total earned</span><b>${star}${fmt(totals.rev)}</b></div>
        <div class="stat"><b>${fmt(totals.act)}</b><span>Active members</span></div>
        <div class="stat"><b>${fmt(totals.sales)}</b><span>Sales</span></div>
      </div>
      <h2>Your groups & channels</h2>
      <div class="list">${chats.map((c) => `
        <button class="card chat-card" data-go="manage:${esc(c.slug)}">${avatar(c)}
          <div class="grow"><div class="ellipsis" style="font-weight:900">${esc(c.title)}</div>
            <div class="muted ellipsis">${kindIco(c.kind)} ${plural(c.stats.active, 'member')} · ${star}${fmt(c.stats.revenue)} · ${plural(c.planCount, 'plan')}</div></div>
          ${statusChip(c)}</button>`).join('')}</div>
      <h2>Connect another</h2>${addBtns}` : `
      <div class="empty"><div class="big">👑</div><h1>Sell access with Stars</h1>
        <p class="sub">Turn your group or channel into a paid membership in 1 minute.</p>
        <div class="steps how">
          <div><b>1</b>Add the bot to your group / channel as <span class="gold">admin</span> (invite users + ban users).</div>
          <div><b>2</b>The bot sends you a <span class="gold">private message</span> — pick the price in Stars and the number of days.</div>
          <div><b>3</b>Share your link. Members pay here, get a <span class="gold">one-time invite link</span>, and are removed automatically when their time is over.</div>
        </div>${addBtns}</div>`;
    view.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openTg(b.dataset.open)));
  }

  async function pageManageChat(slug) {
    loading();
    const d = await api(`/owner/chats/${encodeURIComponent(slug)}`);
    renderManage(d);
  }

  let memberFilter = 'active';
  function renderManage(d) {
    const c = d.chat, s = d.stats;
    setTitle(c.title);
    const path = `/owner/chats/${encodeURIComponent(c.slug)}`;
    const rightsWarn = c.status !== 'active' ? `<div class="warn">⚠️ ${c.status === 'removed'
      ? 'The bot was removed from this chat. Add it back as admin to resume sales.'
      : `The bot needs admin rights: <b>Invite users via link</b>${c.kind === 'group' ? ' and <b>Ban users</b>' : ''}. Sales are paused until then.`}
      <div style="margin-top:8px"><button class="btn sm" id="recheck">🔄 Re-check rights</button></div></div>` : '';
    const groups = { active: d.members.filter((m) => m.status === 'active'), paid: d.members.filter((m) => m.status === 'paid'), ended: d.members.filter((m) => !['active', 'paid'].includes(m.status)) };
    if (!groups[memberFilter]) memberFilter = 'active';

    const memberRow = (m) => {
      const info = m.status === 'active' ? `${splitLeft(m.leftMs).d}d ${splitLeft(m.leftMs).h}h left · ends ${date(m.expiresAt)}`
        : m.status === 'paid' ? `Paid ${date(m.paidAt)} · not joined yet · ${plural(m.days, 'day')}`
          : `${m.status === 'expired' ? 'Expired' : 'Removed'} ${m.endedAt ? date(m.endedAt) : ''}`;
      return `<div class="card member"><div class="avatar sm">${initial(m.user.name)}</div>
        <div class="grow"><div class="ellipsis" style="font-weight:800">${esc(m.user.name)} ${m.user.username ? `<span class="muted">@${esc(m.user.username)}</span>` : ''}</div>
          <div class="muted ellipsis">${info}</div></div>
        ${['active', 'paid'].includes(m.status) ? `<button class="btn sm" data-member="${m.id}" aria-label="Member actions">⋯</button>` : ''}</div>`;
    };

    view.innerHTML = `
      ${rightsWarn}
      <div class="row" style="margin-bottom:14px">${avatar(c)}<div class="grow"><h1 style="font-size:21px;margin:0" class="ellipsis">${esc(c.title)}</h1>
        <div class="muted">${kindIco(c.kind)} ${c.kind === 'channel' ? 'Channel' : 'Group'}${c.memberCount ? ` · ${plural(c.memberCount, 'member')} total` : ''}</div></div></div>

      <div class="stats">
        <div class="stat wide"><span>Earned (all time)</span><b>${star}${fmt(s.revenue)}</b><span>Last 30 days: ${fmt(s.revenue30d)} ⭐ · ${plural(s.sales, 'sale')}</span></div>
        <div class="stat"><b>${fmt(s.active)}</b><span>Active members</span></div>
        <div class="stat"><b>${fmt(s.waiting)}</b><span>Paid, not joined</span></div>
      </div>

      ${d.shareLink ? `<h2>Share link</h2><div class="share"><code>${esc(d.shareLink)}</code><button class="btn sm" id="copy">Copy</button><button class="btn sm gold" id="share">Share</button></div>` : ''}

      <h2>Plans <button class="btn sm gold" id="add-plan">＋ Add plan</button></h2>
      <div class="list">${d.plans.map((p) => `
        <div class="card plan-row ${p.active ? '' : 'off'}">
          <div class="grow"><div style="font-weight:900;font-size:16px">${p.title ? esc(p.title) + ' · ' : ''}${plural(p.days, 'day')}</div>
            <div class="muted">${p.active ? 'Visible to buyers' : 'Hidden'}</div></div>
          <b class="gold" style="font-size:18px">${star}${fmt(p.stars)}</b>
          <button class="btn sm" data-plan="${p.id}" aria-label="Edit plan">✏️</button>
        </div>`).join('') || '<div class="card muted center">No plans yet — add one so people can buy.</div>'}</div>

      <h2>Settings</h2>
      <div class="card" style="padding:4px 14px">
        <div class="setting"><div class="grow"><b>Sales enabled</b><div class="muted">Allow new purchases & renewals</div></div><button class="switch ${c.salesEnabled ? 'on' : ''}" data-toggle="salesEnabled" aria-label="Sales enabled"></button></div>
        <div class="setting"><div class="grow"><b>Show in Explore</b><div class="muted">List publicly in the Mini App</div></div><button class="switch ${c.listed ? 'on' : ''}" data-toggle="listed" aria-label="Show in Explore"></button></div>
        <div class="setting"><div class="grow"><b>Description</b><div class="muted ellipsis">${c.description ? esc(c.description) : 'Tell buyers what they get'}</div></div><button class="btn sm" id="edit-desc">Edit</button></div>
      </div>

      <h2>Members</h2>
      <div class="seg" id="seg">
        <button data-f="active">Active (${groups.active.length})</button>
        <button data-f="paid">Not joined (${groups.paid.length})</button>
        <button data-f="ended">Ended (${groups.ended.length})</button>
      </div>
      <div class="list" id="members">${groups[memberFilter].map(memberRow).join('') || '<div class="card muted center">Nobody here yet.</div>'}</div>

      ${d.orders.length ? `<h2>Recent sales</h2><div class="list">${d.orders.slice(0, 15).map((o) => `
        <div class="card member"><div class="grow"><div class="ellipsis" style="font-weight:800">${esc(o.user.name)}</div>
          <div class="muted">${date(o.paidAt)} · ${plural(o.days, 'day')}${o.status === 'refunded' ? ' · <span style="color:var(--red)">refunded</span>' : ''}</div></div>
          <b class="gold">+${fmt(o.stars)} ⭐</b></div>`).join('')}</div>` : ''}
      <div style="height:10px"></div>
      <button class="btn" data-go="chat:${esc(c.slug)}">👁️ Preview buyer page</button>`;

    $$('#seg button').forEach((b) => b.classList.toggle('active', b.dataset.f === memberFilter));
    $('#seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      memberFilter = b.dataset.f; haptic('light'); renderManage(d);
    });
    $('#copy')?.addEventListener('click', () => copy(d.shareLink));
    $('#share')?.addEventListener('click', () => openTg(`https://t.me/share/url?url=${encodeURIComponent(d.shareLink)}&text=${encodeURIComponent(`Join ${c.title} with Telegram Stars ⭐`)}`));
    $('#recheck')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const nd = await api(`${path}/refresh`, { method: 'POST' });
      toast(nd.chat.status === 'active' ? 'All good ✅' : 'Rights still missing'); renderManage(nd);
    }));
    $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      const key = b.dataset.toggle;
      const nd = await api(path, { method: 'PATCH', body: { [key]: !b.classList.contains('on') } });
      haptic('light'); renderManage(nd);
    })));
    $('#edit-desc').addEventListener('click', () => openSheet(`
      <h3>Description</h3><p class="sub">Shown to buyers on your page.</p>
      <textarea id="desc" maxlength="500" rows="5" placeholder="What do members get?">${esc(c.description || '')}</textarea>
      <div class="btn-row" style="margin-top:12px"><button class="btn" data-close>Cancel</button><button class="btn gold" id="save-desc">Save</button></div>`, (root) => {
      $('#save-desc', root).addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const nd = await api(path, { method: 'PATCH', body: { description: $('#desc', root).value } });
        closeSheet(); toast('Saved ✅'); renderManage(nd);
      }));
    }));
    $('#add-plan').addEventListener('click', () => planSheet(d, null));
    $$('[data-plan]').forEach((b) => b.addEventListener('click', () => planSheet(d, d.plans.find((p) => p.id === Number(b.dataset.plan)))));
    $$('[data-member]').forEach((b) => b.addEventListener('click', () => memberSheet(d, d.members.find((m) => m.id === Number(b.dataset.member)))));
  }

  function planSheet(d, plan) {
    const path = `/owner/chats/${encodeURIComponent(d.chat.slug)}`;
    const presets = (vals, cur, attr, unit) => vals.map((v) => `<button data-${attr}="${v}" class="${v === cur ? 'active' : ''}">${fmt(v)}${unit}</button>`).join('');
    openSheet(`
      <h3>${plan ? 'Edit plan' : 'New plan'}</h3>
      <div class="field"><label>Price in Telegram Stars ⭐</label><input id="p-stars" type="number" inputmode="numeric" min="1" value="${plan?.stars ?? ''}" placeholder="e.g. 100">
        <div class="presets">${presets([25, 50, 100, 250, 500, 1000], plan?.stars, 'stars', ' ⭐')}</div></div>
      <div class="field"><label>Access duration (days) — counted from the moment the member joins</label><input id="p-days" type="number" inputmode="numeric" min="1" value="${plan?.days ?? ''}" placeholder="e.g. 30">
        <div class="presets">${presets([1, 7, 15, 30, 90, 365], plan?.days, 'days', 'd')}</div></div>
      <div class="field"><label>Name (optional)</label><input id="p-title" maxlength="40" value="${esc(plan?.title || '')}" placeholder="e.g. Monthly VIP"></div>
      ${plan ? `<div class="setting"><div class="grow"><b>Visible to buyers</b></div><button class="switch ${plan.active ? 'on' : ''}" id="p-active"></button></div>` : ''}
      <div class="btn-row" style="margin-top:14px">${plan ? '<button class="btn red" id="p-del">Delete</button>' : '<button class="btn" data-close>Cancel</button>'}<button class="btn gold" id="p-save">Save</button></div>`, (root) => {
      root.addEventListener('click', (e) => {
        const s = e.target.closest('[data-stars]'), dd = e.target.closest('[data-days]');
        if (s) { $('#p-stars', root).value = s.dataset.stars; $$('[data-stars]', root).forEach((x) => x.classList.toggle('active', x === s)); }
        if (dd) { $('#p-days', root).value = dd.dataset.days; $$('[data-days]', root).forEach((x) => x.classList.toggle('active', x === dd)); }
      });
      $('#p-active', root)?.addEventListener('click', (e) => e.currentTarget.classList.toggle('on'));
      $('#p-save', root).addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const body = { stars: Number($('#p-stars', root).value), days: Number($('#p-days', root).value), title: $('#p-title', root).value };
        if (!body.stars || !body.days) throw new Error('Enter price and days');
        if (plan) body.active = $('#p-active', root).classList.contains('on');
        const nd = await api(plan ? `${path}/plans/${plan.id}` : `${path}/plans`, { method: plan ? 'PATCH' : 'POST', body });
        closeSheet(); toast('Plan saved ✅'); haptic('success'); renderManage(nd);
      }));
      $('#p-del', root)?.addEventListener('click', async (e) => {
        if (!(await confirmDlg('Delete this plan? Existing members keep their access.'))) return;
        busy(e.currentTarget, async () => { const nd = await api(`${path}/plans/${plan.id}`, { method: 'DELETE' }); closeSheet(); toast('Plan deleted'); renderManage(nd); });
      });
    });
  }

  function memberSheet(d, m) {
    if (!m) return;
    const path = `/owner/chats/${encodeURIComponent(d.chat.slug)}/members/${m.id}`;
    openSheet(`
      <h3>${esc(m.user.name)}</h3>
      <p class="sub">${m.user.username ? `@${esc(m.user.username)} · ` : ''}ID ${m.user.id}<br>
        ${m.status === 'active' ? `Joined ${date(m.joinedAt)} · ends <b class="gold">${date(m.expiresAt)}</b>` : `Paid ${date(m.paidAt)} · ${plural(m.days, 'day')} (not joined yet)`}</p>
      <div class="field"><label>Gift extra days</label><div class="presets">${[1, 3, 7, 30].map((v) => `<button data-extend="${v}">+${plural(v, 'day')}</button>`).join('')}</div></div>
      <button class="btn red" id="kick" style="margin-top:8px">🚫 Remove from ${d.chat.kind}</button>`, (root) => {
      $$('[data-extend]', root).forEach((b) => b.addEventListener('click', () => busy(b, async () => {
        const nd = await api(`${path}/extend`, { method: 'POST', body: { days: Number(b.dataset.extend) } });
        closeSheet(); toast(`+${plural(b.dataset.extend, 'day')} added ✅`); haptic('success'); renderManage(nd);
      })));
      $('#kick', root).addEventListener('click', async (e) => {
        if (!(await confirmDlg(`Remove ${m.user.name} now? Their membership ends immediately.`))) return;
        busy(e.currentTarget, async () => {
          const nd = await api(`${path}/kick`, { method: 'POST' });
          closeSheet(); toast(nd.result?.kicked ? 'Member removed' : 'Membership ended'); renderManage(nd);
        });
      });
    });
  }

  // ======================================================== BOOT
  async function boot() {
    try {
      meInfo = await api('/me');
      $('#me').textContent = meInfo.user.username ? `@${meInfo.user.username}` : meInfo.user.name;
    } catch (e) { if (e.status === 401) return showError(e); }
    // Deep links: startapp=c_<slug> / ?c=<slug> (buy), ?manage=<slug>, ?tab=my|manage
    const sp = tg?.initDataUnsafe?.start_param || qs.get('startapp') || '';
    const slug = sp.startsWith('c_') ? sp.slice(2) : qs.get('c');
    if (slug) return go(`chat:${slug}`, { push: false });
    if (sp.startsWith('m_') || qs.get('manage')) { stack.push('manage'); return go(`manage:${sp.startsWith('m_') ? sp.slice(2) : qs.get('manage')}`, { push: false }); }
    const tab = qs.get('tab');
    if (tab === 'my' || tab === 'manage') return go(tab, { push: false });
    // Default: members with memberships land on "My", owners on "Manage", others on Explore
    go('explore', { push: false });
    api('/my').then(({ memberships }) => { $('#my-dot').hidden = !memberships.some((m) => m.status === 'paid'); }).catch(() => {});
  }
  boot();
})();
