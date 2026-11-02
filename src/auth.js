// Telegram Mini App initData validation
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
import { createHmac, timingSafeEqual } from 'node:crypto';

export function signInitData(params, botToken) {
  const p = new URLSearchParams(params);
  p.delete('hash');
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(check).digest('hex');
}

/** Returns { user, startParam, authDate } or null if invalid / expired. */
export function verifyInitData(initData, botToken, maxAgeSec = 86400, now = Date.now()) {
  if (!initData || !botToken) return null;
  let p;
  try { p = new URLSearchParams(initData); } catch { return null; }
  const hash = p.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  const expected = signInitData(p, botToken);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const authDate = Number(p.get('auth_date') || 0);
  if (maxAgeSec > 0 && (!authDate || now / 1000 - authDate > maxAgeSec)) return null;
  let user;
  try { user = JSON.parse(p.get('user') || 'null'); } catch { return null; }
  if (!user || !Number.isSafeInteger(user.id)) return null;
  return { user, startParam: p.get('start_param') || '', authDate };
}
