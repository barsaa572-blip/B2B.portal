import { writeFileSync } from 'node:fs';
import { productionReference } from './safety.mjs';

// Run as root with Node --env-file pointing at the existing production env.
// Does not start the application, contact any API or print configuration values.
try {
  const reference = productionReference(process.env);
  writeFileSync('/etc/flightb2b-test/production-reference.json', JSON.stringify(reference, null, 2) + '\n', { flag:'wx', mode:0o600 });
  console.log('Production isolation reference created. No credentials were copied.');
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'Reference already exists; no file was overwritten.' : 'Reference creation failed. Check production environment variables and directory permissions.');
  process.exit(1);
}
