import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanupPreflight} from '../scripts/sql-cleanup-preflight.mjs';
const env={SUPABASE_URL:'https://test.invalid',SUPABASE_SECRET_KEY:'fake-local-test'};
test('SQL cleanup gate uses only the read-only readiness RPC, returns flags and fails closed',async()=>{
  const result=await cleanupPreflight(env,{fetcher:async(url,options)=>{
    assert.equal(url.pathname,'/rest/v1/rpc/portal_sql_cleanup_ready');
    assert.equal(options.redirect,'error');
    assert.equal(options.body,'{}');
    return {ok:true,json:async()=>true};
  }});
  assert.deepEqual(result,{sqlCleanupReady:true,walletResetDisabled:true,invoiceExpiryDisabled:true});
  for(const response of [{ok:false},{ok:true,json:async()=>false},{ok:true,json:async()=>({ready:true})}]){
    await assert.rejects(cleanupPreflight(env,{fetcher:async()=>response}));
  }
  await assert.rejects(cleanupPreflight({...env,SUPABASE_URL:'http://test.invalid'}));
  await assert.rejects(cleanupPreflight({...env,SUPABASE_SECRET_KEY:''}));
});
