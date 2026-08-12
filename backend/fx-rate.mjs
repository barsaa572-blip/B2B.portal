const MARKUP_MNT = 4;

const number = value => Number(String(value ?? '').replace(/,/g, ''));

export function getCnyMntRate() {
  const official = number(process.env.MONGOLBANK_CNY_RATE);
  if (!Number.isFinite(official) || official <= 0) {
    throw new Error('Mongolbank CNY rate is not configured on this server.');
  }

  return {
    currency: 'CNY',
    officialRateMnt: official,
    markupMnt: MARKUP_MNT,
    effectiveRateMnt: official + MARKUP_MNT,
    rateDate: process.env.MONGOLBANK_CNY_RATE_DATE || new Date().toISOString().slice(0, 10),
    source: 'Bank of Mongolia official rate'
  };
}

export function quoteCnyToMnt(amountCny, rate = getCnyMntRate()) {
  const amount = number(amountCny);
  if (!Number.isFinite(amount)) throw new Error('A valid CNY amount is required.');
  return Math.round(amount * rate.effectiveRateMnt);
}
