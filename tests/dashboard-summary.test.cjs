const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../backend/supabase-client.mjs'), 'utf8');
const code = source.slice(source.indexOf('export async function getDashboardSummary'), source.indexOf('// Spring automatically releases')).replace('export ', '');
const run = request => vm.runInNewContext(`${code}; getDashboardSummary`, { secretRequest: request, Date, Set });
test('manager uses agency scope and Ulaanbaatar calendar month; real amounts only', async () => {
  const urls = [];
  const summary = await run(async url => {
    urls.push(decodeURIComponent(url));
    return url.includes('wallet_transactions') ? [{ reason: 'Ticket issue: A', amount_cny: -100 }, { reason: 'Ticket issue: B', amount_cny: -250.5 }] : [{ id: 'pending' }];
  })({ role: 'office_manager', agency_id: 'agency1' }, new Date('2026-08-31T16:15:00Z'));
  assert.equal(summary.issuedBookings, 2);
  assert.equal(summary.salesCny, 350.5);
  assert.equal(summary.pendingBookings, 1);
  assert.equal(summary.month, '2026-09');
  assert.ok(urls.every(url => url.includes('agency_id=eq.agency1')));
  assert.ok(urls[0].includes('created_at=gte.2026-08-31T16:00:00.000Z'));
  assert.ok(urls[1].includes('created_at=gt.2026-08-31T15:45:00.000Z'));
});
test('agent scope, empty data, and missing agency protection', async () => {
  const urls = [];
  const get = run(async url => { urls.push(url); return []; });
  const summary = await get({ role: 'agent', id: 'user1', agency_id: 'agency1' });
  assert.equal(summary.salesCny, 0);
  assert.equal(summary.issuedBookings, 0);
  assert.equal(summary.pendingBookings, 0);
  assert.ok(urls.every(url => url.includes('created_by=eq.user1') && url.includes('agency_id=eq.agency1')));
  await assert.rejects(get({ role: 'office_manager' }), /Agency is required/);
  await assert.rejects(get({ role: 'unknown' }), /access denied/);
});
test('paginates rather than truncating monthly totals', async () => {
  const get = run(async url => {
    if (!url.includes('wallet_transactions')) return [];
    const offset = Number(new URL(`http://local${url}`).searchParams.get('offset'));
    return Array.from({ length: offset === 0 ? 500 : 1 }, (_, i) => ({ reason: `Ticket issue: ${offset + i}`, amount_cny: -10 }));
  });
  const result = await get({ role: 'platform_admin' });
  assert.equal(result.issuedBookings, 501);
  assert.equal(result.salesCny, 5010);
});
