// Development-only, loopback-only UI preview. No provider/network calls.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const publicFiles = new Map([
  ['auth.js', 'text/javascript'], ['dompurify.js', 'text/javascript'], ['safe-html.js', 'text/javascript'],
  ['styles.css', 'text/css'], ['auth.css', 'text/css'], ['nexahub-brand.css', 'text/css'], ['nexahub-logo.png', 'image/png']
]);
let needsRenewal = true;
createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const send = (data, type = 'application/json', status = 200) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)); };
  if (pathname === '/') return send('<!doctype html><html><head><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/auth.css"><link rel="stylesheet" href="/nexahub-brand.css"></head><body><div id="auth-root"></div><script src="/dompurify.js"></script><script src="/safe-html.js"></script><script src="/auth.js"></script></body></html>', 'text/html');
  if (publicFiles.has(pathname.slice(1))) return send(await readFile(new URL(pathname.slice(1), root)), publicFiles.get(pathname.slice(1)));
  if (req.method === 'POST' && pathname.startsWith('/api/auth/')) {
    let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 4096) return send({}, 'application/json', 413); }
    let body; try { body = JSON.parse(text || '{}'); } catch { return send({}, 'application/json', 400); }
    if (pathname === '/api/auth/login') return send({ nextStep: 'email', expiresIn: 300, resendAfter: 60 });
    if (pathname === '/api/auth/resend-code') return send({ nextStep: 'email', expiresIn: 230, resendAfter: 60 });
    if (pathname === '/api/auth/verify-email') {
      if (body.code !== '123456') return send({ error: 'Mock code is invalid. Use 123456 only on this local preview.' }, 'application/json', 400);
      return send(needsRenewal ? { nextStep: 'password', expiresIn: 280, resendAfter: 60 } : { accessToken: 'cookie', refreshToken: 'cookie', expiresIn: 3600, profile: { id: 'local-mock', role: 'agent', full_name: 'Local preview only' } });
    }
    if (pathname === '/api/auth/renew-password') { needsRenewal = false; return send({ ok: true, signInAgain: true }); }
    if (pathname === '/api/auth/logout') return send({ ok: true });
  }
  return send({ error: 'Local UI preview only. No business APIs.' }, 'application/json', 404);
}).listen(4199, '127.0.0.1', () => console.log('Mock login preview: http://127.0.0.1:4199/ — no real provider calls'));
