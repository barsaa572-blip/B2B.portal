import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { checkRequest, clientAddress, createLimiter, isPublicAsset, readJsonBody, securityHeaders } from '../backend/request-security.mjs';
import { requireChangeQuote, cleanBookingItinerary, guardedPayment } from '../backend/payment-security.mjs';

const req = (changes = {}) => ({ method: 'GET', url: '/api/wallet', headers: { host: 'portal.example' }, socket: { remoteAddress: '127.0.0.1' }, ...changes });
test('only public assets are served; source, env, git and SQL are blocked', () => {
  for (const name of ['index.html', 'app.js', 'styles.css']) assert.equal(isPublicAsset(name), true);
  for (const name of ['.env', '.env.example', 'server.mjs', 'backend/supabase-client.mjs', '.git/config', 'supabase/schema.sql', '../app.js', '%2e%2e/app.js', 'tests/request-security.test.mjs', 'README.md']) assert.equal(isPublicAsset(name), false);
});
test('cross-site writes, unsupported methods and non-JSON bodies are rejected', () => {
  assert.throws(() => checkRequest(req({ method: 'POST', headers: { host: 'portal.example', origin: 'https://evil.example' } })), /Cross-origin/);
  assert.throws(() => checkRequest(req({ headers: { 'sec-fetch-site': 'cross-site' } })), /Cross-site/);
  assert.throws(() => checkRequest(req({ method: 'TRACE' })), /Method/);
  assert.throws(() => checkRequest(req({ method: 'POST', headers: { 'content-length': '20', 'content-type': 'text/plain' } })), /JSON/);
  assert.doesNotThrow(() => checkRequest(req({ method: 'POST' })));
  assert.doesNotThrow(() => checkRequest(req({ method: 'POST', headers: { host: 'portal.example', origin: 'https://portal.example', 'content-type': 'application/json', 'content-length': '2' } })));
});
test('proxy forwarding headers cannot bypass default IP identification', () => {
  const request = req({ headers: { 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '1.2.3.4' } });
  assert.equal(clientAddress(request), '127.0.0.1');
  assert.equal(clientAddress(request, true), '1.2.3.4');
  request.socket.remoteAddress = '8.8.8.8';
  assert.equal(clientAddress(request, true), '8.8.8.8');
});
test('rate limits expire and memory capacity fails closed', () => {
  let now = 0; const limit = createLimiter({ now: () => now, maxKeys: 2 });
  limit('a', 1, 1000);
  assert.throws(() => limit('a', 1, 1000), error => error.status === 429 && error.retryAfter === 1);
  limit('b', 1, 1000);
  assert.throws(() => limit('c', 1, 1000), /Too many/);
  now = 1001; assert.doesNotThrow(() => limit('c', 1, 1000));
});
test('JSON parser bounds bytes including chunked and multibyte bodies', async () => {
  assert.deepEqual(await readJsonBody(Readable.from(['{"amount":1}'])), { amount: 1 });
  for (const body of ['[1]', 'null', 'bad', '"string"']) await assert.rejects(readJsonBody(Readable.from([body])));
  await assert.rejects(readJsonBody(Readable.from(['а'.repeat(60000)])), /too large/);
});
test('CSP prevents inline script and framing', () => {
  assert.match(securityHeaders['content-security-policy'], /script-src 'self';/);
  assert.match(securityHeaders['content-security-policy'], /frame-ancestors 'none'/);
});
test('client cannot inject financial metadata into a new booking', () => {
  const data = cleanBookingItinerary({ flights: [{}], changeQuotes: { 1: {} }, refundHistory: [{}], springOrder: { paid: true } });
  assert.equal(data.changeQuotes, undefined); assert.equal(data.refundHistory, undefined); assert.equal(data.springOrder, undefined);
});
test('change quote requires booking binding, current timestamp and exact amount', () => {
  const now = Date.now();
  const quote = { appId: 12, securityVersion: 1, quotedAt: new Date(now).toISOString(), amountsCny: { additionalPayment: 600 } };
  const booking = { itinerary: { changeQuotes: { 12: quote } } };
  assert.equal(requireChangeQuote(booking, 12, 600, now), quote);
  for (const amount of [0, 300, NaN, Infinity]) assert.throws(() => requireChangeQuote(booking, 12, amount, now));
  assert.throws(() => requireChangeQuote(booking, 13, 600, now));
  assert.throws(() => requireChangeQuote(booking, 12, 600, now + 16 * 60000));
  delete quote.securityVersion;
  assert.throws(() => requireChangeQuote(booking, 12, 600, now));
});
test('missing DB guard fails before supplier mutation', async () => {
  let calls = 0;
  await assert.rejects(guardedPayment({ begin: async () => { throw new Error('migration missing'); } }, async () => { calls++; }));
  assert.equal(calls, 0);
});
test('ambiguous supplier failure remains locked and is never automatically retried', async () => {
  let claimed = false; let calls = 0; const states = [];
  const options = { actor: 'u', begin: async () => { if (claimed) throw new Error('Already pending'); claimed = true; return 'op1'; }, finish: async (_, __, state) => states.push(state) };
  await assert.rejects(guardedPayment(options, async () => { calls++; throw new Error('timeout'); }), /Do not retry/);
  await assert.rejects(guardedPayment(options, async () => { calls++; }), /Already pending/);
  assert.equal(calls, 1); assert.deepEqual(states, ['needs_review']);
});
test('local persistence failure after supplier success needs reconciliation', async () => {
  const states = [];
  await assert.rejects(guardedPayment({ actor: 'u', begin: async () => 'op2', finish: async (_, __, state) => { states.push(state); if (state === 'completed') throw new Error('DB offline'); } }, async () => ({ paid: true })), /reconciliation/);
  assert.deepEqual(states, ['completed', 'needs_review']);
});
