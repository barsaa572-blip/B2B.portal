// Run from ordinary PowerShell with Node; no PowerShell policy change required.
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
export const releaseFiles=Object.freeze([
  'admin.js', 'admin.css', 'app.js', 'backend/supabase-client.mjs', 'backend/cny-approval.mjs',
  'index.html', 'money-display.js', 'money-display.css', 'night-theme.css', 'server.mjs', 'styles.css',
  'scripts/check-cny-currency-browser.cjs', 'scripts/publish-topup-ui.ps1', 'scripts/publish-topup-ui.mjs', 'scripts/deploy-topup-ui.sh',
  'scripts/set-bank-crawl-interval.mjs', 'scripts/deploy-bank-crawl-interval.sh',
  'tests/cny-approval.test.mjs', 'tests/cny-funding-http.test.mjs', 'tests/cny-funding.test.mjs',
  'tests/money-display-dom.test.cjs', 'tests/money-typography.test.mjs', 'tests/pricing-model-two-fx.test.mjs',
  'tests/support/cny-ui-server.cjs', 'tests/bank-crawl-interval.test.mjs', 'tests/topup-release.test.mjs',
  'CODEX_HANDOVER.md', 'docs/cny-funding-release.md', 'docs/work-roadmap.md', 'docs/bank-crawl-three-hour-release.md'
]);

function run(command,args,{capture=false,accept=[0],env=process.env}={}) {
  const result=spawnSync(command,args,{cwd:root,env,shell:false,encoding:'utf8',stdio:['inherit',capture?'pipe':'inherit','inherit']});
  if(result.error || !accept.includes(result.status))throw new Error('Command failed. No further publication/deployment.');
  return {status:result.status,text:(result.stdout||'').trim()};
}
const git=(...args)=>run('git',['-c',`safe.directory=${root}`,...args]);
const gitText=(...args)=>run('git',['-c',`safe.directory=${root}`,...args],{capture:true}).text;
const lines=text=>text.split(/\r?\n/).filter(Boolean);

function publish() {
  if(process.platform!=='win32')throw new Error('Run this publisher on Windows, not the VPS.');
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node 22 or newer required.');
  if(gitText('branch','--show-current')!=='main')throw new Error('main branch required.');
  const remote=gitText('remote','get-url','origin');
  if(!['https://github.com/barsaa572-blip/B2B.portal.git','git@github.com:barsaa572-blip/B2B.portal.git'].includes(remote))throw new Error('Unexpected origin.');
  if(lines(gitText('diff','--cached','--name-only')).some(file=>!releaseFiles.includes(file)))throw new Error('Unrelated staged changes; preserve and review them first.');
  const bundledNode=path.join(root,'tmp','security','node24','node.exe');
  const node=existsSync(bundledNode)?bundledNode:process.execPath;
  run(node,['--check','server.mjs']);
  const tests=[...new Set([...lines(gitText('ls-files','--','tests/*.test.*')),
    'tests/cny-approval.test.mjs','tests/money-typography.test.mjs','tests/bank-crawl-interval.test.mjs','tests/topup-release.test.mjs'])].sort();
  const python='C:/Users/barsa/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
  const env={...process.env,...(existsSync(python)?{PYTHON_FOR_FX_TEST:python}:{})};
  run(node,['--test',...tests],{env});
  // Browser acceptance failed => run() throws BEFORE staging or any Git write.
  run(node,['scripts/check-cny-currency-browser.cjs','C:/Users/barsa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright']);
  git('diff','--check');
  git('add', '--', ...releaseFiles);
  git('diff','--cached','--check');
  const changed=run('git',['-c',`safe.directory=${root}`,'diff','--cached','--quiet'],{accept:[0,1]}).status===1;
  if(changed)git('commit','-m','Clarify top-up totals and approvals; restore clear currency prices');
  git('push','origin','main');
  const commit=gitText('rev-parse','HEAD');
  if(gitText('ls-remote','origin','refs/heads/main').split(/\s+/)[0]!==commit)throw new Error('Remote revision differs. Do not deploy.');
  console.log(`Commit: ${commit}\nREADY: Git push verified. Run the VPS block next.`);
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {publish();}catch(error){console.error('STOP: '+error.message);process.exitCode=1;}
}
