// Disposable, network-isolated PostgreSQL only. Never reads a database URL/env file.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildSchema} from '../deploy/staging/build-schema.mjs';
import {fundingQuote} from '../backend/cny-funding.mjs';
import {retailAmount,publicRetail} from '../backend/retail-pricing.mjs';

export const IMAGE='postgres:16-bookworm';
export function containerArguments(name,label) {
  if (!/^nexahub-cny-test-[a-f0-9]{16}$/.test(name) || !/^[a-f0-9]{32}$/.test(label)) throw new Error('Invalid isolated test identity.');
  return ['run','--pull=never','--rm','--detach','--name',name,'--label',`nexahub.cny-test=${label}`,
    '--network','none','--memory','512m','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw',
    '--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=nexahub_cny_test',IMAGE];
}
export function command(args,{input='',env=process.env,timeout=30000}={}) {
  return new Promise(resolve=>{
    let out='',err='',settled=false;
    const child=spawn('docker',args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const finish=code=>{if(settled)return;settled=true;clearTimeout(timer);resolve({code,out,err});};
    const timer=setTimeout(()=>{child.kill();err+=' Command timed out.';finish(-1);},timeout);
    child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
    child.on('error',()=>{err='Docker is unavailable. Install/start Docker separately; no test ran.';finish(-1);});
    child.on('close',finish);child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function main() {
  const info=await command(['info','--format','{{.ServerVersion}}']);
  if(info.code!==0)throw new Error('STOP: Docker is unavailable. No financial test or production change ran.');
  const image=await command(['image','inspect',IMAGE,'--format','{{.Id}}']);
  if(image.code!==0)throw new Error(`STOP: pull the isolated test image first: docker pull ${IMAGE}`);
  const name=`nexahub-cny-test-${randomBytes(8).toString('hex')}`,label=randomBytes(16).toString('hex');
  const created=await command(containerArguments(name,label),{env:{...process.env,POSTGRES_PASSWORD:randomBytes(32).toString('hex')}});
  if(created.code!==0)throw new Error('STOP: could not start isolated PostgreSQL. No production connection was attempted.');
  const id=created.out.trim();
  assert.match(id,/^[a-f0-9]{64}$/);
  const raw=(sql,application='observer')=>command(['exec','--interactive',id,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','nexahub_cny_test'],{
    input:`set application_name=${literal(application)}; set statement_timeout='20s'; set lock_timeout='15s';\n${sql}`,timeout:25000});
  const sql=async(text,application)=>{const r=await raw(text,application);if(r.code!==0)throw new Error(`Isolated test SQL failed: ${r.err}`);return r.out.trim();};
  const observe=async(name,event)=>{
    const until=Date.now()+6500;
    while(Date.now()<until){
      const r=await raw(`select count(*) from pg_stat_activity where application_name=${literal(name)} and ${event};`);
      if(r.code===0 && r.out.trim()==='1')return;
      await pause(75);
    }
    throw new Error(`STOP: actual ${event} was not observed for ${name}; concurrency is NOT accepted.`);
  };
  const race=async(title,holderSql,contenderSql,{failure}={})=>{
    const prefix=randomBytes(4).toString('hex'),holder=`holder-${prefix}`,contender=`contender-${prefix}`;
    // Promises return exit codes so a failing contender cannot become unhandled.
    const first=raw(`begin; ${holderSql}; select pg_sleep(8); commit;`,holder);
    await observe(holder,"wait_event='PgSleep'");
    const second=raw(contenderSql,contender);
    await observe(contender,"wait_event_type='Lock'");
    const [a,b]=await Promise.all([first,second]);
    assert.equal(a.code,0,a.err);
    if(failure){assert.notEqual(b.code,0,'Expected conflicting operation to fail');assert.match(b.err,failure);}
    else assert.equal(b.code,0,b.err);
    console.log(`PASS: independent PostgreSQL sessions blocked and serialized: ${title}`);
  };
  const previous=process.env.PRICING_MODEL;
  try {
    let ready=false;
    for(let i=0;i<40;i++) {
      // The image's temporary init server is socket-only: wait for final TCP readiness.
      const probe=await command(['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres','-d','nexahub_cny_test']);
      if(probe.code===0 && (await raw('select 1')).code===0){ready=true;break;}
      await pause(250);
    }
    assert.equal(ready,true,'Isolated PostgreSQL did not become ready');
    await sql(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
    await sql(buildSchema());
    await sql(readFileSync(new URL('../supabase/cny-funding.sql',import.meta.url),'utf8'));
    const actor='00000000-0000-0000-0000-000000000001',admin='00000000-0000-0000-0000-000000000002';
    const agency='00000000-0000-0000-0000-000000000003',other='00000000-0000-0000-0000-000000000004',otherActor='00000000-0000-0000-0000-000000000005';
    await sql(`insert into auth.users(id) values('${actor}'),('${admin}'),('${otherActor}');
      insert into agencies(id,name) values('${agency}','Isolated A'),('${other}','Isolated B');
      insert into profiles(id,agency_id,role,full_name) values('${actor}','${agency}','agent','Agent A'),('${otherActor}','${other}','agent','Agent B'),('${admin}',null,'platform_admin','Admin');
      insert into wallets(agency_id,balance_cny) values('${agency}',0),('${other}',0);
      select activate_cny_funding();`);
    assert.equal(await sql('select cny_funding_ready()'),'t');
    const today=await sql("select (now() at time zone 'Asia/Ulaanbaatar')::date::text");
    const insert=async(number,principal,agencyId=agency,who=actor)=>{
      const q=fundingQuote(principal,{nonCashSellMnt:538,fundingRateDate:today});
      const invoiceId=await sql(`insert into topup_requests(invoice_number,agency_id,requested_by,amount_cny,amount_mnt,service_fee_mnt,correspondent_fee_mnt,bank_transfer_fee_mnt,total_mnt,effective_cny_mnt_rate,rate_date,pricing_model,funding_quote,payment_reference)
        values(${literal(number)},'${agencyId}','${who}',${q.principalCny},${q.rows[0].amountMnt},${q.rows[1].amountMnt},${q.rows[2].amountMnt},${q.rows[3].amountMnt},${q.totalMnt},${q.rateMnt},${literal(q.rateDate)},'cny-funding-v1',${literal(JSON.stringify(q))}::jsonb,${literal(number)}) returning id;`);
      return {id:invoiceId,quote:q};
    };
    const approve=(invoice,ref)=>`select approve_cny_topup('${invoice.id}','${admin}',${literal(ref)},${invoice.quote.totalCny})`;
    const balance=agencyId=>sql(`select balance_cny from wallets where agency_id='${agencyId}'`);
    const count=table=>sql(`select count(*) from ${table}`);

    const one=await insert('CONCURRENT-1',100);
    await race('same invoice credited once',approve(one,'BANK-SAME'),approve(one,'bank-same'));
    assert.equal(Number(await balance(agency)),100);assert.equal(await count('cny_funding_receipts'),'1');assert.equal(await count('wallet_transactions'),'1');

    const two=await insert('CONCURRENT-2',200),three=await insert('CONCURRENT-3',200,other,otherActor);
    await race('one bank reference cannot fund two agencies',approve(two,'BANK-UNIQUE'),approve(three,'bank-unique'),{failure:/duplicate key|unique constraint/i});
    assert.equal(Number(await balance(agency)),300);assert.equal(Number(await balance(other)),0);
    assert.equal(await sql(`select status from topup_requests where id='${three.id}'`),'pending');
    assert.equal(await count('cny_funding_receipts'),'2');assert.equal(await count('wallet_transactions'),'2');

    process.env.PRICING_MODEL='cny-funding-v1';
    const booking=await sql(`insert into bookings(pnr,agency_id,created_by,status,total_cny,itinerary,passengers) values('RACEREF','${other}','${otherActor}','Ticketed',2000,'{}','{}') returning id;`);
    const refund=retailAmount(1800,536.29,'refund'),pub=publicRetail(refund);
    await sql(`select store_retail_price('RACEREF','refund','REF-1','${otherActor}',${literal(JSON.stringify(refund))}::jsonb,${literal(JSON.stringify(pub))}::jsonb);`);
    const operation=await sql(`select begin_financial_operation('${otherActor}','RACEREF','refund','REF-1',0,${literal(JSON.stringify(pub))}::jsonb);`);
    await sql(`select finish_financial_operation('${operation}','${otherActor}','completed');`);
    const settle=`select settle_retail_refund('${booking}','REF-1','${admin}',1800,'REF-BANK-1')`;
    await race('net-only refund credited once',settle,settle);
    assert.equal(Number(await balance(other)),1800);assert.equal(await count('wallet_transactions'),'3');

    await sql(`insert into bookings(pnr,agency_id,created_by,status,total_cny,itinerary,passengers) values('RACEISS','${agency}','${actor}','Reserved',300,'{}','{}');`);
    const sale=retailAmount(300,536.29),salePub=publicRetail(sale);
    await sql(`select store_retail_price('RACEISS','issue','RACEISS','${actor}',${literal(JSON.stringify(sale))}::jsonb,${literal(JSON.stringify(salePub))}::jsonb);`);
    const four=await insert('CONCURRENT-4',100);
    const reserve=`select begin_financial_operation('${actor}','RACEISS','issue','RACEISS',300,${literal(JSON.stringify(salePub))}::jsonb)`;
    await race('funding waits then refuses an unresolved supplier payment',reserve,approve(four,'BANK-PENDING'),{failure:/unresolved payment/i});
    assert.equal(Number(await balance(agency)),300);assert.equal(await count('wallet_transactions'),'3');assert.equal(await count('cny_funding_receipts'),'2');
    assert.equal(await sql(`select status from topup_requests where id='${four.id}'`),'pending');
    console.log('PASS: CNY funding concurrency accepted on real isolated PostgreSQL. No bank, Spring or production calls.');
  } finally {
    if(previous===undefined)delete process.env.PRICING_MODEL;else process.env.PRICING_MODEL=previous;
    // Only stop the exact random container created here, after verifying ownership.
    const identity=await command(['inspect','--format','{{ index .Config.Labels "nexahub.cny-test" }}',id]);
    if(identity.code===0&&identity.out.trim()===label){
      const stopped=await command(['stop','--time','2',id]);
      if(stopped.code!==0)throw new Error(`STOP: test container cleanup failed. Inspect ${name}; no production object was touched.`);
      console.log('Removed only this run\'s disposable test container; temporary test data was discarded.');
    } else throw new Error(`STOP: test container identity could not be verified. No cleanup attempted; inspect ${name}.`);
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error.message);process.exitCode=1;});
