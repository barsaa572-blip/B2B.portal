import test from 'node:test';import assert from 'node:assert/strict';
import {fundingPreflight} from '../scripts/cny-funding-preflight.mjs';
const env={PRICING_MODEL:'cny-funding-v1',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'DO-NOT-OUTPUT',MONGOLBANK_CNY_RATE_API_URL:'http://127.0.0.1:8000/official',GOLOMT_BANK_CNY_RATE_API_URL:'http://127.0.0.1:8000/bank'};
const options={now:()=>Date.parse('2026-10-08T01:00:00Z'),fetcher:async url=>({ok:true,json:async()=>String(url).includes('/rpc/')?true:[{bank_name:String(url).includes('official')?'MongolBank':'GolomtBank',date:'2026-10-07',rates:{cny:{noncash:{buy:536.29,sell:536.29}}}}]})};
test('deployment gate discloses flags/dates only and requires current model + ready schema',async()=>{
 const result=await fundingPreflight(env,options);assert.equal(result.schemaReady,true);assert.equal(result.fundingFeeRefundable,false);assert.equal(result.ticketMarkupPercent,0);assert.doesNotMatch(JSON.stringify(result),/DO-NOT-OUTPUT|supabase|127\.0\.0\.1/);
 await assert.rejects(fundingPreflight({...env,PRICING_MODEL:'legacy'},options));
 await assert.rejects(fundingPreflight({...env,SUPABASE_URL:'http://fixture.supabase.co'},options));
 await assert.rejects(fundingPreflight(env,{...options,fetcher:async()=>({ok:true,json:async()=>false})}));
});
