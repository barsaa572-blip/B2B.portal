import { readFileSync } from 'node:fs';
import { assertStaging } from './safety.mjs';

try {
  const reference = JSON.parse(readFileSync('/etc/flightb2b-test/production-reference.json', 'utf8'));
  assertStaging(process.env, reference);
} catch (error) {
  console.error(`Staging startup blocked: ${error.code ? 'isolation reference could not be read' : error.message}`);
  process.exit(1);
}
if (process.argv.includes('--check')) console.log('Staging isolation checks passed. No server or supplier request was started.');
else await import('../../server.mjs');
