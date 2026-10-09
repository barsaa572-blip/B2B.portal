// Read-only VPS gate; never returns credentials, raw responses or business data.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseEnvironment } from './vps-security-preflight.mjs';
export async function cleanupPreflight(env,{fetcher=fetch}={}) {
  const base=new URL(env.SUPABASE_URL);
  if(base.protocol!=='https:'||base.username||base.password)throw new Error('Expected HTTPS database URL.');
  const secret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(!secret)throw new Error('Server credential missing.');
  const response=await fetcher(new URL('/rest/v1/rpc/portal_sql_cleanup_ready',base),{
    method:'POST',headers:{apikey:secret,authorization:`Bearer ${secret}`,'content-type':'application/json'},
    body:'{}',signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok||(await response.json())!==true)throw new Error('SQL cleanup is not ready.');
  return {sqlCleanupReady:true,walletResetDisabled:true,invoiceExpiryDisabled:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.platform!=='linux')throw new Error('Run on VPS.');
    console.log(JSON.stringify(await cleanupPreflight(parseEnvironment(readFileSync('/etc/flightb2b/flightb2b.env','utf8')))));
  }catch{console.error('STOP: SQL cleanup preflight failed. Do not run historical SQL or reset wallets.');process.exitCode=1;}
}
