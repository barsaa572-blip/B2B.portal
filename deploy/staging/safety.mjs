import { createHash } from 'node:crypto';

const credentialKeys = ['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SPRING_OAUTH_CLIENT_ID', 'SPRING_OAUTH_CLIENT_SECRET', 'SPRING_XML_USERNAME', 'SPRING_XML_PASSWORD'];
const fingerprint = value => createHash('sha256').update(value).digest('hex');
const springUrls = env => Object.entries(env).filter(([key, value]) => key.startsWith('SPRING_') && key.endsWith('_URL') && value);
function origin(value, name) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.origin;
  } catch { throw new Error(`${name}: enter a valid HTTP(S) URL without embedded credentials.`); }
}
const required = (env, key) => {
  if (!env[key]?.trim() || /^(REPLACE|YOUR_|TEST_)/.test(env[key])) throw new Error(`${key} must be configured before starting staging.`);
  return env[key].trim();
};

// This reference contains origins and one-way fingerprints, not production secrets.
export function productionReference(env) {
  const supabaseOrigin = origin(required(env, 'SUPABASE_URL'), 'SUPABASE_URL');
  for (const key of credentialKeys.slice(0, 4)) required(env, key);
  const springOrigins = [...new Set(springUrls(env).map(([key, value]) => origin(value, key)))];
  if (!springOrigins.length) throw new Error('Production Spring URLs were not found. Reference creation stopped.');
  return { version:1, supabaseOrigin, springOrigins, fingerprints:Object.fromEntries(credentialKeys.filter(key => env[key]).map(key => [key,fingerprint(env[key])])) };
}

export function assertStaging(env, reference) {
  if (env.APP_ENV !== 'staging' || env.PORT !== '4174' || env.FRONTEND_ORIGIN !== 'https://test.nexahub.airsales.ub.mn') throw new Error('Staging requires APP_ENV=staging, PORT=4174 and the test frontend origin.');
  if (reference?.version !== 1 || !reference.supabaseOrigin || !reference.springOrigins?.length || !reference.fingerprints?.SUPABASE_SECRET_KEY || !reference.fingerprints?.SPRING_OAUTH_CLIENT_SECRET) throw new Error('A valid production isolation reference is required.');
  const database = origin(required(env, 'SUPABASE_URL'), 'SUPABASE_URL');
  if (!database.startsWith('https://') || database === reference.supabaseOrigin) throw new Error('Staging must use a separate HTTPS Supabase project, never the production project.');
  for (const key of credentialKeys.slice(0, 4)) required(env, key);
  for (const key of credentialKeys) {
    if (env[key] && reference.fingerprints[key] === fingerprint(env[key])) throw new Error(`${key} matches production. Use separate test credentials.`);
  }
  const allowed = required(env, 'STAGING_SPRING_ALLOWED_ORIGINS').split(',').map(value => origin(value.trim(), 'STAGING_SPRING_ALLOWED_ORIGINS'));
  if (allowed.some(value => reference.springOrigins.includes(value))) throw new Error('A Spring origin matches production. Confirm separate test endpoints before proceeding.');
  for (const key of ['SPRING_HTTP_BASE_URL', 'SPRING_TOKEN_URL', 'SPRING_FLIGHT_SEARCH_URL', 'SPRING_PRICE_CHECK_URL', 'SPRING_FARE_RULES_URL']) required(env, key);
  for (const [key,value] of springUrls(env)) {
    const host = origin(value, key);
    if (!allowed.includes(host) || reference.springOrigins.includes(host)) throw new Error(`${key} is outside the approved test origins.`);
  }
  for (const key of ['SPRING_BOOKING_ENABLED','SPRING_CREDIT_PAYMENT_ENABLED']) {
    if (!['true','false'].includes(env[key])) throw new Error(`${key} must explicitly be true or false.`);
  }
  if ((env.SPRING_BOOKING_ENABLED === 'true' || env.SPRING_CREDIT_PAYMENT_ENABLED === 'true') && env.STAGING_TRANSACTIONS_CONFIRMED !== 'true') throw new Error('Keep booking/payment disabled until test isolation and supplier permission are confirmed.');
}
