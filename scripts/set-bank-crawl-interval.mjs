// Scoped VPS maintenance: no env reads, crawler imports, API calls or database writes.
import {readFileSync, writeFileSync, realpathSync, lstatSync, mkdtempSync, chmodSync, chownSync, renameSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function threeHourSource(source) {
  if (typeof source !== 'string' || source.length > 200000) throw new Error('Unexpected scheduler file.');
  const registrations = source.match(/^[\t ]*schedule\.every\(/gm) || [];
  if (registrations.length !== 1) throw new Error('Expected exactly one schedule.every registration.');
  const old = /^[\t ]*schedule\.every\(\)\.day\.at\(run_at\)\.do\(/gm;
  const current = /^[\t ]*schedule\.every\(3\)\.hours\.do\(/gm;
  if ((source.match(current) || []).length === 1) return {source, changed:false};
  if ((source.match(old) || []).length !== 1) throw new Error('Scheduler differs from the inspected daily job.');
  return {source:source.replace(old, prefix=>prefix.replace('schedule.every().day.at(run_at)', 'schedule.every(3).hours')), changed:true};
}

export const pythonScheduleCheck = `import ast,sys
t=ast.parse(sys.stdin.read())
matches=[]
for n in ast.walk(t):
 if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='do':
  chain=n.func.value
  if isinstance(chain,ast.Attribute) and chain.attr=='hours':
   call=chain.value
   if isinstance(call,ast.Call) and isinstance(call.func,ast.Attribute) and call.func.attr=='every' and isinstance(call.func.value,ast.Name) and call.func.value.id=='schedule':
    if len(call.args)==1 and isinstance(call.args[0],ast.Constant) and call.args[0].value==3 and not call.keywords: matches.append(n)
assert len(matches)==1, 'Expected one three-hour job'
loops=[]
def time_call(n, owner, name):
 return isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and isinstance(n.func.value,ast.Name) and n.func.value.id==owner and n.func.attr==name
for n in ast.walk(t):
 if isinstance(n,ast.While) and any(time_call(c,'schedule','run_pending') for c in ast.walk(n)):
  sleeps=[c for c in ast.walk(n) if time_call(c,'time','sleep')]
  assert len(sleeps)==1 and len(sleeps[0].args)==1, 'Unknown scheduler polling loop'
  delay=sleeps[0].args[0]
  assert isinstance(delay,ast.Constant) and type(delay.value) in (int,float) and 0<delay.value<=60, 'Scheduler must poll within 60 seconds'
  loops.append(n)
assert len(loops)==1, 'Expected one run_pending polling loop'
`;

export function installThreeHours() {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('Run only on VPS as root.');
  const target='/opt/mongolbank-rates/scripts/cron.py';
  if (realpathSync(target) !== target || !lstatSync(target).isFile()) throw new Error('Unexpected scheduler path or symlink.');
  const before=readFileSync(target), stat=lstatSync(target), edited=threeHourSource(before.toString('utf8'));
  if (!Buffer.from(before.toString('utf8')).equals(before)) throw new Error('Unexpected source encoding. No file was changed.');
  const check=spawnSync('python3',['-c',pythonScheduleCheck],{input:edited.source,encoding:'utf8',timeout:10000});
  if (check.error || check.status !== 0) throw new Error('Python syntax/three-hour registration check failed. No file was changed.');
  if (!edited.changed) {console.log('READY: Source already uses one three-hour job.');return;}
  // Backup outside Docker build context. No permissive umask survives this helper.
  const backupDir=mkdtempSync('/var/backups/nexahub-fx-3h-');chmodSync(backupDir,0o700);
  const backup=join(backupDir,'cron.py.before');writeFileSync(backup,before,{mode:0o600,flag:'wx'});
  const draft=target+'.three-hour-'+randomUUID();
  writeFileSync(draft,edited.source,{mode:0o600,flag:'wx'});
  chownSync(draft,stat.uid,stat.gid);chmodSync(draft,stat.mode & 0o777);
  if (!readFileSync(target).equals(before)) throw new Error('Scheduler changed concurrently. Backup and draft preserved; do not overwrite.');
  renameSync(draft,target);
  if (readFileSync(target,'utf8') !== edited.source) throw new Error('Scheduler verification failed. Restore the private backup before rollout.');
  console.log('Private backup: '+backup);
  console.log('Scheduler SHA256: '+createHash('sha256').update(edited.source).digest('hex'));
  console.log('READY: Source is every 3 hours; crawler callback/arguments and file owner/mode preserved.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {installThreeHours();}
  catch (error) {console.error('STOP: '+error.message);process.exitCode=1;}
}
