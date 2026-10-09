import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {threeHourSource, pythonScheduleCheck} from '../scripts/set-bank-crawl-interval.mjs';

test('three-hour crawler changes only schedule chain, preserves callback/args, comments and CRLF',()=>{
  const source='import schedule\r\nrun_at = "09:00"\r\nif True:\r\n    schedule.every().day.at(run_at).do(crawl_all, retries=2) # keep\r\n';
  const result=threeHourSource(source);
  assert.equal(result.changed,true);
  assert.equal(result.source,source.replace('schedule.every().day.at(run_at)','schedule.every(3).hours'));
});
test('three-hour scheduler update is idempotent',()=>{
  const source='    schedule.every(3).hours.do(crawl_all)\n';
  assert.deepEqual(threeHourSource(source),{source,changed:false});
});
test('unknown/multiple scheduler registrations fail closed',()=>{
  for (const source of ['', 'schedule.every().day.at("09:00").do(crawl)\n',
    'schedule.every().day.at(run_at).do(crawl)\nschedule.every().hours.do(other)\n',
    'schedule.every(2).hours.do(crawl)\n', '# schedule.every().day.at(run_at).do(crawl)\n']) assert.throws(()=>threeHourSource(source));
});
test('VPS updater parses without running crawler, makes private backup and preserves source permissions',()=>{
  const script=readFileSync(new URL('../scripts/set-bank-crawl-interval.mjs',import.meta.url),'utf8');
  assert.match(script,/ast\.parse/);assert.match(script,/check\.status !== 0/);
  assert.match(script,/\/var\/backups\/nexahub-fx-3h-/);assert.match(script,/chmodSync\(backupDir,0o700\)/);
  assert.match(script,/chownSync\(draft,stat\.uid,stat\.gid\)/);assert.match(script,/stat\.mode & 0o777/);
  assert.doesNotMatch(script,/fetch\(|exec\(compile|\.env['"]|SUPABASE|SPRING/);
});
test('FX rollout only replaces cron after offline image verification, keeps API/database IDs',()=>{
  const script=readFileSync(new URL('../scripts/deploy-bank-crawl-interval.sh',import.meta.url),'utf8');
  assert.match(script,/build cron/);assert.match(script,/up -d --no-deps --no-build --force-recreate cron/);
  assert.match(script,/--network none --read-only/);assert.match(script,/ast\.parse\(data\)/);
  assert.ok(script.indexOf('docker run --rm') < script.indexOf('up -d --no-deps'));
  assert.match(script,/TASK_FX_API_ID/);assert.match(script,/TASK_FX_DB_ID/);
  assert.match(script,/before-3h-/);assert.match(script,/\.RestartCount/);
  assert.doesNotMatch(script,/compose.*\bdown\b|docker.*\bprune\b|\.Config\.Env|\/api\/admin\/crawl|restart flightb2b/);
});
test('actual Python AST preflight accepts one three-hour/polling job without executing any source',t=>{
  const python=process.env.PYTHON_FOR_FX_TEST || (process.platform==='linux'?'python3':null);
  if(!python)return t.skip('Set PYTHON_FOR_FX_TEST to verify AST with an installed Python.');
  const source='raise RuntimeError("Never execute crawler source")\nimport schedule,time\ndef main():\n    schedule.every(3).hours.do(crawl_all)\n    while True:\n        schedule.run_pending()\n        time.sleep(60)\n';
  const check=input=>spawnSync(python,['-c',pythonScheduleCheck],{input,encoding:'utf8',timeout:10000});
  const valid=check(source);assert.ifError(valid.error);assert.equal(valid.status,0,valid.stderr);
  for(const invalid of [source.replace('time.sleep(60)','time.sleep(86400)'),source.replace('time.sleep(60)','time.sleep(delay)'),source.replace('schedule.run_pending()','pass'),source.replace('every(3)','every(2)'),source+'schedule.every(3).hours.do(other)\n']) {
    assert.notEqual(check(invalid).status,0);
  }
});
