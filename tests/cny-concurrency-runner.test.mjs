import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {containerArguments,IMAGE} from '../scripts/check-cny-concurrency.mjs';

test('real concurrency runner uses only an owned temporary network-isolated PostgreSQL',()=>{
  const args=containerArguments('nexahub-cny-test-0123456789abcdef','0123456789abcdef0123456789abcdef');
  assert.equal(args[args.indexOf('--network')+1],'none');
  assert.ok(args.includes('--rm'));assert.ok(args.includes('--pull=never'));
  assert.ok(args.includes('--tmpfs'));assert.equal(args.at(-1),IMAGE);
  for(const option of ['--publish','-p','--volume','-v','--mount','--privileged'])assert.ok(!args.includes(option));
  assert.throws(()=>containerArguments('flightb2b','abc'),/identity/);
  const source=readFileSync(new URL('../scripts/check-cny-concurrency.mjs',import.meta.url),'utf8');
  assert.match(source,/wait_event_type='Lock'/);assert.match(source,/wait_event='PgSleep'/);
  assert.match(source,/identity.out.trim\(\)===label/);
  assert.doesNotMatch(source,/DATABASE_URL|SUPABASE_URL|\.env['"]|docker.*prune/);
});
