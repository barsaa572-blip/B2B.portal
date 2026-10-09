import { randomUUID } from 'node:crypto';

// Provider fields are untrusted. Never log messages, bodies, URLs, identities,
// order references, tokens or stacks. Only recognise short error-code formats.
export function safeSpringCode(value) {
  if (!['string', 'number'].includes(typeof value)) return null;
  const code = String(value);
  return /^(?:[A-Z]{2,12}[-_]\d{1,6}|\d{1,8})$/.test(code) ? code : null;
}
export function springRequestError(message, code, status) {
  const error = new Error(message);
  error.springCode = safeSpringCode(code);
  error.springHttpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  return error;
}

const stages = new Set(['authentication', 'request_body', 'passenger_validation',
  'pricing_schema', 'input_cleanup', 'booking_configuration', 'spring_payload',
  'quote_validation', 'spring_client', 'spring_token', 'price_verification',
  'quote_recheck', 'supplier_booking', 'supplier_response', 'portal_save']);
export function createBookingDiagnostic({ write = line => console.warn(line) } = {}) {
  const id = randomUUID();
  let stage = 'authentication', supplierAttempted = false, supplierReferenceReceived = false;
  return {
    id,
    step(next) {
      if (!stages.has(next)) return;
      stage = next;
      if (next === 'supplier_booking') supplierAttempted = true;
      if (next === 'portal_save') supplierReferenceReceived = true;
    },
    fail(error) {
      const kind = ['AbortError', 'TimeoutError', 'HttpError', 'BookingReviewRequired'].includes(error?.name) ? error.name : 'Error';
      const record = { id, stage, supplierAttempted, supplierReferenceReceived,
        kind, springCode: safeSpringCode(error?.springCode),
        springHttpStatus: Number.isInteger(error?.springHttpStatus) && error.springHttpStatus >= 100 && error.springHttpStatus <= 599 ? error.springHttpStatus : null };
      try { write('NEXAHUB_BOOKING_DIAGNOSTIC ' + JSON.stringify(record)); } catch {}
      return id;
    }
  };
}
