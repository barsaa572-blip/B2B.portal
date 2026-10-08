// Read-only deployment gate. Never prints env/credentials/provider errors.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {parseEnvironment} from './vps-security-preflight.mjs';
import {createModelTwoFxService} from '../backend/pricing-model-two-fx.mjs';
export async function fundingPreflight(env,{fetcher=fetch,now=Date.now}={}) {
  if(env.PRICING_MODEL!=='cny-funding-v1')throw new Error('Pricing model is not enabled.');
  const base=new URL(env.SUPABASE_URL);
  if(base.protocol!=='https:'||base.username||base.password)throw new Error('Expected production HTTPS database URL.');
  const secret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(!secret)throw new Error('Server credential is missing.');
  const response=await fetcher(new URL('/rest/v1/rpc/cny_funding_ready',base),{method:'POST',headers:{apikey:secret,authorization:`Bearer ${secret}`,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok||(await response.json())!==true)throw new Error('CNY funding SQL is not active/secure.');
  const rate=await createModelTwoFxService({fetcher,now,officialUrl:env.MONGOLBANK_CNY_RATE_API_URL||undefined,fundingUrl:env.GOLOMT_BANK_CNY_RATE_API_URL||undefined})();
  return {pricingModel:rate.pricingModel,schemaReady:true,officialRateReady:true,fundingSellReady:true,officialDate:rate.rateDate,fundingDate:rate.fundingRateDate,invoiceCurrency:'CNY',mntDisplayStep:10,fundingFeePercent:3,fundingFeeRefundable:false,ticketMarkupPercent:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.platform!=='linux')throw new Error('Run on VPS.');
    console.log(JSON.stringify(await fundingPreflight(parseEnvironment(readFileSync('/etc/flightb2b/flightb2b.env','utf8')))));
  }catch{console.error('STOP: CNY funding preflight failed. Inspect model, SQL readiness and dated public rates locally. Do not paste secrets.');process.exitCode=1;}
}
