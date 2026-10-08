// Actual portal UI with every request intercepted; no external financial writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.argv[2] ? path.resolve(process.argv[2]) : 'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const {fundingQuote}=await import('../backend/cny-funding.mjs');
  const quote=fundingQuote(10000,{nonCashSellMnt:538,fundingRateDate:'2026-10-08'});
  const rate={pricingModel:'cny-funding-v1',effectiveRateMnt:536.29,nonCashSellMnt:538,fundingRateDate:'2026-10-08'};
  const profile={id:'mock',agency_id:'agency',role:'platform_admin',full_name:'Mock Admin'};
  const invoice={id:'invoice',invoice_number:'INV-TEST',agency_id:'agency',status:'pending',pricing_model:quote.model,funding_quote:quote,amount_cny:10000,amount_mnt:5380000,total_mnt:quote.totalMnt,created_at:'2026-10-08T01:00:00Z'};
  const browser=await chromium.launchPersistentContext(path.join(root,'tmp','cny-browser-profile'),{headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    for(const width of [1280,390]){
      const page=await browser.newPage(),errors=[],calls=[];
      await page.setViewportSize({width,height:900});
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(({profile})=>sessionStorage.setItem('flightb2b-session',JSON.stringify({profile,accessToken:'cookie',refreshToken:'cookie',expiresAt:Date.now()+3600000,idleExpiresAt:Date.now()+1200000,sessionExpiresAt:Date.now()+43200000})),{profile});
      await page.route('**/*',route=>{
        const req=route.request(),u=new URL(req.url()),reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
        if(u.pathname.startsWith('/api/')){
          calls.push({path:u.pathname,method:req.method(),body:req.postData()});
          if(u.pathname==='/api/fx/cny-mnt')return reply(rate);
          if(u.pathname==='/api/auth/session')return reply({idleExpiresAt:Date.now()+1200000,sessionExpiresAt:Date.now()+43200000});
          if(u.pathname==='/api/wallet')return reply({wallet:{balance_cny:10000},rate,transactions:[{id:'credit',amount_cny:10000,created_at:invoice.created_at,entry_type:'credit',reason:'Top-up'}]});
          if(u.pathname==='/api/bookings/dashboard')return reply({salesCny:2000,issuedBookings:1,pendingTopupMnt:quote.totalMnt,pendingTopupRequests:1,month:'2026-10',effectiveRateMnt:536.29});
          if(u.pathname==='/api/admin/overview')return reply({agencies:[{id:'agency',name:'Mock Agency',active:true}],wallets:[{agency_id:'agency',balance_cny:10000}],profiles:[profile],branches:[],topups:[invoice]});
          if(u.pathname==='/api/topups/quote')return reply(quote);
          if(u.pathname==='/api/topups')return reply([invoice]);
          if(u.pathname==='/api/bookings'||u.pathname==='/api/locations'||u.pathname==='/api/office/users')return reply([]);
          return reply({});
        }
        const file=path.join(root,u.pathname==='/'?'index.html':decodeURIComponent(u.pathname));
        if(!file.startsWith(root+path.sep))return route.abort();
        if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file});
        return route.abort();
      });
      await page.goto('http://127.0.0.1:4199/');
      await page.waitForFunction(()=>document.querySelector('#auth-root').hidden&&window.PortalMoney);
      await page.waitForFunction(()=>document.querySelector('#wallet-balance').textContent.includes('5,362,900'));
      // Create a price panel through actual portal helpers, not a formatter stub.
      await page.evaluate(()=>{
        const panel=document.createElement('div');panel.id='test-checkout';
        panel.innerHTML=safeHtml(`<input name="firstName" value="BARS"><input name="passport" value="P12345"><b>${retailTotalMnt({total:2000,retail:{version:3,rateMnt:536.29,walletCny:2000,amountMnt:1072580}})}</b>`);
        document.querySelector('main').append(panel);window.samePassengerInput=panel.querySelector('[name="firstName"]');
      });
      const before=calls.filter(c=>c.method==='POST'&&!c.path.startsWith('/api/auth/')).length;
      await page.locator('[data-currency-selector]').selectOption('CNY');
      assert.equal(await page.locator('#wallet-balance').textContent(),'¥ 10,000.00');
      assert.equal(await page.locator('#test-checkout b').textContent(),'¥ 2,000.00');
      await page.locator('[data-currency-selector]').selectOption('MNT');
      assert.equal(await page.locator('#test-checkout b').textContent(),'₮ 1,072,580');
      assert.equal(await page.locator('#test-checkout [name="firstName"]').inputValue(),'BARS');
      assert.equal(await page.evaluate(()=>samePassengerInput===document.querySelector('#test-checkout [name="firstName"]')),true);
      assert.equal(calls.filter(c=>c.method==='POST'&&!c.path.startsWith('/api/auth/')).length,before);
      await page.evaluate(()=>document.querySelector('#topup-modal').showModal());
      assert.equal(await page.locator('#topup-amount').getAttribute('name'),'amountCny');
      await page.locator('#topup-amount').fill('10,000.00');
      await page.waitForFunction(()=>document.querySelector('#topup-rate-preview').textContent.includes('10,359.30'));
      assert.match(await page.locator('#topup-rate-preview').textContent(),/538/);
      assert.equal(JSON.parse(calls.find(c=>c.path==='/api/topups/quote').body).amountCny,'10000.00');
      await page.evaluate(()=>document.querySelector('#topup-modal').close());
      await page.evaluate(()=>document.querySelector('[data-view="administration"]').click());
      await page.waitForFunction(()=>document.querySelector('#admin-topups details'));
      assert.match(await page.locator('#admin-topups').textContent(),/non-refundable/);
      assert.equal(await page.locator('#admin-topups tr').count(),1);
      assert.deepEqual(errors,[]);
      await page.close();console.log(`PASS: actual portal currency, passenger preservation, no payment side effects, funding sell preview and admin breakdown (${width}px)`);
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
