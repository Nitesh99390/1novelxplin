import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/rewards.js';

const R = globalThis.Rewards;
const tapTo = (s, n) => R.tap(s, n - s.points).state;

test('default tiers: 1k→1 ad→1k, 3k→2 ads→3k, 5k→3 ads→5k', () => {
  assert.deepEqual(R.TIERS.map((t) => [t.target, t.ads, t.reward]), [[1000, 1, 1000], [3000, 2, 3000], [5000, 3, 5000]]);
});

test('taps are capped at the milestone and then locked', () => {
  let s = R.initial();
  let r = R.tap(s, 600); s = r.state;
  assert.equal(s.points, 600); assert.equal(r.reached, false); assert.equal(R.isLocked(s), false);
  r = R.tap(s, 600); s = r.state;
  assert.equal(s.points, 1000); assert.equal(r.added, 400); assert.equal(r.reached, true);
  assert.equal(R.isLocked(s), true);
  r = R.tap(s, 100);
  assert.equal(r.added, 0); assert.equal(r.state.points, 1000);
});

test('full round: watch 1 + 2 + 3 ads → 9,000 stars, round restarts at 0', () => {
  let s = tapTo(R.initial(), 1000);
  let r = R.adWatched(s); s = r.state;
  assert.equal(r.claimed, 1000); assert.equal(s.stars, 1000); assert.equal(s.tier, 1); assert.equal(s.points, 1000);
  assert.equal(R.progress(s), 0);

  s = tapTo(s, 3000);
  r = R.adWatched(s); s = r.state;
  assert.equal(r.claimed, 0); assert.equal(r.remaining, 1); assert.equal(s.stars, 1000);
  r = R.adWatched(s); s = r.state;
  assert.equal(r.claimed, 3000); assert.equal(s.stars, 4000); assert.equal(s.tier, 2);

  s = tapTo(s, 5000);
  s = R.adWatched(s).state; s = R.adWatched(s).state;
  r = R.adWatched(s); s = r.state;
  assert.equal(r.claimed, 5000); assert.equal(r.roundComplete, true);
  assert.equal(s.stars, 9000); assert.equal(s.tier, 0); assert.equal(s.points, 0); assert.equal(s.round, 2); assert.equal(s.totalAds, 6);
});

test('skipping an offer restarts from tier 1 but keeps earned stars', () => {
  let s = tapTo(R.initial(), 1000);
  s = R.adWatched(s).state;          // +1000 stars
  s = tapTo(s, 3000);
  s = R.adWatched(s).state;          // 1 of 2 ads
  s = R.skip(s);
  assert.deepEqual([s.points, s.tier, s.adsWatched, s.stars, s.skips], [0, 0, 0, 1000, 1]);
});

test('ads do nothing before the milestone', () => {
  const s = R.tap(R.initial(), 500).state;
  const r = R.adWatched(s);
  assert.equal(r.claimed, 0); assert.equal(r.state, s);
});

test('normalize sanitizes corrupted storage', () => {
  const s = R.normalize({ points: -5, tier: 9, stars: 'abc', adsWatched: 99, round: 0 });
  assert.deepEqual([s.points, s.tier, s.stars, s.adsWatched, s.round], [0, 0, 0, 0, 1]);
  const t = R.normalize({ points: 99999, tier: 1, adsWatched: 7 });
  assert.equal(t.points, 3000); assert.equal(t.adsWatched, 1);
  assert.deepEqual(R.normalize(null), R.initial());
});
