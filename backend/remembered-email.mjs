import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './request-security.mjs';

// A signed, host-only browser receipt. It is NOT a portal session or login token.
// Password authentication and current account/agency checks still run every time.
const DAY = 24 * 3600000;
export function createRememberedEmail({ secret = () => process.env.AUTH_DEVICE_SECRET,
  now = Date.now } = {}) {
  const key = () => {
    const value = secret();
    if (typeof value !== 'string' || !/^[a-f0-9]{64,128}$/i.test(value)) {
      throw new HttpError(503, 'Email verification configuration is not ready. Contact your administrator.');
    }
    return Buffer.from(value, 'hex');
  };
  const local = req => /^localhost(?::\d+)?$|^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || '');
  const name = req => local(req) ? 'nexahub_email_device_local' : '__Host-nexahub_email_device';
  const mac = value => createHmac('sha256', key()).update(value).digest('base64url');
  const identity = profile => mac(JSON.stringify([profile.id, profile.email?.toLowerCase(), profile.passwordSecurity?.revision || null]));
  return {
    assertReady: () => { key(); },
    find(req, profile) {
      try {
        const prefix = name(req) + '=';
        const cookies = String(req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith(prefix));
        if (cookies.length !== 1) return null;
        const value = cookies[0].slice(prefix.length);
        if (value.length > 512) return null;
        const [payload, signature, extra] = value.split('.');
        if (!payload || !signature || extra) return null;
        const expected = Buffer.from(mac(payload));
        const actual = Buffer.from(signature);
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
        const receipt = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (receipt.v !== 1 || receipt.subject !== identity(profile)
          || !Number.isSafeInteger(receipt.at) || !Number.isSafeInteger(receipt.until)
          || receipt.at > now() || receipt.until !== receipt.at + DAY || now() >= receipt.until) return null;
        return receipt;
      } catch { return null; } // Malformed/tampered cookies require fresh email verification.
    },
    establish(req, res, profile) {
      const at = now();
      const receipt = { v: 1, subject: identity(profile), at, until: at + DAY };
      const payload = Buffer.from(JSON.stringify(receipt)).toString('base64url');
      const cookie = `${name(req)}=${payload}.${mac(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${local(req) ? '' : '; Secure'}`;
      const previous = res.getHeader?.('set-cookie');
      const values = (previous ? [].concat(previous) : []).filter(v => !v.startsWith(name(req) + '='));
      res.setHeader('set-cookie', [...values, cookie]);
      return receipt;
    }
  };
}
