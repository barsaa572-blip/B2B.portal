// MNT is the sale price; CNY cents are the wallet settlement unit.
// BigInt arithmetic avoids floating-point ceil errors at exact 100 MNT boundaries.
const SCALE = 1000000n;
function decimal(value, places, name) {
  if (!['number','string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1e10) throw new Error(`Invalid ${name}.`);
  const fixed = Number(value).toFixed(places);
  return BigInt(fixed.replace('.', ''));
}
const cents = value => decimal(value, 2, 'CNY amount');
const nearest = (a, b) => (a + b / 2n) / b;
export const roundingEnabled = () => process.env.MNT_ROUNDING_ENABLED === 'true';

export function roundMntCny(amountCny, rateMnt, direction = 'charge') {
  if (!['charge', 'refund'].includes(direction)) throw new Error('Invalid rounding direction.');
  const rate = decimal(rateMnt, 6, 'exchange rate');
  if (rate <= 0n) throw new Error('Invalid exchange rate.');
  const numerator = cents(amountCny) * rate;
  const block = 10000n * SCALE;
  const result = Number((direction === 'refund' ? numerator / block : (numerator + block - 1n) / block) * 100n);
  if (!Number.isSafeInteger(result)) throw new Error('MNT amount exceeds safe accounting limits.');
  return result;
}

export function settleMnt(amountMnt, rateMnt) {
  const rate = decimal(rateMnt, 6, 'exchange rate');
  if (rate <= 0n || !Number.isSafeInteger(amountMnt) || amountMnt < 0) throw new Error('Invalid settlement amount.');
  return Number(nearest(BigInt(amountMnt) * 100n * SCALE, rate)) / 100;
}

function finish(supplierCny, rate, direction, lines, amountMnt) {
  rate = Number(decimal(rate, 6, 'exchange rate')) / 1e6;
  const supplier = Number(cents(supplierCny)) / 100;
  const walletCny = settleMnt(amountMnt, rate);
  return { version: 1, direction, rateMnt: Number(rate), amountMnt, walletCny,
    lines, supplierCny: supplier,
    marginCny: Number((direction === 'refund' ? supplier - walletCny : walletCny - supplier).toFixed(2)),
    adjustmentMnt: Number((direction === 'refund' ? supplier * rate - amountMnt : amountMnt - supplier * rate).toFixed(6)),
    conversionResidualMnt: Number((walletCny * rate - amountMnt).toFixed(6)) };
}

export function retailTicket(price, rateMnt) {
  if (!Array.isArray(price?.breakdown) || !price.breakdown.length) throw new Error('Verified fare breakdown required.');
  const lines = price.breakdown.map(row => {
    if (!Number.isInteger(row.count) || row.count < 1 || row.count > 9) throw new Error('Invalid passenger count.');
    const count = BigInt(row.count);
    const fare = cents(row.fare), taxes = cents(row.taxes);
    if (fare % count || taxes % count) throw new Error('Per-passenger fare is not exact.');
    const unitFareMnt = roundMntCny(Number(fare / count) / 100, rateMnt);
    const unitTaxesMnt = roundMntCny(Number(taxes / count) / 100, rateMnt);
    return { type: row.type, count: row.count, unitFareMnt, unitTaxesMnt,
      fareMnt: unitFareMnt * row.count, taxesMnt: unitTaxesMnt * row.count,
      totalMnt: (unitFareMnt + unitTaxesMnt) * row.count };
  });
  const sumCents = price.breakdown.reduce((sum, row) => sum + cents(row.fare) + cents(row.taxes), 0n);
  if (sumCents !== cents(price.total)) throw new Error('Fare breakdown does not match total.');
  return finish(price.total, rateMnt, 'charge', lines, lines.reduce((sum, row) => sum + row.totalMnt, 0));
}

export function retailAmount(supplierCny, rateMnt, direction = 'charge') {
  return finish(supplierCny, rateMnt, direction, [], roundMntCny(supplierCny, rateMnt, direction));
}

export function retailComponents(components, rateMnt) {
  const lines = Object.entries(components).map(([type, value]) => ({ type, totalMnt: roundMntCny(value, rateMnt) }));
  const source = Number(Object.values(components).reduce((sum, value) => sum + cents(value), 0n)) / 100;
  return finish(source, rateMnt, 'charge', lines, lines.reduce((sum, line) => sum + line.totalMnt, 0));
}

// Only this subset may cross the agency-facing boundary. Cost/margin stay private.
export function publicRetail(snapshot) {
  if (!snapshot) return null;
  const { version, direction, rateMnt, amountMnt, walletCny, lines } = snapshot;
  return { version, direction, rateMnt, amountMnt, walletCny, lines };
}

export function agencyPrice(price, snapshot) {
  if (!snapshot) return price;
  return { currency: 'CNY', total: snapshot.walletCny,
    fare: snapshot.lines.reduce((sum, row) => sum + row.fareMnt, 0) / snapshot.rateMnt,
    taxes: snapshot.lines.reduce((sum, row) => sum + row.taxesMnt, 0) / snapshot.rateMnt,
    breakdown: snapshot.lines.map(row => ({ type: row.type, count: row.count,
      fare: row.fareMnt / snapshot.rateMnt, taxes: row.taxesMnt / snapshot.rateMnt, total: row.totalMnt / snapshot.rateMnt })),
    retail: publicRetail(snapshot), ...(price.quoteId ? { quoteId: price.quoteId, expiresAt: price.expiresAt } : {}) };
}

export function agencyBooking(booking) {
  const result = structuredClone(booking);
  result.itinerary = agencyResponse(result.itinerary);
  if (!booking?.retail_price) return result;
  result.total_cny = result.retail_price.walletCny;
  result.total_mnt = result.retail_price.amountMnt;
  delete result.itinerary.verifiedPrice;
  // Supplier-only pricing data never goes to an agent, even via Network tools.
  const strip = value => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (['supplierCny','marginCny','adjustmentMnt','conversionResidualMnt','combPrice','orderMoneyCny'].includes(key)) delete value[key];
      else strip(value[key]);
    }
  };
  strip(result.itinerary);
  for (const flight of result.itinerary.flights || []) {
    delete flight.price;
    if (flight.fare) { delete flight.fare.baseFare; delete flight.fare.taxes; }
  }
  return result;
}

export function agencyResponse(value) {
  if (Array.isArray(value)) return value.map(agencyResponse);
  if (!value || typeof value !== 'object') return value;
  if (value.pnr && value.itinerary && value.passengers) return agencyBooking(value);
  if (value.retail && value.amountsCny) {
    const result = structuredClone(value);
    result.amountsCny = value.appId ? { additionalPayment: value.retail.walletCny } : { refund: value.retail.walletCny };
    result.retail = publicRetail(value.retail);
    return result;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, agencyResponse(item)]));
}
