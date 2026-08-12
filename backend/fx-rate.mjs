const MARKUP_MNT = 4;
const DEFAULT_SOURCE = 'https://monxansh.appspot.com/xansh.json?currency=CNY';
const CACHE_MS = 6 * 60 * 60 * 1000;
let cachedRate = null;

const number = value => Number(String(value ?? '').replace(/,/g, ''));

const buildRate = ({ official, rateDate, source }) => {
  if (!Number.isFinite(official) || official <= 0) throw new Error('A valid Mongolbank CNY rate was not returned.');
  return {
    currency: 'CNY',
    officialRateMnt: official,
    markupMnt: MARKUP_MNT,
    effectiveRateMnt: official + MARKUP_MNT,
    rateDate: rateDate || new Date().toISOString().slice(0, 10),
    source
  };
};

function configuredFallback() {
  const official = number(process.env.MONGOLBANK_CNY_RATE);
  return Number.isFinite(official) && official > 0 ? buildRate({ official, rateDate: process.env.MONGOLBANK_CNY_RATE_DATE, source: 'Manual Mongolbank fallback' }) : null;
}

export async function getCnyMntRate() {
  if (cachedRate && Date.now() - cachedRate.loadedAt < CACHE_MS) return cachedRate.value;
  try {
    const response = await fetch(process.env.MONGOLBANK_CNY_RATE_API_URL || DEFAULT_SOURCE, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    const body = await response.json();
    const row = Array.isArray(body) ? body.find(item => String(item.code).toUpperCase() === 'CNY') : body;
    const value = number(row?.rate_float ?? row?.rate);
    const rate = buildRate({ official: value, rateDate: row?.rate_date || row?.last_date, source: 'monxansh.appspot.com / Mongolbank rate' });
    cachedRate = { value: rate, loadedAt: Date.now() };
    return rate;
  } catch (error) {
    const fallback = configuredFallback();
    if (fallback) return fallback;
    throw new Error(`Exchange rate is temporarily unavailable: ${error.message}`);
  }
}

export function quoteCnyToMnt(amountCny, rate) {
  const amount = number(amountCny);
  if (!Number.isFinite(amount)) throw new Error('A valid CNY amount is required.');
  if (!rate?.effectiveRateMnt) throw new Error('A valid CNY/MNT rate is required.');
  return Math.round(amount * rate.effectiveRateMnt);
}
