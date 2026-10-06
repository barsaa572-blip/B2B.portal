// Read-only, redacted audit. Never prints matching values or rewrites history.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function secretIndicators(text) {
  const findings = new Set();
  if (/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]{80,}?-----END (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(text)) findings.add('private-key');
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}|AKIA[A-Z0-9]{16}|sb_secret_[A-Za-z0-9_-]{20,})\b/.test(text)) findings.add('provider-secret');
  for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString());
      findings.add(payload.role === 'service_role' ? 'service-role-jwt' : payload.role === 'anon' ? 'public-anon-jwt-review' : 'auth-jwt-review');
    } catch { findings.add('jwt-shaped-value-review'); }
  }
  for (const match of text.matchAll(/https?:\/\/[^\s/"']+:[^\s/@"']+@[^\s/"']+/gi)) {
    if (match[0] !== 'https://user:secret@test-supplier.invalid') findings.add('url-credentials-review');
  }
  if (/[#?&](?:access_token|refresh_token)=[A-Za-z0-9_.-]{20,}/i.test(text)) findings.add('auth-url-token-review');
  for (const match of text.matchAll(/\b(?:[A-Z_]*(?:SECRET|PASSWORD|PRIVATE_KEY|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN)[A-Z_]*|clientSecret|apiKey)\s*[=:]\s*["']([^"'\r\n]{16,})["']/gi)) {
    const value = match[1];
    // Exact, reviewed constants from local isolated test fixtures, not blanket
    // exclusions for tests or files named .env.example.
    if (/^server-only-(?:access|refresh)(?:-[ab])?$/.test(value) || /^server-(?:password|email|otp)-(?:token|refresh)$/.test(value) || ['fresh-user-token', 'secret-never-for-passwords', 'live-supplier-secret', 'StrongPassword1!'].includes(value)) continue;
    if (!/(?:test|fake|mock|sample|example|placeholder|your_|process\.|env\.|\$\{|\{\{|^Bearer |^Use |^Enter )/i.test(value) && /^[A-Za-z0-9_+/=.!-]+$/.test(value)) findings.add('credential-literal-review');
  }
  return [...findings];
}

export function auditRepository(root) {
  root = resolve(root);
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root}`, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const findings = [];
  const envFile = path => /(?:^|\/)\.env(?:\.[^/]+)?$/.test(path) && path !== '.env.example';
  for (const path of [...tracked, ...untracked]) {
    if (envFile(path)) findings.push({ scope: 'working-tree', path, type: 'tracked-env-file' });
    try {
      const content = readFileSync(resolve(root, path));
      if (!content.includes(0)) for (const type of secretIndicators(content.toString('utf8'))) findings.push({ scope: 'working-tree', path, type });
    } catch { findings.push({ scope: 'working-tree', path, type: 'unreadable-tracked-file' }); }
  }
  const entries = git('rev-list', '--objects', '--all').trim().split('\n').filter(Boolean);
  const paths = new Map(entries.map(line => { const space = line.indexOf(' '); return [space < 0 ? line : line.slice(0, space), space < 0 ? '' : line.slice(space + 1)]; }));
  const input = [...paths.keys()].join('\n') + '\n';
  const metadata = execFileSync('git', ['-c', `safe.directory=${root}`, 'cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], { cwd: root, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const records = metadata.trim().split('\n').map(line => line.split(' '));
  const selected = records.filter(([, type]) => ['blob', 'commit', 'tag'].includes(type));
  let totalBytes = selected.reduce((sum, row) => sum + Number(row[2]), 0);
  if (!Number.isFinite(totalBytes) || totalBytes > 256 * 1024 * 1024) throw new Error('History is too large for this bounded audit; use a streaming scanner.');
  const batch = execFileSync('git', ['-c', `safe.directory=${root}`, 'cat-file', '--batch'], { cwd: root, input: selected.map(row => row[0]).join('\n') + '\n', maxBuffer: totalBytes + selected.length * 128 + 1024 });
  let offset = 0, textObjects = 0;
  for (const [id, type, size] of selected) {
    offset = batch.indexOf(10, offset) + 1;
    const content = batch.subarray(offset, offset + Number(size)); offset += Number(size) + 1;
    const path = paths.get(id);
    if (type === 'blob' && envFile(path)) findings.push({ scope: 'local-history', path, object: id.slice(0, 12), type: 'tracked-env-file' });
    if (content.includes(0)) continue;
    textObjects++;
    for (const indicator of secretIndicators(content.toString('utf8'))) findings.push({ scope: 'local-history', path: type === 'blob' ? path : type, object: id.slice(0, 12), type: indicator });
  }
  return { trackedFiles: tracked.length, untrackedFiles: untracked.length, reachableObjects: records.length, textObjects, findings,
    limits: 'All locally reachable refs plus non-ignored working files; no fetch, reflog, dangling objects, LFS payloads, ignored production env or proof of absence.' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = auditRepository(resolve(fileURLToPath(new URL('..', import.meta.url))));
    console.log(JSON.stringify(report, null, 2));
    if (report.findings.length) process.exitCode = 1;
  } catch { console.error('Secret audit failed. No matching values were printed.'); process.exitCode = 2; }
}
