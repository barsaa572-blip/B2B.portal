// Shared dated FX adapter for the CNY funding model. Keep purchase FX
// separate from official MNT valuation; never label a bank SELL rate official.
const DEFAULT_OFFICIAL_URL = 'http://127.0.0.1:8000/api/rates/bank/MongolBank?limit=1';
const DEFAULT_FUNDING_URL = 'http://127.0.0.1:8000/api/rates/bank/GolomtBank?limit=1';
const DAY_MS = 86_400_000;
const dateAt = time => new Date(time + 8 * 3_600_000).toISOString().slice(0, 10);
const positiveRate = value => {
  if (!['string', 'number'].includes(typeof value) ||
      !/^\d+(?:\.\d{1,6})?$/.test(String(value))) throw new Error('Invalid CNY exchange rate.');
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1_000_000) throw new Error('Invalid CNY exchange rate.');
  return rate;
};
const validMaxAge = value => {
  if (!Number.isInteger(value) || value < 0 || value > 7) throw new Error('Invalid exchange-rate freshness limit.');
  return value;
};

function checkDate(value, now, maxAgeDays) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Exchange-rate date is required.');
  const time = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Invalid exchange-rate date.');
  const age = (Date.parse(dateAt(now) + 'T00:00:00Z') - time) / DAY_MS;
  if (age < 0 || age > maxAgeDays) throw new Error('Exchange rate is stale or future-dated.');
  return value;
}

export function parseModelTwoRate(body, { bank, now = Date.now(), maxAgeDays = 4 } = {}) {
  validMaxAge(maxAgeDays);
  if (!['MongolBank', 'GolomtBank'].includes(bank)) throw new Error('Unknown rate source.');
  const row = Array.isArray(body) ? body[0] : body;
  if (!row || row.bank_name !== bank) throw new Error('Exchange-rate source does not match the requested bank.');
  const rateDate = checkDate(row.date, now, maxAgeDays);
  const buy = positiveRate(row.rates?.cny?.noncash?.buy);
  const sell = positiveRate(row.rates?.cny?.noncash?.sell);
  if (bank === 'MongolBank' && buy !== sell) throw new Error('Official CNY rate must have matching values.');
  if (bank === 'GolomtBank' && buy > sell) throw new Error('Bank CNY buy rate exceeds sell rate.');
  return { bank, buy, sell, rateDate };
}

export function createModelTwoFxService({ fetcher = globalThis.fetch,
  now = Date.now, maxAgeDays = 4, cacheMs = 10 * 60_000,
  officialUrl = DEFAULT_OFFICIAL_URL, fundingUrl = DEFAULT_FUNDING_URL } = {}) {
  validMaxAge(maxAgeDays);
  if (!Number.isInteger(cacheMs) || cacheMs < 0 || cacheMs > 10 * 60_000) throw new Error('Invalid rate cache duration.');
  let cached = null;
  let loading = null;
  const read = async (url, bank) => {
    const response = await fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error('Exchange-rate service is unavailable.');
    return parseModelTwoRate(await response.json(), { bank, now: now(), maxAgeDays });
  };
  return async function getRate() {
    if (cached && now() >= cached.loadedAt && now() - cached.loadedAt < cacheMs) {
      // Revalidate freshness even when a cache spans midnight.
      checkDate(cached.value.rateDate, now(), maxAgeDays);
      checkDate(cached.value.fundingRateDate, now(), maxAgeDays);
      return structuredClone(cached.value);
    }
    if (!loading) loading = (async () => {
      const [official, funding] = await Promise.all([
        read(officialUrl, 'MongolBank'), read(fundingUrl, 'GolomtBank')
      ]);
      const value = { currency: 'CNY', pricingModel: 'cny-funding-v1',
        bank: 'Mongolbank', fundingBank: 'Golomt Bank',
        officialRateMnt: official.sell, effectiveRateMnt: official.sell,
        refundRateMnt: official.sell, topupRateMnt: funding.sell,
        nonCashBuyMnt: funding.buy, nonCashSellMnt: funding.sell,
        markupMnt: 0, rateDate: official.rateDate, fundingRateDate: funding.rateDate,
        source: 'Local Mongolbank official exchange-rate service' };
      cached = { loadedAt: now(), value };
      return value;
    })().finally(() => { loading = null; });
    return structuredClone(await loading);
  };
}
