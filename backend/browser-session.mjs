import { randomBytes } from 'node:crypto';
import { HttpError } from './request-security.mjs';

// Server-side tokens; the browser only receives an opaque HttpOnly cookie.
// Restart intentionally signs everyone out. No tokens are persisted to disk.
export function createBrowserSessions({ now = Date.now, ttl = 12 * 3600000, limit = 10000, cookieName = 'nexahub_session' } = {}) {
  const sessions = new Map();
  const name = cookieName;
  const idFor = req => String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(name + '='))?.slice(name.length + 1);
  const find = req => {
    const id = idFor(req), value = sessions.get(id);
    if (!value || value.deadline <= now()) { sessions.delete(id); return null; }
    return value;
  };
  const cookie = (req, value, age) => `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${/^localhost(?::\d+)?$|^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || '') ? '' : '; Secure'}`;
  const setCookie = (res, value) => {
    const previous = res.getHeader?.('set-cookie');
    // Replace this cookie only; preserve other restricted-session cookies.
    const values = (previous ? [].concat(previous) : []).filter(item => !item.startsWith(`${name}=`));
    values.push(value);
    res.setHeader('set-cookie', values.length === 1 ? values[0] : values);
  };
  return {
    find,
    token: req => find(req)?.access_token,
    establish(req, res, session) {
      for (const [id, value] of sessions) if (value.deadline <= now()) sessions.delete(id);
      if (sessions.size >= limit) throw new HttpError(503, 'Session service is busy. Try again later.');
      sessions.delete(idFor(req));
      const id = randomBytes(32).toString('hex');
      sessions.set(id, { ...session, deadline: now() + ttl });
      setCookie(res, cookie(req, id, Math.floor(ttl / 1000)));
    },
    renew(req, session) {
      const previous = find(req);
      if (!previous) throw new HttpError(401, 'Please sign in again.');
      const deadline = previous.deadline;
      Object.assign(previous, session, { deadline }); // preserve absolute session deadline
    },
    clear(req, res) { sessions.delete(idFor(req)); setCookie(res, cookie(req, '', 0)); },
    invalidateUser(userId) { for (const [id, value] of sessions) if ((value.userId || value.user?.id) === userId) sessions.delete(id); },
    checkMutation(req) {
      if (!find(req) || !['POST', 'PATCH', 'DELETE'].includes(req.method)) return;
      let origin;
      try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, 'Same-origin request required.'); }
      if (origin.host !== req.headers.host || !['http:', 'https:'].includes(origin.protocol)) throw new HttpError(403, 'Same-origin request required.');
    }
  };
}
