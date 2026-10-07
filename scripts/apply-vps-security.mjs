// Explicit, individually gated VPS changes. Run only after acceptance on test.
// No supplier URL changes, system-wide Node upgrades, SQL writes or email sends.
import { readFile, writeFile, realpath, stat, mkdir, mkdtemp, rename, unlink, chmod, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { dirname, basename } from 'node:path';
import { parseEnvironment } from './vps-security-preflight.mjs';
const exec = promisify(execFile);
const REPO = '/opt/flightb2b';
const ENV = '/etc/flightb2b/flightb2b.env';
const DOMAIN = 'nexahub.airsales.ub.mn';
const NODE = '24.21.0';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function replaceFile(file, value, mode = 0o600) {
  const temporary = `${dirname(file)}/.${basename(file)}.security-${randomBytes(6).toString('hex')}`;
  await writeFile(temporary, value, { flag: 'wx', mode });
  await chmod(temporary, mode);
  await rename(temporary, file); // A failed write never truncates the working config.
}
async function privateEnvironment() {
  if (await realpath(ENV) !== ENV || (await stat(ENV)).uid !== 0) throw new Error('STOP: environment path/ownership is unexpected.');
  return readFile(ENV, 'utf8');
}

export function hardenedNginx(source) {
  const names = [...source.matchAll(/\bserver_name\s+([^;]+);/g)].flatMap(m => m[1].trim().split(/\s+/));
  if (!names.length || names.some(n => n !== DOMAIN)) throw new Error('STOP: Nginx file contains unexpected domains. Review manually.');
  const directive = /^\s*add_header\s+Strict-Transport-Security\s+[^;]+;[^\r\n]*/gm;
  let result;
  if (directive.test(source)) result = source.replace(directive, '\n    add_header Strict-Transport-Security "max-age=31536000" always;');
  else {
    const listen = /^([ \t]*listen\s+443\s+ssl[^\r\n]*)(\r?\n)/m;
    if (!listen.test(source)) throw new Error('STOP: expected HTTPS listener is missing.');
    result = source.replace(listen, '$1$2    add_header Strict-Transport-Security "max-age=31536000" always;\n');
  }
  if (!/proxy_hide_header\s+Strict-Transport-Security\s*;/.test(result)) {
    const proxy = /(proxy_pass\s+http:\/\/127\.0\.0\.1:4173\s*;)/g;
    if ([...result.matchAll(proxy)].length !== 1) throw new Error('STOP: expected production proxy is ambiguous.');
    result = result.replace(proxy, '$1\n        proxy_hide_header Strict-Transport-Security;');
  }
  return result;
}
export function setEnvironment(source, updates) {
  let result = source;
  for (const [name, value] of Object.entries(updates)) {
    if (!/^[A-Z_]+$/.test(name) || /[\r\n]/.test(value)) throw new Error('STOP: invalid configuration update.');
    const line = new RegExp(`^[ \\t]*${name}[ \\t]*=.*$`, 'gm');
    if ([...result.matchAll(line)].length > 1) throw new Error('STOP: duplicate security setting. Inspect locally.');
    if (line.test(result)) result = result.replace(line, `${name}=${value}`);
    else result += `${result.endsWith('\n') ? '' : '\n'}${name}=${value}\n`;
  }
  return result;
}
async function response(url) {
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error('STOP: verified download/check failed.');
  return res;
}
async function ready() {
  for (let attempt = 0; attempt < 15; attempt++) {
    try { const res = await fetch('http://127.0.0.1:4173/api/health', { signal: AbortSignal.timeout(3000) });
      if (res.ok && (await res.json()).ok === true) return; } catch {}
    await delay(1000);
  }
  throw new Error('STOP: backend health failed. Previous configuration will be restored.');
}
async function applyHsts() {
  const file = await realpath('/etc/nginx/sites-enabled/flightb2b');
  if (!['/etc/nginx/sites-available/flightb2b','/etc/nginx/sites-enabled/flightb2b'].includes(file)) throw new Error('STOP: unexpected Nginx config path.');
  const previous = await readFile(file, 'utf8'), info = await stat(file);
  if (info.uid !== 0) throw new Error('STOP: Nginx config is not root-owned.');
  const next = hardenedNginx(previous);
  if (next === previous) return console.log('HSTS already configured for one year.');
  const backup = `${file}.security-backup-${Date.now()}`;
  await writeFile(backup, previous, { flag: 'wx', mode: 0o600 });
  try {
    await replaceFile(file, next, info.mode & 0o777);
    await exec('nginx', ['-t']); await exec('systemctl', ['reload', 'nginx']);
    const res = await response(`https://${DOMAIN}/`);
    if (res.headers.get('strict-transport-security') !== 'max-age=31536000') throw new Error('STOP: live HSTS header differs; review inheritance/duplicate headers.');
    console.log('READY: one-year, host-only HSTS. Backup: ' + backup);
  } catch (error) {
    await replaceFile(file, previous, info.mode & 0o777); await exec('nginx', ['-t']); await exec('systemctl', ['reload', 'nginx']);
    throw error;
  }
}
async function activateLogin(args) {
  if (!args.includes('--email-code-template-confirmed')) throw new Error('STOP: first accept the email-code template and SMTP on test.');
  const previous = await privateEnvironment(), env = parseEnvironment(previous), info = await stat(ENV);
  if (info.uid !== 0) throw new Error('STOP: production environment is not root-owned.');
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('STOP: invalid Supabase HTTPS configuration.');
  const res = await fetch(new URL('/rest/v1/rpc/portal_auth_security_ready', url), { method: 'POST', redirect: 'error',
    headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'content-type': 'application/json' },
    body: '{}', signal: AbortSignal.timeout(15000) });
  if (!res.ok || (await res.json()) !== true) throw new Error('STOP: portal_auth_security_ready must be true. No settings changed.');
  if (env.AUTH_DEVICE_SECRET && !/^[a-f0-9]{64,128}$/i.test(env.AUTH_DEVICE_SECRET)) throw new Error('STOP: invalid existing device key. Review locally.');
  const next = setEnvironment(previous, { AUTH_DEVICE_SECRET: env.AUTH_DEVICE_SECRET || randomBytes(32).toString('hex'),
    AUTH_EMAIL_OTP_REQUIRED: 'true', AUTH_PASSWORD_ROTATION_REQUIRED: 'true' });
  const backup = `${ENV}.security-backup-${Date.now()}`;
  await writeFile(backup, previous, { flag: 'wx', mode: 0o600 });
  try {
    await replaceFile(ENV, next, 0o600);
    await exec('systemctl', ['restart', 'flightb2b']); await ready();
    console.log('READY: email step and password renewal enabled; private signing key saved, never printed.');
    console.log('Accept a designated account now. Configuration backup: ' + backup);
  } catch (error) {
    await replaceFile(ENV, previous, 0o600);
    await exec('systemctl', ['restart', 'flightb2b']); await ready(); throw error;
  }
}
async function upgradeNode() {
  if (process.arch !== 'x64') throw new Error('STOP: this reviewed runtime is Linux x64 only.');
  const { stdout: start } = await exec('systemctl', ['show', 'flightb2b', '-p', 'ExecStart', '--value']);
  const current = start.match(/path=([^; ]+)/)?.[1];
  const argv = start.match(/argv\[\]=([^;]+);/)?.[1]?.trim();
  if (!current || argv !== `${current} ${REPO}/server.mjs`) throw new Error('STOP: unexpected service arguments. Do not overwrite them.');
  const { stdout: version } = await exec(current, ['--version']);
  console.log('Current production Node: ' + version.trim());
  if ([22,24].includes(Number(version.trim().match(/^v(\d+)/)?.[1]))) {
    console.log('Runtime is on a supported LTS major; no EOL migration was applied. Check patch currency separately.'); return;
  }
  const folder = `node-v${NODE}-linux-x64`, archive = `${folder}.tar.xz`;
  const temporary = await mkdtemp('/tmp/nexahub-runtime-');
  const sums = await (await response(`https://nodejs.org/dist/v${NODE}/SHASUMS256.txt`)).text();
  const checksum = sums.split('\n').find(s => s.trim().endsWith('  ' + archive))?.split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(checksum || '')) throw new Error('STOP: official Node checksum not found.');
  const bytes = Buffer.from(await (await response(`https://nodejs.org/dist/v${NODE}/${archive}`)).arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error('STOP: Node checksum mismatch.');
  await writeFile(`${temporary}/${archive}`, bytes, { flag: 'wx', mode: 0o600 });
  await exec('tar', ['-xJf', `${temporary}/${archive}`, '-C', temporary]);
  await mkdir('/opt/nexahub-runtime', { recursive: true, mode: 0o755 });
  const parent = await stat('/opt/nexahub-runtime');
  if (await realpath('/opt/nexahub-runtime') !== '/opt/nexahub-runtime' || parent.uid !== 0 || (parent.mode & 0o022)) throw new Error('STOP: unsafe runtime parent directory.');
  const destination = `/opt/nexahub-runtime/${folder}`;
  try { await stat(destination); throw new Error('STOP: target runtime directory already exists; inspect before reuse.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rename(`${temporary}/${folder}`, destination);
  const runtime = `${destination}/bin/node`;
  const testEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(SUPABASE_|SPRING_|AUTH_)/.test(name)));
  const tests = (await readdir(`${REPO}/tests`)).filter(n => /\.test\.[cm]?js$/.test(n)).map(n => `${REPO}/tests/${n}`);
  await exec(runtime, ['--check', `${REPO}/server.mjs`]);
  await exec(runtime, ['--test', ...tests], { cwd: REPO, env: testEnv, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  const directory = '/etc/systemd/system/flightb2b.service.d';
  const override = `${directory}/90-nexahub-runtime.conf`;
  await mkdir(directory, { recursive: true, mode: 0o755 });
  const overrideParent = await stat(directory);
  if (await realpath(directory) !== directory || overrideParent.uid !== 0 || (overrideParent.mode & 0o022)) throw new Error('STOP: unsafe service override directory.');
  try { await stat(override); throw new Error('STOP: runtime override already exists; inspect before changing.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(override, `[Service]\nExecStart=\nExecStart=${runtime} ${REPO}/server.mjs\n`, { flag: 'wx', mode: 0o644 });
  try {
    await exec('systemctl', ['daemon-reload']); await exec('systemctl', ['restart', 'flightb2b']); await ready();
    const { stdout: pid } = await exec('systemctl', ['show', 'flightb2b', '-p', 'MainPID', '--value']);
    if (!/^[1-9]\d*$/.test(pid.trim()) || await realpath(`/proc/${pid.trim()}/exe`) !== runtime) {
      throw new Error('STOP: another service override prevented the reviewed runtime from starting.');
    }
    console.log(`READY: production service uses Node ${NODE}. System Node and old runtime were preserved.`);
    console.log('Verified download retained at: ' + temporary);
  } catch (error) {
    await unlink(override); await exec('systemctl', ['daemon-reload']);
    await exec('systemctl', ['restart', 'flightb2b']); await ready(); throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('STOP: run in the VPS root terminal.');
    const args = process.argv.slice(2), revision = args[args.indexOf('--revision') + 1];
    if (!args.includes('--revision') || !/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('STOP: supply the exact tested commit with --revision.');
    const { stdout: head } = await exec('git', ['-c', `safe.directory=${REPO}`, '-C', REPO, 'rev-parse', 'HEAD']);
    if (head.trim() !== revision) throw new Error('STOP: checkout differs from the accepted commit.');
    const { stdout: dirty } = await exec('git', ['-c', `safe.directory=${REPO}`, '-C', REPO, 'status', '--porcelain', '--untracked-files=no']);
    if (dirty.trim()) throw new Error('STOP: tracked VPS changes require review.');
    const modes = ['--hsts','--activate-login','--upgrade-node'].filter(m => args.includes(m));
    if (modes.length !== 1) throw new Error('STOP: select exactly one change.');
    if (modes[0] === '--hsts') await applyHsts();
    if (modes[0] === '--activate-login') await activateLogin(args);
    if (modes[0] === '--upgrade-node') await upgradeNode();
  } catch (error) {
    // Do not leak provider responses, private headers/env, or subprocess dumps.
    console.error(error.message?.startsWith('STOP:') ? error.message : 'STOP: operation failed. Inspect locally; do not share secrets.'); process.exitCode = 1;
  }
}
