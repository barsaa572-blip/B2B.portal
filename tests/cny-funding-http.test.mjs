import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
test('actual HTTP CNY funding uses server sell quote, tenant scope and verified admin receipt',async t=>{
  const writes=[],receipts=[],auditSelects=[];let ready=true, approvalFailure=null;
  const profiles={agent:{id:'agent',role:'agent',agency_id:'agency-a',active:true},admin:{id:'admin',role:'platform_admin',agency_id:'agency-a',active:true}};
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ulaanbaatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const provider=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=raw?JSON.parse(raw):{},u=new URL(req.url,'http://localhost');
    const send=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
    if(u.pathname==='/auth/v1/token') {const who=body.email==='admin@example.invalid'?'admin':'agent';return send({access_token:'private-'+who,refresh_token:'private-refresh',expires_in:3600,user:{id:who}});}
    if(u.pathname==='/auth/v1/user')return send({id:req.headers.authorization==='Bearer private-admin'?'admin':'agent'});
    if(u.pathname==='/rest/v1/profiles')return send(Object.values(profiles).filter(p=>u.searchParams.get('id')==='eq.'+p.id));
    if(u.pathname==='/rest/v1/agencies')return send([{id:'agency-a',active:true}]);
    if(['/rest/v1/branches','/rest/v1/wallets','/rest/v1/wallet_transactions'].includes(u.pathname))return send([]);
    if(u.pathname==='/official'||u.pathname==='/bank')return send([{bank_name:u.pathname==='/official'?'MongolBank':'GolomtBank',date:today,rates:{cny:{noncash:{buy:u.pathname==='/official'?536.29:533.9,sell:u.pathname==='/official'?536.29:538}}}}]);
    if(u.pathname==='/rest/v1/rpc/cny_funding_ready')return send(ready);
    if(u.pathname==='/rest/v1/rpc/claim_spring_status_checks')return send([]);
    if(u.pathname==='/rest/v1/rpc/approve_cny_topup'){
      receipts.push(body);
      if (approvalFailure) {res.statusCode=400;return send(approvalFailure);}
      return send({creditedCny:10000});
    }
    if(u.pathname==='/rest/v1/topup_requests'){
      if(req.method==='POST'){writes.push(body);return send([{...body,id:'invoice-1',status:'pending'}]);}
      const rows=[{...writes[0],id:'invoice-1',status:'pending',private_internal:'PRIVATE-METADATA'},
        {id:'legacy-invoice',agency_id:'agency-a',status:'rejected',pricing_model:'legacy',funding_quote:null}];
      const filtered=u.searchParams.has('id')?rows.filter(row=>u.searchParams.get('id')==='eq.'+row.id):rows;
      const select=u.searchParams.get('select');
      return send(select==='*'?filtered:filtered.map(row=>Object.fromEntries(select.split(',').map(key=>[key,row[key]]))));
    }
    if(u.pathname==='/rest/v1/retail_pricing') {
      auditSelects.push(u.searchParams.get('select'));
      assert.equal(u.searchParams.get('limit'),'500');
      assert.equal(u.searchParams.get('order'),'updated_at.desc');
      const includeAgency = u.searchParams.get('select')?.includes('bookings(pnr,agency_id)');
      return send([{booking_id:'refund-booking',action:'refund',reference:'refund-reference',snapshot:{walletCny:750,supplierCny:750,amountMnt:402210,marginCny:0},state:'awaiting_settlement',bookings:{pnr:'REFUND-PNR',...(includeAgency?{agency_id:'agency-a'}:{})}}]);
    }
    if(u.pathname==='/rest/v1/bookings')return send([]);
    res.statusCode=500;return send({error:'Unexpected fixture endpoint'});
  });
  let child, diagnostics = '';
  t.after(async()=>{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}provider.closeAllConnections();await new Promise(r=>provider.close(r));});
  provider.listen(0,'127.0.0.1');await once(provider,'listening');
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const base=`http://127.0.0.1:${provider.address().port}`;
  const env={...process.env,PORT:String(port),APP_ENV:'test',PRICING_MODEL:'cny-funding-v1',AUTH_EMAIL_OTP_REQUIRED:'false',AUTH_PASSWORD_ROTATION_REQUIRED:'false',SUPABASE_URL:base,SUPABASE_SECRET_KEY:'fixture-secret',SUPABASE_PUBLISHABLE_KEY:'fixture-public',MONGOLBANK_CNY_RATE_API_URL:base+'/official',GOLOMT_BANK_CNY_RATE_API_URL:base+'/bank'};
  for(const key of Object.keys(env))if(key.startsWith('SPRING_'))env[key]='';
  child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env,stdio:['ignore','pipe','pipe']});child.stderr.on('data', b => { diagnostics += String(b); });
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture did not start')),10000);child.stdout.on('data',b=>{if(String(b).includes('listening on')){clearTimeout(timer);resolve();}});child.once('exit',c=>{clearTimeout(timer);reject(Error('Fixture exit '+c));});});
  const call=(path,{cookie,body,method=body?'POST':'GET',origin='https://portal.test'}={})=>new Promise((resolve,reject)=>{
    const req=httpRequest(`http://127.0.0.1:${port}${path}`,{method,headers:{host:'portal.test',origin,'content-type':'application/json',...(cookie?{cookie}:{})}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});
    req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();
  });
  const login=async who=>{const r=await call('/api/auth/login',{body:{email:who+'@example.invalid',password:'FixturePassword1!'}});assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/private-/);return r.headers.get('set-cookie').split(';')[0];};
  const agent=await login('agent'),admin=await login('admin');
  const invalidBooking = await call('/api/bookings',{cookie:agent,body:{itinerary:{departureDate:'invalid'},passengers:{travellers:[{lastName:'PRIVATE_PASSENGER_MARKER'}]}}});
  assert.equal(invalidBooking.status,403);
  const bookingError = await invalidBooking.json();
  assert.equal(bookingError.code,'BOOKING_FAILED');
  assert.match(bookingError.diagnosticId,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.doesNotMatch(JSON.stringify(bookingError),/PRIVATE_PASSENGER_MARKER|fixture-secret/);
  await new Promise(resolve=>setImmediate(resolve));
  const bookingLog = diagnostics.split('\n').find(line=>line.startsWith('NEXAHUB_BOOKING_DIAGNOSTIC '));
  assert.ok(bookingLog,'Actual reservation route must emit the support ID diagnostic');
  const bookingRecord = JSON.parse(bookingLog.slice('NEXAHUB_BOOKING_DIAGNOSTIC '.length));
  assert.equal(bookingRecord.id,bookingError.diagnosticId);
  assert.equal(bookingRecord.stage,'passenger_validation');
  assert.equal(bookingRecord.supplierAttempted,false);
  assert.doesNotMatch(diagnostics,/PRIVATE_PASSENGER_MARKER|fixture-secret|private-admin|private-agent/);
  const canonicalBooking = {itinerary:{departureDate:'2027-03-22',flights:[{spring:{segHeadId:1}}]},passengers:{
    contact:{name:'Fixture Agent',email:'fixture@example.invalid',phone:'12345678',areaCode:'976'},
    travellers:[{type:'ADT',firstName:'TEST',lastName:'FIXTURE',gender:'male',documentType:'passport',
      dateOfBirth:'1990-01-01',documentExpiry:'2035-01-01',documentNumber:'FIXTURE',nationality:'Mongolia'}]}};
  // Deliberately disabled supplier in this fixture: canonical browser DTO must
  // pass the real route's strict cleanup and reach the configuration gate only.
  for (const [gender,expectedStage] of [['male','booking_configuration'],['unknown','input_cleanup']]) {
    const body = structuredClone(canonicalBooking); body.passengers.travellers[0].gender=gender;
    const response = await call('/api/bookings',{cookie:agent,body});
    assert.equal(response.status,403);
    const result = await response.json();
    await new Promise(resolve=>setImmediate(resolve));
    const record = diagnostics.split('\n').filter(line=>line.startsWith('NEXAHUB_BOOKING_DIAGNOSTIC '))
      .map(line=>JSON.parse(line.slice('NEXAHUB_BOOKING_DIAGNOSTIC '.length))).find(row=>row.id===result.diagnosticId);
    assert.ok(record); assert.equal(record.stage,expectedStage); assert.equal(record.supplierAttempted,false);
  }
  const quote=await call('/api/topups/quote',{cookie:agent,body:{amountCny:'10000',rateMnt:1,serviceFeeCny:0,agencyId:'foreign'}});
  assert.equal(quote.status,200);const q=await quote.json();assert.equal(q.rateMnt,538);assert.equal(q.totalCny,10359.3);assert.equal(q.principalCny,10000);
  const r=await call('/api/topups',{cookie:agent,body:{amountCny:'10000',totalCny:1,amountMnt:1,agencyId:'foreign',requested_by:'admin',note:'test'}});
  assert.equal(r.status,201);assert.equal(writes.length,1);assert.equal(writes[0].agency_id,'agency-a');assert.equal(writes[0].requested_by,'agent');assert.equal(writes[0].funding_quote.totalCny,10359.3);
  // Use actual overview route and actual PostgREST column projection: do not
  // inject fields into the UI that production SELECT forgot to request.
  assert.equal((await call('/api/admin/overview',{cookie:agent})).status,403);
  const overviewResponse=await call('/api/admin/overview',{cookie:admin});
  assert.equal(overviewResponse.status,200);
  const overviewText=await overviewResponse.text(),overview=JSON.parse(overviewText);
  const invoice=overview.topups.find(row=>row.id==='invoice-1');
  assert.equal(invoice.pricing_model,'cny-funding-v1');
  assert.deepEqual(invoice.funding_quote,writes[0].funding_quote);
  assert.equal(invoice.funding_quote.totalCny,10359.3);
  assert.equal(overview.topups.find(row=>row.id==='legacy-invoice').pricing_model,'legacy');
  assert.equal(overview.topups.find(row=>row.id==='legacy-invoice').funding_quote,null);
  assert.doesNotMatch(overviewText,/PRIVATE-METADATA|fixture-secret/);
  assert.equal((await call('/api/admin/retail-pricing',{cookie:agent})).status,403);
  assert.equal(auditSelects.length,0,'Agent must not query admin settlement data');
  const auditResponse=await call('/api/admin/retail-pricing',{cookie:admin});
  assert.equal(auditResponse.status,200);
  const audit=await auditResponse.json();
  assert.equal(audit.entries[0].bookings.agency_id,'agency-a','Actual admin query must deliver agency owner for the refund UI');
  assert.equal(audit.entries[0].snapshot.walletCny,750);
  assert.equal(audit.entries[0].state,'awaiting_settlement');
  assert.equal(receipts.length,0,'Reading audit must not approve or credit a wallet');
  assert.equal((await call('/api/topups/quote',{body:{amountCny:'10000'}})).status,401);
  assert.equal((await call('/api/topups/quote',{cookie:agent,body:{amountCny:'10000'},origin:'https://foreign.test'})).status,403);
  assert.equal((await call('/api/admin/topups/invoice-1/approve',{cookie:agent,body:{confirmed:true,bankReference:'BANK-1',receivedCny:'10359.30'}})).status,403);
  const missing=await call('/api/admin/topups/invoice-1/approve',{cookie:admin,body:{}});
  assert.equal(missing.status,400);assert.equal((await missing.json()).code,'TOPUP_CONFIRM_REQUIRED');assert.equal(receipts.length,0);
  assert.equal((await call('/api/admin/topups/invoice-1/approve',{cookie:admin,body:{confirmed:true,bankReference:'BANK-1',receivedCny:'10,359.30'}})).status,200);
  assert.deepEqual(receipts[0],{p_topup_id:'invoice-1',p_actor:'admin',p_bank_reference:'BANK-1',p_received_cny:10359.3});
  const approve=()=>call('/api/admin/topups/invoice-1/approve',{cookie:admin,body:{confirmed:true,bankReference:'BANK-1',receivedCny:'10359.30'}});
  for(const [failure,status,code] of [
    [{code:'P0001',message:'Receipt differs from the invoice; reconcile before credit'},409,'TOPUP_AMOUNT_MISMATCH'],
    [{code:'23505',message:'PRIVATE BANK REFERENCE',details:'PRIVATE TOKEN'},409,'TOPUP_RECEIPT_DUPLICATE'],
    [{code:'P0001',message:'Invoice/agency is unavailable or has an unresolved payment'},409,'TOPUP_UNAVAILABLE'],
    [{code:'PGRST202',message:'PRIVATE SCHEMA'},503,'TOPUP_SCHEMA_UNAVAILABLE'],
    [{code:'P0001',message:'PRIVATE TOKEN'},503,'TOPUP_SERVICE_UNAVAILABLE']
  ]) {
    approvalFailure=failure;const result=await approve();assert.equal(result.status,status);
    const text=await result.text();assert.equal(JSON.parse(text).code,code);assert.doesNotMatch(text,/PRIVATE|fixture-secret/);
  }
  approvalFailure=null;
  ready=false;assert.equal((await call('/api/topups',{cookie:agent,body:{amountCny:'10000'}})).status,403);assert.equal(writes.length,1);
});
