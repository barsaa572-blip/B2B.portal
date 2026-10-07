// Prepare only the existing, isolated test env. No production writes or API calls.
import { readFile, writeFile, rename, realpath, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseEnvironment } from '../../scripts/vps-security-preflight.mjs';
import { assertStaging } from './safety.mjs';
const FILE = '/etc/flightb2b-test/flightb2b-test.env';
const REFERENCE = '/etc/flightb2b-test/production-reference.json';

export function authOnlyEnvironment(source, reference) {
  const seen = new Set();
  for (const line of source.split(/\r?\n/)) {
    if (line.trim() && !/^\s*#/.test(line) && !/^\s*[A-Z][A-Z0-9_]*\s*=/.test(line)) throw new Error('STOP: unsupported env syntax. Inspect privately.');
    const key = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1];
    if (key && seen.has(key)) throw new Error('STOP: duplicate env settings. Inspect privately.');
    if (key) seen.add(key);
  }
  const env = parseEnvironment(source);
  if (env.APP_ENV !== 'staging' || env.PORT !== '4174' || env.FRONTEND_ORIGIN !== 'https://test.nexahub.airsales.ub.mn') throw new Error('STOP: expected isolated test environment/origin is missing.');
  const removed = key => key.startsWith('SPRING_') || ['STAGING_SUPPLIER_MODE', 'STAGING_SPRING_ALLOWED_ORIGINS', 'STAGING_TRANSACTIONS_CONFIRMED', 'SERPAPI_KEY'].includes(key);
  const updates = { STAGING_SUPPLIER_MODE: 'disabled', SPRING_BOOKING_ENABLED: 'false', SPRING_CREDIT_PAYMENT_ENABLED: 'false', SPRING_STATUS_SYNC_ENABLED: 'false', STAGING_TRANSACTIONS_CONFIRMED: 'false' };
  const result = source.split(/\r?\n/).filter(line => {
    if (/^\s*#/.test(line) && /SPRING_|SERPAPI_KEY/.test(line)) return false;
    const key = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1];
    return !key || !removed(key);
  }).join('\n').trimEnd() + '\n' + Object.entries(updates).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
  assertStaging(parseEnvironment(result), reference);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('STOP: run as root on the VPS.');
    if (!process.argv.includes('--confirm-test-only')) throw new Error('STOP: --confirm-test-only is required.');
    for (const file of [FILE, REFERENCE]) {
      if (await realpath(file) !== file || (await stat(file)).uid !== 0) throw new Error('STOP: unexpected test path or ownership.');
    }
    const source = await readFile(FILE, 'utf8');
    const next = authOnlyEnvironment(source, JSON.parse(await readFile(REFERENCE, 'utf8')));
    if (next === source) { console.log('READY: Test supplier mode already disabled.'); process.exit(0); }
    const backup = `${FILE}.before-auth-only-${Date.now()}-${randomBytes(3).toString('hex')}`;
    await writeFile(backup, source, { flag: 'wx', mode: 0o600 });
    // Do not replace a concurrently edited secret file.
    if (await readFile(FILE, 'utf8') !== source) throw new Error('STOP: test env changed during preparation. No replacement made.');
    const temporary = `${FILE}.prepared-${randomBytes(6).toString('hex')}`;
    await writeFile(temporary, next, { flag: 'wx', mode: 0o600 });
    await rename(temporary, FILE);
    console.log('READY: Test env prepared. Spring credentials/endpoints removed; all supplier actions disabled.');
    console.log('Private backup: ' + backup);
  } catch (error) {
    // Guard errors contain setting names only; never print source/provider errors.
    console.error(error.message?.startsWith('STOP:') ? error.message : 'STOP: test isolation validation failed. Inspect privately; do not share the env file.');
    process.exitCode = 1;
  }
}
