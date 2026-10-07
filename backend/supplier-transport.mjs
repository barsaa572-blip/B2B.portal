// Never silently downgrade an HTTPS supplier endpoint or disable TLS validation.
// Requiring HTTPS is opt-in until the supplier supplies tested compatible URLs.
export const springEnabled = (env = process.env) => !env.STAGING_SUPPLIER_MODE || env.STAGING_SUPPLIER_MODE === 'spring';
export function requireSpringEnabled(env = process.env) {
  if (!springEnabled(env)) throw new Error('Spring is disabled in this test environment. No supplier request was sent.');
}
// Allow only explicitly local booking reads; deny new/future booking actions by
// default, before a supplier call or persistent financial guard can be entered.
export function blockedSupplierRoute(path, method, env = process.env) {
  if (springEnabled(env)) return false;
  if (path === '/api/flights' || path.startsWith('/api/flights/')) return true;
  if (path === '/api/bookings' || path.startsWith('/api/bookings/')) {
    return !(method === 'GET' && (['/api/bookings', '/api/bookings/dashboard'].includes(path) || /^\/api\/bookings\/[A-Za-z0-9-]+\/(ticket|receipt)\.pdf$/.test(path)));
  }
  return false;
}
export function springEndpoint(value, env = process.env) {
  requireSpringEnabled(env);
  let url;
  try { url = new URL(value); } catch { throw new Error('Spring endpoint configuration is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Spring endpoint configuration is invalid.');
  if (env.SPRING_REQUIRE_TLS === 'true' && url.protocol !== 'https:') throw new Error('Spring requires a verified HTTPS endpoint. Contact the supplier; no HTTP fallback was attempted.');
  return url.href;
}
