// Optional local browser test; no live API requests or invoice creation.
const {chromium}=require(process.argv[2]||'playwright');
const {createServer}=require('node:http');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const {invoiceHtml,invoicePdf}=await import('../backend/topup-invoice.mjs');
 const {securityHeaders}=await import('../backend/request-security.mjs');
 const sample={id:'local',invoice_number:'INV-LOCAL',created_at:'2026-09-30T04:00:00Z',status:'pending',agencyName:'ЖИШЭЭ АГЕНТ',agencyRegistrationNumber:'0000000',amount_mnt:1000000,amount_cny:1858.39,service_fee_mnt:30000,correspondent_fee_mnt:26905,bank_transfer_fee_mnt:5000,total_mnt:1061905};
 const unsigned={stampPath:'',signaturePath:'',directorName:''};
 const html=await invoiceHtml(sample,unsigned),pdf=await invoicePdf(sample,unsigned);
 const server=createServer((req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
  if(!/^[a-z0-9.-]+$/i.test(file)){res.writeHead(404);return res.end();}
  try{for(const [key,value]of Object.entries(securityHeaders))res.setHeader(key,value);res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(readFileSync(path.join(root,file)));}
  catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({headless:true,channel:process.env.FARE_TEST_BROWSER_CHANNEL||'msedge'});
  const page=await browser.newPage({viewport:{width:1280,height:1000},acceptDownloads:true});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')console.error(message.text());});
  const origin=`http://127.0.0.1:${server.address().port}`;
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(route.request().method()!=='GET')return route.fulfill({status:403,body:'{"error":"Test writes disabled"}'});
   if(url.pathname==='/api/office/users')return route.fulfill({contentType:'application/json',body:JSON.stringify({profiles:[],branches:[]})});
   if(url.pathname.startsWith('/api/invoices/'))return route.fulfill({contentType:url.searchParams.get('format')==='pdf'?'application/pdf':'text/html',body:url.searchParams.get('format')==='pdf'?pdf:html});
   const data=url.pathname==='/api/fx/cny-mnt'?{effectiveRateMnt:538.1,nonCashSellMnt:538.1}:url.pathname==='/api/topups'?[sample]:url.pathname==='/api/wallet'?{wallet:{balance_cny:0},transactions:[]}:[];
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.addInitScript(()=>sessionStorage.setItem('flightb2b-session',JSON.stringify({accessToken:'fake-local',expiresAt:Date.now()+3600000,profile:{id:'local',full_name:'Local Manager',role:'office_manager',agency_id:'local',active:true}})));
  await page.goto(origin);await page.evaluate(()=>showView('wallet'));
  await page.locator('#wallet [data-open-topup]').click();await page.locator('#topup-amount').fill('1000000');
  assert.match(await page.locator('#topup-rate-preview').innerText(),/Wallet credit: ¥ 1,858.3\s/);
  assert.match(await page.locator('#topup-rate-preview').innerText(),/Банкны шимтгэл: ₮ 5,000/);
  assert.doesNotMatch(await page.locator('#topup-modal').innerText(),/A pending MNT|Голомт Банкны/);
  if(process.argv[3])await page.screenshot({path:process.argv[3]});
  await page.locator('#topup-modal .close').click();
  await page.locator('.view-invoice').click();
  await page.frameLocator('#invoice-viewer iframe').locator('.sheet').waitFor();
  assert.match(await page.frameLocator('#invoice-viewer iframe').locator('.bank').innerText(),/MN240015001605336658/);
  await page.locator('#invoice-viewer .close').click();
  const downloaded=page.waitForEvent('download');await page.locator('.download-invoice').click();const download=await downloaded;
  assert.equal(download.suggestedFilename(),'INV-LOCAL.pdf');
  const bytes=readFileSync(await download.path());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  assert.deepEqual(errors,[]);
  console.log('PASS: one-decimal top-up preview, removed copy, invoice iframe under production CSP, correct bank account and real PDF download.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
