// Actual portal UI with every request intercepted; no external financial writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.argv[2] ? path.resolve(process.argv[2]) : 'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const {fundingQuote}=await import('../backend/cny-funding.mjs');
  const quote=fundingQuote(10000,{nonCashSellMnt:538.3,fundingRateDate:'2026-10-08'});
  const rate={pricingModel:'cny-funding-v1',effectiveRateMnt:536.29,nonCashSellMnt:538.3,fundingRateDate:'2026-10-08'};
  const profile={id:'mock',agency_id:'agency',role:'platform_admin',full_name:'Mock Admin'};
  const invoice={id:'invoice',invoice_number:'INV-TEST',agency_id:'agency',status:'pending',pricing_model:quote.model,funding_quote:quote,amount_cny:10000,amount_mnt:5380000,total_mnt:quote.totalMnt,created_at:'2026-10-08T01:00:00Z'};
  const browser=await chromium.launchPersistentContext(path.join(root,'tmp','cny-browser-profile'),{headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    for(const width of [1280,390]){
      const page=await browser.newPage(),errors=[],calls=[];let approvalFailure=false,missingInvoiceModel=false;
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
          if(u.pathname==='/api/admin/overview')return reply({agencies:[{id:'agency',name:'Mock Agency',active:true}],wallets:[{agency_id:'agency',balance_cny:10000}],profiles:[profile],branches:[],topups:[missingInvoiceModel?{...invoice,pricing_model:undefined}:invoice]});
          if(u.pathname==='/api/topups/quote')return reply(fundingQuote(JSON.parse(req.postData()).amountCny,rate));
          if(u.pathname==='/api/admin/topups/invoice/approve' && approvalFailure)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Орсон NET CNY дүн нэхэмжлэлийн шилжүүлэх нийт дүнтэй таарахгүй байна.',code:'TOPUP_AMOUNT_MISMATCH'})});
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
        const prices=document.createElement('section');prices.id='test-prices';
        const price={total:2000,breakdown:[],retail:{version:3,rateMnt:536.29,walletCny:2000,amountMnt:1072580}};
        prices.innerHTML=safeHtml(`<article class="flight"><div class="carrier">Spring Airlines</div><div class="flight-time"><strong>08:00</strong><span>UBN</span></div><div class="duration">Direct</div><div class="flight-time"><strong>11:00</strong><span>PVG</span></div><div class="fare">${passengerPriceMarkup(price,'')}</div><button class="primary">Select</button></article><article class="round-pair"><div class="pair-footer"><span>Same airline return</span><strong>${passengerPriceMarkup(price,'')}</strong><button class="primary">Select itinerary</button></div></article><div class="fare-choice-grid"><button class="fare-family-choice">${farePriceMarkup({displayPrice:price})}</button></div>`);
        document.querySelector('main').append(prices);
      });
      const before=calls.filter(c=>c.method==='POST'&&!c.path.startsWith('/api/auth/')).length;
      for(const theme of ['light','dark'])for(const currency of ['MNT','CNY']){
        await page.evaluate(({theme,currency})=>{document.documentElement.dataset.theme=theme;PortalMoney.setCurrency(currency);},{theme,currency});
        const typography=await page.locator('#test-prices [data-money-cny]').evaluateAll(nodes=>nodes.map(node=>{
          const style=getComputedStyle(node),parent=getComputedStyle(node.parentElement);
          return {context:node.closest('.fare-family-price')?'fare-choice':node.closest('.pair-footer')?'round-trip':'one-way',size:parseFloat(style.fontSize),weight:parseInt(style.fontWeight),color:style.color,parentColor:parent.color,parentSize:parent.fontSize,sizeText:style.fontSize,margin:style.marginRight};
        }));
        assert.equal(typography.length,3);
        for(const style of typography){const context=`${theme}/${currency}/${style.context}`;assert.equal(style.size,width<=650?18:20,`${context}: price must match surrounding system proportions`);assert.equal(style.weight,600,`${context}: price must use restrained semibold, not extra-bold`);assert.equal(style.color,style.parentColor,`${context}: currency value must keep its parent amount color`);assert.equal(style.sizeText,style.parentSize,`${context}: currency value must keep its parent amount size`);assert.equal(style.margin,'0px',`${context}: currency value must not inherit label spacing`);}
        assert.equal(await page.locator('#test-prices').evaluate(el=>el.scrollWidth<=el.clientWidth),true,`${theme}/${currency}: price layouts must fit`);
      }
      await page.evaluate(()=>{document.documentElement.dataset.theme='light';PortalMoney.setCurrency('MNT');});
      const screenshots=path.join(root,'tmp','security','price-topup-20261009');fs.mkdirSync(screenshots,{recursive:true});
      await page.locator('#test-prices').screenshot({path:path.join(screenshots,`prices-${width}.png`)});
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
      await page.locator('#topup-amount').fill('10000');
      assert.equal(await page.locator('#topup-amount').inputValue(),'10,000');
      await page.waitForFunction(()=>document.querySelector('#topup-rate-preview').textContent.includes('10,359.29'));
      assert.match(await page.locator('#topup-rate-preview').textContent(),/538\.3/);
      assert.equal(JSON.parse(calls.find(c=>c.path==='/api/topups/quote').body).amountCny,'10000');
      assert.equal(await page.locator('#topup-rate-preview .funding-row').count(),4);
      assert.equal(await page.evaluate(()=>{
        const modal=document.querySelector('#topup-modal'),rows=document.querySelector('#topup-rate-preview');
        return modal.scrollWidth<=modal.clientWidth && rows.scrollWidth<=rows.clientWidth;
      }),true,'Top-up layout must not overflow at desktop or mobile width');
      await page.locator('#topup-amount').fill('10000.50');
      assert.equal(await page.locator('#topup-amount').inputValue(),'10,000.50');
      await page.locator('#topup-amount').fill('100000');
      assert.equal(await page.locator('#topup-amount').inputValue(),'100,000');
      const largeQuote=fundingQuote(100000,rate);
      await page.waitForFunction(total=>document.querySelector('#topup-rate-preview .funding-total strong')?.textContent.includes(total),largeQuote.totalCny.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
      assert.equal(await page.locator('#topup-rate-preview .funding-credit').count(),1);
      assert.equal(await page.locator('#topup-rate-preview .funding-credit strong').textContent(),'¥ 100,000.00 CNY');
      assert.match(await page.locator('#topup-rate-preview .funding-total').textContent(),/Банк руу шилжүүлэх нийт дүн/);
      assert.equal(await page.locator('#topup-modal').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
      for(const theme of ['light','dark']){
        await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        const figures=await page.locator('#topup-rate-preview small').evaluateAll(nodes=>nodes.map(node=>({size:parseFloat(getComputedStyle(node).fontSize),weight:getComputedStyle(node).fontWeight,color:getComputedStyle(node).color,expectedColor:getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()})));
        assert.equal(figures.length,5);
        for(const figure of figures){assert.ok(figure.size>=13);assert.equal(figure.weight,'500');}
        assert.equal(await page.locator('#topup-rate-preview').evaluate(el=>[...el.querySelectorAll('small')].every(node=>getComputedStyle(node).color===getComputedStyle(el.querySelector('.funding-row')).color)),true,`${theme}: MNT figures must not have faint label coloring`);
      }
      await page.evaluate(()=>document.documentElement.dataset.theme='light');
      await page.locator('#topup-modal').screenshot({path:path.join(screenshots,`topup-${width}.png`)});
      await page.evaluate(()=>document.querySelector('#topup-modal').close());
      await page.evaluate(()=>document.querySelector('[data-view="administration"]').click());
      await page.waitForFunction(()=>document.querySelector('#admin-topups details'));
      assert.match(await page.locator('#admin-topups').textContent(),/non-refundable/);
      assert.equal(await page.locator('#admin-topups tr').count(),1);
      const replies=[];
      page.on('dialog',async dialog=>dialog.accept(dialog.type()==='prompt'?replies.shift():undefined));
      missingInvoiceModel=true;await page.evaluate(()=>loadAdministration());
      await page.waitForFunction(()=>!document.querySelector('#admin-topups details'));
      await page.locator('#admin-topups .topup-approve').click();
      await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('үнийн загвар дутуу'));
      assert.equal(calls.filter(c=>c.path==='/api/admin/topups/invoice/approve').length,0,'Missing model must not silently submit an empty legacy receipt');
      missingInvoiceModel=false;await page.evaluate(()=>loadAdministration());
      await page.waitForFunction(()=>document.querySelector('#admin-topups details'));
      replies.push('MOCK-BANK-REFERENCE','10,000');
      await page.locator('#admin-topups .topup-approve').click();
      await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('таарахгүй'));
      assert.equal(calls.filter(c=>c.path==='/api/admin/topups/invoice/approve').length,0,'Principal alone must never be approved');
      approvalFailure=true;replies.push('MOCK-BANK-REFERENCE','10,359.29');
      await page.locator('#admin-topups .topup-approve').click();
      await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('TOPUP_AMOUNT_MISMATCH'));
      assert.equal(await page.locator('#admin-topups .topup-approve').isEnabled(),true);
      approvalFailure=false;replies.push('MOCK-BANK-REFERENCE','10,359.29');
      await page.locator('#admin-topups .topup-approve').click();
      await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('Invoice approved'));
      const approval=calls.find(c=>c.path==='/api/admin/topups/invoice/approve');
      assert.deepEqual(JSON.parse(approval.body),{confirmed:true,bankReference:'MOCK-BANK-REFERENCE',receivedCny:'10359.29'});
      assert.deepEqual(errors,[]);
      await page.close();console.log(`PASS: clear prices in both themes/currencies, grouped top-up input, fee breakdown, passenger preservation and safe mocked approval (${width}px)`);
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
