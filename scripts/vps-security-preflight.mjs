// Read-only. Never print environment values, tokens, passwords or URL query/path.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function parseEnvironment(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (/^["']/.test(value)) {
      if (value.at(-1) !== value[0]) throw new Error('Environment contains an unsupported quoted value. Inspect locally.');
      value = value.slice(1, -1);
    } else value = value.replace(/\s+#.*$/, '');
    values[match[1]] = value;
  }
  return values;
}
export function publicConfiguration(env) {
  const endpoints = Object.entries(env).filter(([name]) => /^SPRING_.*(?:URL)$/.test(name)).map(([name, value]) => {
    if (!value) return { name, configured: false };
    try { const url = new URL(value); return { name, protocol: url.protocol, host: url.hostname, port: url.port || (url.protocol === 'https:' ? '443' : '80') }; }
    catch { return { name, invalid: true }; }
  });
  return {
    emailStepEnabled: env.AUTH_EMAIL_OTP_REQUIRED === 'true',
    passwordRenewalEnabled: env.AUTH_PASSWORD_ROTATION_REQUIRED === 'true',
    deviceSigningKeyReady: /^[a-f0-9]{64,128}$/i.test(env.AUTH_DEVICE_SECRET || ''),
    trustedLoopbackProxy: env.TRUST_PROXY_LOOPBACK === 'true', endpoints
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.platform !== 'linux') throw new Error('Run on the VPS Linux terminal.');
    const env = parseEnvironment(readFileSync('/etc/flightb2b/flightb2b.env', 'utf8'));
    const start = execFileSync('systemctl', ['show', 'flightb2b', '-p', 'ExecStart', '--value'], { encoding: 'utf8' });
    const runtime = start.match(/path=([^; ]+)/)?.[1];
    const version = runtime ? execFileSync(runtime, ['--version'], { encoding: 'utf8' }).trim() : 'not-detected';
    console.log(JSON.stringify({ runtime, version, ...publicConfiguration(env) }, null, 2));
    if (process.argv.includes('--check-auth')) {
      const url = new URL(env.SUPABASE_URL);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Supabase must use a credential-free HTTPS URL.');
      const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
      if (!secret) throw new Error('Server database credential is missing.');
      const response = await fetch(new URL('/rest/v1/rpc/portal_auth_security_ready', url), {
        method: 'POST', headers: { apikey: secret, authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: '{}', signal: AbortSignal.timeout(15000), redirect: 'error'
      });
      const ready = response.ok && (await response.json()) === true;
      console.log(JSON.stringify({ portalAuthSchemaReady: ready }));
      if (!ready) process.exitCode = 1;
    }
  } catch { console.error('STOP: preflight failed. Inspect service/environment permissions locally; do not paste secrets.'); process.exitCode = 1; }
}
