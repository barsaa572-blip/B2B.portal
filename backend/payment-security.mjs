// A quote must have been persisted by this backend for this exact booking.
// Never treat the amount/appId supplied by the browser as payment authority.
export function requireChangeQuote(booking, appId, amount, now = Date.now()) {
  const id = Number(appId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid change application.');
  const quote = booking.itinerary?.changeQuotes?.[String(id)];
  const savedAmount = quote?.amountsCny?.additionalPayment;
  const age = now - Date.parse(quote?.quotedAt || '');
  if (!quote || quote.securityVersion !== 1 || Number(quote.appId) !== id || !Number.isFinite(age) || age < 0 || age > 15 * 60000) {
    throw new Error('A recent server-verified change quote is required. Please calculate again.');
  }
  if (typeof savedAmount !== 'number' || !Number.isFinite(savedAmount) || savedAmount < 0) throw new Error('Invalid server change quote.');
  if (amount !== undefined && (!Number.isFinite(Number(amount)) || Math.round(Number(amount) * 100) !== Math.round(savedAmount * 100))) {
    throw new Error('Change amount differs from the Spring quote. Please calculate again.');
  }
  return quote;
}

export function cleanBookingItinerary(itinerary) {
  // Do not accept forged change quotes, refund history or supplier status.
  const { route, trip, departureDate, returnDate, flights } = itinerary || {};
  if (!Array.isArray(flights) || flights.length < 1 || flights.length > 2) throw new Error('One or two flight segments are required.');
  return { route, trip, departureDate, returnDate, flights };
}

export async function guardedPayment({ begin, finish, actor, pnr, action, reference, amount }, execute) {
  // A failed/missing migration must fail BEFORE any supplier mutation.
  const id = await begin({ actor, pnr, action, reference, amount });
  if (typeof id !== 'string' || !id) throw new Error('Financial operation could not be verified. No supplier request was sent.');
  try {
    const result = await execute();
    await finish(id, actor, 'completed');
    return result;
  } catch (error) {
    // Never automatically unlock ambiguous payments, even after a restart.
    // Finance must check supplier + ledger before resolving this record.
    await finish(id, actor, 'needs_review').catch(() => {});
    throw new Error(`Financial operation needs reconciliation (${id}). Do not retry; contact support. ${error.message || ''}`);
  }
}
