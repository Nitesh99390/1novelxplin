/* ============================================================
   Rewarded ads adapter.
   - If window.APP_CONFIG.adsgramBlockId is set (env ADSGRAM_BLOCK_ID),
     real Adsgram rewarded ads are shown (https://adsgram.ai).
   - Otherwise a built-in demo ad (5s countdown) is used so the whole
     flow can be tested before an ad network is connected.

   Ads.show() → Promise<{ done: boolean, reason?: string }>
     done: true  → the ad was watched to the end → give the reward
     done: false → closed early / no ad available → no reward
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const DEMO_SECONDS = Math.max(1, Number(cfg.demoAdSeconds) || 5);
  let adsgram = null;
  let sdkPromise = null;

  function loadSdk() {
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      if (window.Adsgram) return resolve(window.Adsgram);
      const s = document.createElement('script');
      s.src = 'https://sad.adsgram.ai/js/sad.min.js';
      s.async = true;
      s.onload = () => (window.Adsgram ? resolve(window.Adsgram) : reject(new Error('Adsgram missing')));
      s.onerror = () => reject(new Error('Adsgram SDK failed to load'));
      document.head.appendChild(s);
    });
    return sdkPromise;
  }

  async function showAdsgram() {
    try {
      const sdk = await loadSdk();
      adsgram = adsgram || sdk.init({ blockId: String(cfg.adsgramBlockId), debug: !!cfg.adsDebug });
      const res = await adsgram.show();
      return { done: !!res?.done, reason: res?.description };
    } catch (err) {
      // Adsgram rejects when the user skips or when no ad is available
      return { done: false, reason: err?.description || err?.message || 'Ad not available' };
    }
  }

  // ---------- Demo ad ----------
  function showDemo() {
    const overlay = document.getElementById('ad-overlay');
    const timer = document.getElementById('ad-timer');
    const bar = document.getElementById('ad-progress');
    const close = document.getElementById('ad-close');
    return new Promise((resolve) => {
      let left = DEMO_SECONDS;
      const finish = (done) => {
        clearInterval(iv);
        close.removeEventListener('click', onClose);
        overlay.classList.remove('open', 'ready');
        resolve(done ? { done: true } : { done: false, reason: 'Ad closed early' });
      };
      const onClose = () => finish(left <= 0);
      const tick = () => {
        timer.textContent = left > 0 ? `Reward in ${left}s` : 'Reward granted ✓';
        overlay.classList.toggle('ready', left <= 0);
      };
      bar.style.transition = 'none'; bar.style.width = '0%';
      overlay.classList.add('open');
      void bar.offsetWidth;
      bar.style.transition = `width ${DEMO_SECONDS}s linear`; bar.style.width = '100%';
      tick();
      const iv = setInterval(() => { left -= 1; tick(); if (left <= 0) { clearInterval(iv); setTimeout(() => finish(true), 700); } }, 1000);
      close.addEventListener('click', onClose);
    });
  }

  window.Ads = Object.freeze({
    provider: cfg.adsgramBlockId ? 'adsgram' : 'demo',
    show: () => (cfg.adsgramBlockId ? showAdsgram() : showDemo()),
  });
})();
