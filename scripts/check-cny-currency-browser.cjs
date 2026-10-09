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
      const page=await browser.newPage(),errors=[],calls=[];let approvalFailure=false,missingInvoiceModel=false,auditEntries=[];
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
          if(u.pathname==='/api/admin/retail-pricing')return reply({entries:auditEntries});
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
      // Inspect actual browser option values from the real sanitized form,
      // never hand-invent lower-case DTO values (the previous test blind spot).
      const passengerOptions=await page.evaluate(()=>{
        const card=document.createElement('div');card.innerHTML=safeHtml(passengerForm('Adult',0));
        const options=name=>[...card.querySelector(`[name="${name}"]`).options].map(option=>({value:option.value,label:option.textContent}));
        return {gender:options('gender'),document:options('document-type'),defaultDocument:card.querySelector('[name="document-type"]').value};
      });
      assert.deepEqual(passengerOptions,{gender:[{value:'',label:'Select'},{value:'male',label:'Male'},{value:'female',label:'Female'}],document:[{value:'passport',label:'Passport'},{value:'national id',label:'National ID'}],defaultDocument:'passport'});
      // Create a price panel through actual portal helpers, not a formatter stub.
      await page.evaluate(()=>{
        const panel=document.createElement('div');panel.id='test-checkout';
        panel.innerHTML=safeHtml(`<input name="firstName" value="BARS"><input name="passport" value="P12345"><b>${retailTotalMnt({total:2000,retail:{version:3,rateMnt:536.29,walletCny:2000,amountMnt:1072580}})}</b>`);
        document.querySelector('main').append(panel);window.samePassengerInput=panel.querySelector('[name="firstName"]');
        const prices=document.createElement('section');prices.id='test-prices';
        const price={total:2000,breakdown:[],retail:{version:3,rateMnt:536.29,walletCny:2000,amountMnt:1072580}};
        prices.innerHTML=safeHtml(`<article class="flight"><div class="carrier">Spring Airlines</div><div class="flight-time"><strong>08:00</strong><span>UBN</span></div><div class="duration">Direct</div><div class="flight-time"><strong>11:00</strong><span>PVG</span></div><div class="fare">${passengerPriceMarkup(price,'')}</div><button class="primary">Select</button></article><article class="round-pair"><div class="pair-footer"><span>Same airline return</span><strong>${passengerPriceMarkup(price,'')}</strong><button class="primary">Select itinerary</button></div></article><div class="fare-choice-grid"><button class="fare-family-choice">${farePriceMarkup({displayPrice:price})}</button></div>`);
        document.querySelector('main').append(prices);
        const oldQuote=bookingQuote;
        bookingQuote={...price,selectionKey:bookingPriceKey(),expiresAt:Date.now()+60000};
        const checkout=document.createElement('section');checkout.id='test-price-details';checkout.innerHTML=safeHtml(checkoutPricePanel());
        document.querySelector('main').append(checkout);bookingQuote=oldQuote;
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
        assert.deepEqual(await page.locator('#test-price-details .price-total [data-money-cny]').evaluate(node=>({size:getComputedStyle(node).fontSize,weight:getComputedStyle(node).fontWeight,color:getComputedStyle(node).color,parentColor:getComputedStyle(node.parentElement).color})),{size:'18px',weight:'400',color:await page.locator('#test-price-details .price-total strong').evaluate(node=>getComputedStyle(node).color),parentColor:await page.locator('#test-price-details .price-total strong').evaluate(node=>getComputedStyle(node).color)});
      }
      await page.evaluate(()=>{document.documentElement.dataset.theme='light';PortalMoney.setCurrency('MNT');});
      const screenshots=path.join(root,'tmp','security','price-topup-20261009');fs.mkdirSync(screenshots,{recursive:true});
      await page.locator('#test-prices').screenshot({path:path.join(screenshots,`prices-${width}.png`)});
      await page.locator('#test-price-details').screenshot({path:path.join(screenshots,`checkout-total-${width}.png`)});
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
      assert.equal(await page.locator('#admin-topups tr').count(),2);
      assert.equal(await page.locator('#admin-topups .funding-detail-row td').getAttribute('colspan'),'6');
      await page.locator('#admin-topups summary').click();
      await page.evaluate(()=>loadAdministration());
      assert.equal(await page.locator('#admin-topups details').getAttribute('open'),'','Expanded breakdown survives polling');
      assert.equal(await page.locator('#admin-topups .funding-detail-grid>div').count(),5);
      await page.locator('#admin-topups').screenshot({path:path.join(screenshots,`admin-breakdown-${width}.png`)});
      const nativeDialogs=[];
      page.on('dialog',async dialog=>{nativeDialogs.push(dialog.type());await dialog.dismiss();});
      missingInvoiceModel=true;await page.evaluate(()=>loadAdministration());
      await page.waitForFunction(()=>!document.querySelector('#admin-topups details'));
      await page.locator('#admin-topups .topup-approve').click();
      await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('үнийн загвар дутуу'));
      assert.equal(calls.filter(c=>c.path==='/api/admin/topups/invoice/approve').length,0,'Missing model must not silently submit an empty legacy receipt');
      missingInvoiceModel=false;await page.evaluate(()=>loadAdministration());
      await page.waitForFunction(()=>document.querySelector('#admin-topups details'));
      await page.locator('#admin-topups .topup-approve').click();
      const approvalForm=page.locator('#admin-modal .topup-approval-form');
      assert.equal(await approvalForm.locator('[name="receivedCny"]').inputValue(),'','Actual bank amount must not be pre-attested');
      await approvalForm.locator('.approval-cancel').click();
      assert.equal(calls.filter(c=>c.path==='/api/admin/topups/invoice/approve').length,0,'Cancel must not approve');
      await page.locator('#admin-topups .topup-approve').click();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#admin-modal').evaluate(node=>node.open),false);
      await page.locator('#admin-topups .topup-approve').click();
      await approvalForm.locator('[name="bankReference"]').fill('MOCK-BANK-REFERENCE');
      await approvalForm.locator('[name="receivedCny"]').fill('10000');
      assert.equal(await approvalForm.locator('[name="receivedCny"]').inputValue(),'10,000');
      await approvalForm.locator('[type="submit"]').click();
      await page.waitForFunction(()=>document.querySelector('#admin-modal .admin-form-error')?.textContent.includes('таарахгүй'));
      assert.equal(calls.filter(c=>c.path==='/api/admin/topups/invoice/approve').length,0,'Principal alone must never be approved');
      await approvalForm.locator('[name="receivedCny"]').fill('10359.29');
      approvalFailure=true;
      await approvalForm.locator('[type="submit"]').click();
      await page.waitForFunction(()=>document.querySelector('#admin-modal .admin-form-error')?.textContent.includes('TOPUP_AMOUNT_MISMATCH'));
      assert.equal(await approvalForm.locator('[type="submit"]').isEnabled(),true);
      assert.equal(await page.locator('#admin-modal').evaluate(node=>node.scrollWidth<=node.clientWidth),true);
      for(const theme of ['light','dark']){
        await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        await page.locator('#admin-modal').screenshot({path:path.join(screenshots,`approval-${theme}-${width}.png`)});
      }
      approvalFailure=false;
      await approvalForm.locator('[type="submit"]').click();
      await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('Invoice approved'));
      const approval=calls.find(c=>c.path==='/api/admin/topups/invoice/approve');
      assert.deepEqual(JSON.parse(approval.body),{confirmed:true,bankReference:'MOCK-BANK-REFERENCE',receivedCny:'10359.29'});
      assert.deepEqual(nativeDialogs,[],'Approval must use exactly one custom dialog, no native popup steps');
      assert.equal(await page.locator('#admin-modal').evaluate(node=>node.open),false);
      const auditWritesBefore=calls.filter(c=>c.method==='POST'&&!c.path.startsWith('/api/auth/')).length;
      await page.locator('.admin-audit-button').click();
      await page.waitForSelector('#admin-modal .settlement-audit');
      assert.match(await page.locator('#admin-modal .settlement-empty').textContent(),/Батлах буцаалт одоогоор алга/);
      assert.equal(await page.locator('#admin-modal').evaluate(node=>node.scrollWidth<=node.clientWidth),true,'Empty audit has no horizontal clipping');
      if(width>650)assert.ok(await page.locator('#admin-modal').evaluate(node=>node.clientWidth)>=900,'Audit must not inherit the 420px form width');
      await page.locator('#admin-modal').screenshot({path:path.join(screenshots,`refund-audit-empty-${width}.png`)});
      await page.locator('#admin-modal .close').click();
      const auditRow=(action,state,pnr)=>({booking_id:pnr,action,state,reference:'MOCK-REFUND-REFERENCE',bookings:{pnr,agency_id:'agency'},snapshot:{walletCny:750,supplierCny:750,marginCny:0,amountMnt:402210}});
      auditEntries=[auditRow('issue','settled','ISSUE'),auditRow('change','prepared','CHANGE'),auditRow('refund','settled','REFUNDED'),auditRow('refund','awaiting_settlement','PENDING')];
      await page.locator('.admin-audit-button').click();
      await page.waitForSelector('#admin-modal .settlement-record');
      assert.equal(await page.locator('#admin-modal .settlement-record').count(),1);
      assert.equal(await page.locator('#admin-modal [data-settle-refund]').getAttribute('data-settle-refund'),'3');
      assert.match(await page.locator('#admin-modal .settlement-record').textContent(),/Mock Agency/);
      assert.match(await page.locator('#admin-modal [data-audit-pending-amount]').textContent(),/750\.00 CNY/);
      await page.locator('#admin-modal [data-settlement-filter="all"]').click();
      assert.equal(await page.locator('#admin-modal .settlement-record').count(),4);
      assert.equal(await page.locator('#admin-modal [data-settle-refund]').count(),1);
      for(const theme of ['light','dark']){
        await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        assert.equal(await page.locator('#admin-modal').evaluate(node=>node.scrollWidth<=node.clientWidth),true,`${theme}: populated audit must fit`);
        await page.locator('#admin-modal').screenshot({path:path.join(screenshots,`refund-audit-${theme}-${width}.png`)});
      }
      await page.locator('#admin-modal [data-settle-refund]').click();
      assert.deepEqual(nativeDialogs,['prompt'],'Cancelling receipt prompt stops refund confirmation');
      assert.equal(calls.filter(c=>c.method==='POST'&&!c.path.startsWith('/api/auth/')).length,auditWritesBefore,'Opening/filtering/closing audit or cancelling confirmation must not move money');
      await page.locator('#admin-modal .close').click();
      const statusWritesBefore=calls.filter(c=>c.method==='POST'&&!c.path.startsWith('/api/auth/')).length;
      await page.evaluate(()=>{
        const panel=document.createElement('section');panel.id='test-supplier-status';panel.className='booking-detail-card supplier-status-panel';
        document.querySelector('main').append(panel);
        window.statusUiBooking={status:'Ticketed',passengers:['TEST PASSENGER'],documents:[{documentNumber:'FIXTURE'}],
          itinerary:{flights:[{number:'9C1',travelDate:'2027-03-22',departure:{id:'AAA'},arrival:{id:'BBB'}}]}};
        renderSupplierStatus(panel,statusUiBooking);
      });
      const statusPanel=page.locator('#test-supplier-status');
      assert.equal(await statusPanel.locator('details').evaluate(node=>node.open),false);
      assert.equal(await statusPanel.locator('summary .supplier-status-value').textContent(),'Not verified');
      assert.equal(await statusPanel.locator('.supplier-status-list').isVisible(),false);
      assert.doesNotMatch(await statusPanel.textContent(),/Awaiting automatic|Spring status pending/);
      await statusPanel.locator('summary').click();
      assert.equal(await statusPanel.locator('.supplier-status-list').isVisible(),true);
      await page.evaluate(()=>{
        statusUiBooking.supplierStatus={lastSuccessfulAt:'2026-10-09T01:00:00Z',records:[{flightKey:SpringTicketStatus.flightKey(statusUiBooking.itinerary.flights[0]),passengerKey:'FIXTURE',flag:3}]};
        renderSupplierStatus(document.querySelector('#test-supplier-status'),statusUiBooking);
      });
      assert.equal(await statusPanel.locator('details').evaluate(node=>node.open),true,'Background refresh must preserve expanded details');
      assert.equal(await statusPanel.locator('summary .supplier-status-value').textContent(),'Verified');
      assert.equal(await statusPanel.locator('.supplier-status-row .supplier-status-value').textContent(),'Ticketed');
      assert.match(await statusPanel.locator('summary').getAttribute('title'),/^Last verified:/);
      assert.doesNotMatch(await statusPanel.textContent(),/Last verified:/);
      await page.evaluate(()=>{
        statusUiBooking.supplierStatus.result='error';
        renderSupplierStatus(document.querySelector('#test-supplier-status'),statusUiBooking);
      });
      assert.equal(await statusPanel.locator('summary .supplier-status-value').textContent(),'Check unavailable');
      assert.equal(await statusPanel.locator('.supplier-status-row .supplier-status-value').textContent(),'Ticketed','Cached verified status retained on failure');
      await statusPanel.locator('summary').click();
      for(const theme of ['light','dark']){
        await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        assert.equal(await statusPanel.evaluate(node=>node.scrollWidth<=node.clientWidth),true,`${theme}: minimal status must fit`);
        await statusPanel.screenshot({path:path.join(screenshots,`minimal-status-${theme}-${width}.png`)});
      }
      assert.equal(calls.filter(c=>c.method==='POST'&&!c.path.startsWith('/api/auth/')).length,statusWritesBefore,'Reading/expanding/rendering status must not make a mutation request');
      await statusPanel.evaluate(node=>node.remove());
      assert.deepEqual(errors,[]);
      await page.close();console.log(`PASS: canonical passenger form values, clear prices, safe approval/refund audit and minimal read-only ticket status (${width}px)`);
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
