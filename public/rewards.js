/* ============================================================
   Reward ladder — pure game logic (no DOM). Shared by the browser
   (window.Rewards) and the Node tests (globalThis.Rewards).

   Flow:
     tap → points grow → at a milestone the boss is defeated and the
     game locks with an offer: "watch N ads → get X stars".
       • 1,000 points → 1 ad  → +1,000 ★
       • 3,000 points → 2 ads → +3,000 ★
       • 5,000 points → 3 ads → +5,000 ★
     Watch all ads → stars are added, the next boss starts.
     Skip the offer → points reset to 0 and the ladder starts again
     from the first boss (already earned stars are kept).
     After the last tier the round is complete and starts over at 0.
   ============================================================ */
(function (root) {
  'use strict';

  const TIERS = Object.freeze([
    Object.freeze({ target: 1000, ads: 1, reward: 1000 }),
    Object.freeze({ target: 3000, ads: 2, reward: 3000 }),
    Object.freeze({ target: 5000, ads: 3, reward: 5000 }),
  ]);

  const int = (v) => (Number.isFinite(+v) ? Math.max(0, Math.floor(+v)) : 0);

  function initial() {
    return { points: 0, stars: 0, tier: 0, adsWatched: 0, round: 1, totalAds: 0, skips: 0 };
  }

  const current = (s) => TIERS[s.tier];
  const start = (tier) => (tier ? TIERS[tier - 1].target : 0);

  /** Milestone reached → taps are locked until the ads are watched (or skipped). */
  const isLocked = (s) => s.points >= TIERS[s.tier].target;

  /** 0 → 1 progress inside the current boss (used for the health bar). */
  function progress(s) {
    const from = start(s.tier), to = TIERS[s.tier].target;
    return Math.max(0, Math.min(1, (s.points - from) / (to - from)));
  }

  /** Repair any saved / tampered state. An invalid tier resets the ladder. */
  function normalize(raw) {
    const base = initial();
    if (!raw || typeof raw !== 'object') return base;
    const rawTier = int(raw.tier);
    const valid = rawTier < TIERS.length;
    const tier = valid ? rawTier : 0;
    const t = TIERS[tier];
    const points = valid ? Math.min(Math.max(int(raw.points), start(tier)), t.target) : 0;
    const locked = points >= t.target;
    return {
      points,
      stars: int(raw.stars),
      tier,
      adsWatched: locked ? Math.min(int(raw.adsWatched), t.ads - 1) : 0,
      round: Math.max(1, int(raw.round)),
      totalAds: int(raw.totalAds),
      skips: int(raw.skips),
    };
  }

  /** Add tap points. Points never overshoot the milestone. */
  function tap(s, gain) {
    if (isLocked(s)) return { state: s, added: 0, reached: false };
    const t = current(s);
    const points = Math.min(t.target, s.points + int(gain));
    return { state: { ...s, points }, added: points - s.points, reached: points >= t.target };
  }

  /** One rewarded ad fully watched. */
  function adWatched(s) {
    if (!isLocked(s)) return { state: s, claimed: 0, remaining: 0, roundComplete: false };
    const t = current(s);
    const watched = s.adsWatched + 1;
    const totalAds = s.totalAds + 1;
    if (watched < t.ads) {
      return { state: { ...s, adsWatched: watched, totalAds }, claimed: 0, remaining: t.ads - watched, roundComplete: false };
    }
    const last = s.tier === TIERS.length - 1;
    return {
      state: {
        ...s,
        stars: s.stars + t.reward,
        tier: last ? 0 : s.tier + 1,
        points: last ? 0 : s.points,
        round: s.round + (last ? 1 : 0),
        adsWatched: 0,
        totalAds,
      },
      claimed: t.reward,
      remaining: 0,
      roundComplete: last,
    };
  }

  /** User refused the ads → start again from zero. Stars are kept. */
  function skip(s) {
    return { ...s, points: 0, tier: 0, adsWatched: 0, skips: s.skips + 1 };
  }

  root.Rewards = Object.freeze({ TIERS, initial, normalize, current, isLocked, progress, tap, adWatched, skip });
})(typeof window !== 'undefined' ? window : globalThis);
