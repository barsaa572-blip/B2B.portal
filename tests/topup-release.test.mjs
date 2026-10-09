import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../scripts/'+name,import.meta.url),'utf8');
import {releaseFiles} from '../scripts/publish-topup-ui.mjs';

test('publication scopes files, gates on real browser tests and verifies remote commit',()=>{
  const source=read('publish-topup-ui.ps1');
  for(const file of ['money-display.css','night-theme.css','backend/cny-approval.mjs','tests/money-typography.test.mjs','scripts/deploy-topup-ui.sh'])assert.ok(source.includes("'"+file+"'"));
  assert.doesNotMatch(source,/git add \.|Invoke-ReleaseGit add \./);
  assert.ok(source.indexOf('Browser acceptance failed')<source.indexOf('Invoke-ReleaseGit add --'));
  assert.match(source,/ls-remote origin refs\/heads\/main/);
  assert.match(source,/Unrelated staged changes/);
  assert.doesNotMatch(source,/'backend\/pricing-model-two\.mjs'|'tests\/pricing-model-two\.test\.mjs'|'afe-html\.js'/);
  const nodeSource=read('publish-topup-ui.mjs');
  assert.ok(nodeSource.indexOf('Browser acceptance failed')<nodeSource.indexOf("git('add', '--', ...releaseFiles)"));
  assert.match(nodeSource,/shell:false/);
  assert.match(nodeSource,/gitText\('ls-remote','origin','refs\/heads\/main'\)/);
  assert.match(nodeSource,/Unrelated staged changes/);
  assert.doesNotMatch(nodeSource,/ExecutionPolicy|Invoke-Expression|powershell\.exe/i);
  assert.ok(releaseFiles.includes('scripts/publish-topup-ui.mjs'));
  assert.ok(releaseFiles.every(file=>source.includes("'"+file+"'")),'Both publishers must stage the same explicit release files');
  assert.ok(!releaseFiles.some(file=>file.startsWith('.env')||file==='backend/pricing-model-two.mjs'||file==='tests/pricing-model-two.test.mjs'||file==='afe-html.js'));
});

test('code-only rollout backs up before stop, restores umask and checks service user and health',()=>{
  const source=read('deploy-topup-ui.sh');
  assert.ok(source.indexOf('tar -tzf')<source.indexOf('systemctl stop flightb2b'));
  assert.ok(source.indexOf('umask 022')<source.indexOf('task_git merge --ff-only'));
  assert.ok(source.indexOf('service-user runtime imports')<source.indexOf('systemctl start flightb2b'));
  assert.match(source,/status --porcelain --untracked-files=no/);
  assert.match(source,/task_git diff --quiet[^\n]*package\.json package-lock\.json supabase \.env\.example/);
  assert.match(source,/127\.0\.0\.1:4173\/api\/health/);
  assert.match(source,/merge-base --is-ancestor/);
  assert.doesNotMatch(source,/reset --hard|chmod -R|npm ci|docker compose|activate_cny_funding|psql|export .*SECRET/);
  assert.equal((source.match(/cny-funding-preflight\.mjs/g)||[]).length,2);
});
