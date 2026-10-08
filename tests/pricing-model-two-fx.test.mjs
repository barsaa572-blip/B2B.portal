import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelTwoRate, createModelTwoFxService } from '../backend/pricing-model-two-fx.mjs';

const oct8 = Date.parse('2026-10-08T04:00:00Z');
const row = (bank, buy = 536.26, sell = buy, date = '2026-10-07') => ({
  bank_name: bank, date, rates: { cny: { noncash: { buy, sell } } }
});

test('confirmed Mongolbank feed is distinct from bank purchase FX', async () => {
  const requests = [];
  const getRate = createModelTwoFxService({ now: () => oct8, fetcher: async url => {
    requests.push(url);
    return { ok: true, json: async () => [url.includes('MongolBank')
      ? row('MongolBank') : row('GolomtBank', 533.9, 538)] };
  } });
  const rate = await getRate();
  assert.equal(rate.effectiveRateMnt, 536.26);
  assert.equal(rate.refundRateMnt, 536.26);
  assert.equal(rate.topupRateMnt, 538);
  assert.equal(rate.nonCashSellMnt, 538);
  assert.equal(rate.fundingBank, 'Golomt Bank');
  assert.equal(rate.rateDate, '2026-10-07');
  assert.equal(rate.fundingRateDate, '2026-10-07');
  rate.effectiveRateMnt = 1;
  assert.equal((await getRate()).effectiveRateMnt, 536.26, 'Callers cannot change a cached quote');
  assert.equal(requests.length, 2);
});

test('missing, stale, future and invalid dates fail closed', () => {
  for (const date of ['', '2026-02-30', '2026-10-09', '2026-10-03']) {
    assert.throws(() => parseModelTwoRate([row('MongolBank', 536.26, 536.26, date)],
      { bank: 'MongolBank', now: oct8 }));
  }
  const missing = row('MongolBank'); delete missing.date;
  assert.throws(() => parseModelTwoRate([missing], { bank: 'MongolBank', now: oct8 }));
  assert.equal(parseModelTwoRate([row('MongolBank', 536.26, 536.26, '2026-10-04')],
    { bank: 'MongolBank', now: oct8 }).sell, 536.26);
});

test('rate identity, numeric shape and official equality are validated', () => {
  for (const value of [null, '', false, 'NaN', -1, 0, Infinity, '1e3', '536,26', 1000001]) {
    assert.throws(() => parseModelTwoRate(row('MongolBank', value, value),
      { bank: 'MongolBank', now: oct8 }));
  }
  assert.throws(() => parseModelTwoRate(row('GolomtBank'), { bank: 'MongolBank', now: oct8 }));
  assert.throws(() => parseModelTwoRate(row('MongolBank', 536.26, 538), { bank: 'MongolBank', now: oct8 }));
  assert.throws(() => parseModelTwoRate(row('GolomtBank', 539, 538), { bank: 'GolomtBank', now: oct8 }));
  assert.throws(() => parseModelTwoRate([], { bank: 'MongolBank', now: oct8 }));
});

test('cache is rechecked at the Ulaanbaatar date boundary', async () => {
  let time = Date.parse('2026-10-08T15:59:00Z');
  const getRate = createModelTwoFxService({ now: () => time, fetcher: async url => ({
    ok: true, json: async () => [row(url.includes('MongolBank') ? 'MongolBank' : 'GolomtBank',
      536.26, 536.26, '2026-10-04')]
  }) });
  await getRate();
  time += 120_000;
  await assert.rejects(getRate(), /stale/);
});

test('failed fresh fetch does not silently reuse old data or replace official with bank FX', async () => {
  let time = oct8, fail = false, requests = 0;
  const getRate = createModelTwoFxService({ now: () => time, fetcher: async url => {
    requests++; return { ok: !fail, json: async () => [row(url.includes('MongolBank')
      ? 'MongolBank' : 'GolomtBank')] };
  } });
  await Promise.all([getRate(), getRate(), getRate()]);
  assert.equal(requests, 2, 'Concurrent quote requests share a single refresh');
  fail = true; time += 600_000;
  await assert.rejects(getRate(), /unavailable/);
  fail = false;
  assert.equal((await getRate()).effectiveRateMnt, 536.26);
});
