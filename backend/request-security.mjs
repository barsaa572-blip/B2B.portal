import { isIP } from 'node:net';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};

// Only explicitly public assets may be served. Never expose the repository.
const scripts = new Set(['app.js', 'auth.js', 'admin.js', 'team.js', 'interface.js', 'flight-detail-card.js']);
export function isPublicAsset(path) {
  return path === 'index.html' || scripts.has(path) || /^[a-z][a-z0-9-]*\.css$/.test(path);
}

export function clientAddress(req, trustProxy = false) {
  const remote = req.socket.remoteAddress || 'unknown';
  if (trustProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && isIP(real)) return real;
  }
  return remote;
}

export function checkRequest(req) {
  if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
  if (req.url.length > 8192) throw new HttpError(414, 'Request URL is too long.');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.');
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, 'Invalid request origin.'); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) throw new HttpError(403, 'Cross-origin requests are not allowed.');
  }
  if (['POST', 'PATCH'].includes(req.method) && (Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'])) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'JSON content type is required.');
    if (Number(req.headers['content-length']) > 100_000) throw new HttpError(413, 'Request is too large.');
  }
}

export function createLimiter({ now = Date.now, maxKeys = 20000 } = {}) {
  const buckets = new Map();
  return function limit(key, maximum, windowMs) {
    const time = now();
    let entry = buckets.get(key);
    if (!entry || time >= entry.expires) {
      if (buckets.size >= maxKeys) {
        for (const [id, value] of buckets) if (time >= value.expires) buckets.delete(id);
        if (buckets.size >= maxKeys && !buckets.has(key)) throw new HttpError(429, 'Too many requests. Please try again later.');
      }
      entry = { count: 0, expires: time + windowMs }; buckets.set(key, entry);
    }
    if (++entry.count > maximum) {
      const error = new HttpError(429, 'Too many requests. Please try again later.');
      error.retryAfter = Math.ceil((entry.expires - time) / 1000); throw error;
    }
  };
}

export async function readJsonBody(req) {
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 100_000) throw new HttpError(413, 'Request is too large.');
    chunks.push(Buffer.from(chunk));
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new HttpError(400, 'Invalid JSON request.'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new HttpError(400, 'JSON object is required.');
  return body;
}
