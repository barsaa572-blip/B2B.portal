// The platform service fee is charged separately on the invoice. Do not add a
// hidden exchange-rate markup to the agency's CNY wallet credit.
const DEFAULT_TOPUP_MARKUP_MNT = 0;
const DEFAULT_SOURCE = 'http://127.0.0.1:8000/api/rates/bank/GolomtBank?limit=1';
const CACHE_MS = 6 * 60 * 60 * 1000;
let cachedRate = null;

const number = value => Number(String(value ?? '').replace(/,/g, ''));

const isRate = value => Number.isFinite(value) && value > 0;

const buildRate = ({ nonCashBuy, nonCashSell, rateDate, source }) => {
  if (!isRate(nonCashBuy) || !isRate(nonCashSell)) throw new Error('A valid Golomt Bank CNY non-cash buy and sell rate was not returned.');
  const configuredMarkup = number(process.env.TOPUP_CNY_MARKUP_MNT);
  const markupMnt = Number.isFinite(configuredMarkup) && configuredMarkup >= 0 ? configuredMarkup : DEFAULT_TOPUP_MARKUP_MNT;
  return {
    currency: 'CNY',
    bank: 'Golomt Bank',
    nonCashBuyMnt: nonCashBuy,
    nonCashSellMnt: nonCashSell,
    topupRateMnt: nonCashSell + markupMnt,
    refundRateMnt: nonCashBuy,
    markupMnt,
    // Existing ticket, wallet and invoice UI uses these compatibility fields.
    officialRateMnt: nonCashSell,
    effectiveRateMnt: nonCashSell + markupMnt,
    rateDate: rateDate || new Date().toISOString().slice(0, 10),
    source
  };
};

function configuredFallback() {
  const buy = number(process.env.GOLOMT_BANK_CNY_NONCASH_BUY);
  const sell = number(process.env.GOLOMT_BANK_CNY_NONCASH_SELL);
  if (!isRate(buy) || !isRate(sell)) return null;
  return buildRate({ nonCashBuy: buy, nonCashSell: sell, rateDate: process.env.GOLOMT_BANK_CNY_RATE_DATE, source: 'Manual Golomt Bank fallback' });
}

export async function getCnyMntRate() {
  if (cachedRate && Date.now() - cachedRate.loadedAt < CACHE_MS) return cachedRate.value;
  try {
    const response = await fetch(process.env.GOLOMT_BANK_CNY_RATE_API_URL || DEFAULT_SOURCE, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Golomt Bank rate service returned HTTP ${response.status}.`);
    const body = await response.json();
    const row = Array.isArray(body) ? body[0] : body;
    const cny = row?.rates?.cny?.noncash || {};
    const rate = buildRate({ nonCashBuy: number(cny.buy), nonCashSell: number(cny.sell), rateDate: row?.date || row?.rate_date || row?.last_date, source: 'Local Golomt Bank exchange-rate service' });
    cachedRate = { value: rate, loadedAt: Date.now() };
    return rate;
  } catch (error) {
    const fallback = configuredFallback();
    if (fallback) return fallback;
    throw new Error(`Exchange rate is temporarily unavailable: ${error.message}`);
  }
}

export function quoteCnyToMnt(amountCny, rate, purpose = 'sale') {
  const amount = number(amountCny);
  if (!Number.isFinite(amount)) throw new Error('A valid CNY amount is required.');
  const selectedRate = purpose === 'refund' ? rate?.refundRateMnt : rate?.topupRateMnt ?? rate?.effectiveRateMnt;
  if (!isRate(selectedRate)) throw new Error('A valid CNY/MNT rate is required.');
  return Math.round(amount * selectedRate);
}
