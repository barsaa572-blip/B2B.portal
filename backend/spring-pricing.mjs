import { randomUUID } from 'node:crypto';

const fail = message => { throw new Error(message); };
const amount = value => {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1e8) fail('Spring returned an invalid or missing fare/tax amount. Price verification is required.');
  return Math.round(Number(value) * 100);
};
const integer = (value, label) => {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isSafeInteger(Number(value))) fail(`Invalid ${label}. Search and select the fare again.`);
  return Number(value);
};

export function priceSelection(flights, passengers) {
  if (!Array.isArray(flights) || flights.length < 1 || flights.length > 2) fail('Select one or two flight segments.');
  const counts = Object.fromEntries(['adults', 'children', 'infants'].map(key => [key, integer(passengers?.[key], key)]));
  if (counts.adults < 1 || counts.children < 0 || counts.infants < 0 || counts.infants > counts.adults || Object.values(counts).reduce((a, b) => a + b, 0) > 9) fail('Invalid passenger counts (maximum 9 travellers; infants require an adult).');
  const segments = flights.map(flight => {
    const s = flight?.spring || {};
    const segHeadId = integer(s.segHeadId, 'segment ID');
    const cabinType = integer(s.cabinType, 'fare cabin type');
    if (segHeadId <= 0 || ![1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].includes(cabinType)) fail('Unsupported Spring fare. Search again.');
    if (integer(s.moneyClassId, 'currency') !== 0) fail('Only verified CNY fares are supported.');
    if (typeof s.adultCabin !== 'string' || !/^[A-Za-z0-9]{1,5}$/.test(s.adultCabin)) fail('Missing or invalid adult cabin.');
    // Bind all booking combination fields as well as the pricing fields.
    return { segHeadId, cabinType, adultCabin: s.adultCabin, moneyClassId: 0,
      combId: integer(s.combId, 'combination ID'), combType: integer(s.combType, 'combination type'), combPrice: amount(s.combPrice) / 100 };
  });
  return { counts, segments };
}

export function priceRequest(selection) {
  return { lang: 'zh_cn', moneyClassId: 0, segType: selection.segments.length === 2 ? 'Y' : 'N',
    segHeadIds: selection.segments.map(s => s.segHeadId), cabinNames: selection.segments.map(s => s.adultCabin), cabinTypes: selection.segments.map(s => s.cabinType) };
}

// The supplied getSpecificPrice contract returns per-person, per-segment lists.
// Unknown wrappers/missing fields fail closed; never infer a child discount.
export function verifiedPrice(data, selection) {
  if (data?.ifSuccess !== 'Y') fail('Spring did not confirm the selected price.');
  const fields = { adults: 'adultTravPriceForSeg', children: 'childTravPriceForSeg', infants: 'infantTravPriceForSeg' };
  const breakdown = Object.entries(fields).filter(([type]) => selection.counts[type] > 0).map(([type, field]) => {
    const list = data[field];
    if (!Array.isArray(list) || list.length !== selection.segments.length) fail(`Spring did not return complete ${type} prices. No booking was submitted.`);
    const segments = list.map(row => {
      const fare = amount(row?.cabinPrice);
      const taxes = amount(row?.fuelFee) + amount(row?.portPay) + amount(row?.otherFeeSum);
      return { fare: fare / 100, taxes: taxes / 100, total: (fare + taxes) / 100 };
    });
    const count = selection.counts[type];
    const fare = segments.reduce((sum, s) => sum + Math.round(s.fare * 100), 0) * count;
    const taxes = segments.reduce((sum, s) => sum + Math.round(s.taxes * 100), 0) * count;
    return { type, count, segments, fare: fare / 100, taxes: taxes / 100, total: (fare + taxes) / 100 };
  });
  const sum = key => breakdown.reduce((total, row) => total + Math.round(row[key] * 100), 0) / 100;
  return { currency: 'CNY', breakdown, fare: sum('fare'), taxes: sum('taxes'), total: sum('total') };
}

export function createPriceQuotes({ now = Date.now, ttl = 600000, limit = 1000 } = {}) {
  const quotes = new Map();
  return {
    save(actor, selection, price) {
      for (const [id, quote] of quotes) if (quote.expiresAt <= now()) quotes.delete(id);
      if (quotes.size >= limit) quotes.delete(quotes.keys().next().value);
      const id = randomUUID();
      const expiresAt = now() + ttl;
      quotes.set(id, { actor, fingerprint: JSON.stringify(selection), price: structuredClone(price), expiresAt });
      return { ...price, quoteId: id, expiresAt };
    },
    require(id, actor, selection) {
      const quote = quotes.get(id);
      if (!quote || quote.expiresAt <= now() || quote.actor !== actor || quote.fingerprint !== JSON.stringify(selection)) fail('Price quote expired or does not match this selection. Verify the price again.');
      return structuredClone(quote.price);
    },
    consume(id) { quotes.delete(id); }
  };
}

export function flightList(data) {
  if (data?.ifSuccess !== 'Y' || !Array.isArray(data.flightsList)) fail('Spring returned an unrecognised availability response; no availability could be confirmed.');
  return data.flightsList;
}
