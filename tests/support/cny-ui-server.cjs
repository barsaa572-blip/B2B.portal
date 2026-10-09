// LOCAL VISUAL FIXTURE ONLY: no credentials, supplier clients or bank writes.
const {createServer}=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
(async()=>{
  const {fundingQuote}=await import('../../backend/cny-funding.mjs');
  const q=fundingQuote(10000,{nonCashSellMnt:538.3,fundingRateDate:'2026-10-08'});
  const rate={pricingModel:q.model,effectiveRateMnt:536.29,nonCashSellMnt:538.3,fundingRateDate:q.rateDate};
  const profile={id:'local-mock',agency_id:'local-agency',role:'platform_admin',full_name:'LOCAL TEST'};
  const invoice={id:'local-invoice',invoice_number:'INV-LOCAL-TEST',agency_id:profile.agency_id,status:'pending',pricing_model:q.model,funding_quote:q,amount_cny:q.principalCny,amount_mnt:q.rows[0].amountMnt,total_mnt:q.totalMnt,created_at:'2026-10-08T01:00:00Z'};
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
  createServer(async(req,res)=>{
    const u=new URL(req.url,'http://localhost'),json=data=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));};
    if(u.pathname==='/fixture-seed.js'){res.setHeader('content-type','text/javascript');return res.end(`sessionStorage.setItem('flightb2b-session',JSON.stringify({profile:${JSON.stringify(profile)},accessToken:'cookie',refreshToken:'cookie',expiresAt:Date.now()+3600000,idleExpiresAt:Date.now()+1200000,sessionExpiresAt:Date.now()+43200000}));`);}
    if(u.pathname==='/fixture-checkout.js'){res.setHeader('content-type','text/javascript');return res.end(`const panel=document.createElement('section');panel.className='panel';panel.id='local-checkout-fixture';panel.innerHTML=safeHtml('<h2>LOCAL TEST - no bank / supplier actions</h2><label>Test passenger name<input name="testFirstName" value="BARS"></label><label>Test document<input name="testDocument" value="MOCK-P12345"></label><b>'+retailTotalMnt({total:2000,retail:{version:3,rateMnt:536.29,walletCny:2000,amountMnt:1072580}})+'</b>');document.querySelector('#dashboard').prepend(panel);`);}
    if(u.pathname.startsWith('/api/')){
      if(u.pathname==='/api/auth/session'||u.pathname==='/api/auth/activity')return json({idleExpiresAt:Date.now()+1200000,sessionExpiresAt:Date.now()+43200000});
      if(u.pathname==='/api/fx/cny-mnt')return json(rate);
      if(u.pathname==='/api/wallet')return json({wallet:{balance_cny:10000},rate,transactions:[{id:'local-credit',amount_cny:10000,entry_type:'credit',reason:'LOCAL MOCK funding',created_at:invoice.created_at}]});
      if(u.pathname==='/api/bookings/dashboard')return json({salesCny:2000,issuedBookings:1,pendingTopupMnt:q.totalMnt,pendingTopupRequests:1,month:'2026-10',effectiveRateMnt:536.29});
      if(u.pathname==='/api/bookings'||u.pathname==='/api/locations')return json([]);
      if(u.pathname==='/api/admin/overview')return json({agencies:[{id:profile.agency_id,name:'LOCAL TEST AGENCY',active:true}],profiles:[profile],branches:[],wallets:[{agency_id:profile.agency_id,balance_cny:10000}],topups:[invoice]});
      if(u.pathname==='/api/topups/quote')return json(q);
      if(u.pathname==='/api/topups'&&req.method==='GET')return json([invoice]);
      res.statusCode=403;return json({error:'Local fixture: all financial mutations disabled.'});
    }
    const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
    if(!file.startsWith(root+path.sep)||!types[path.extname(file)]||!fs.existsSync(file)){res.statusCode=404;return res.end('Not found');}
    res.setHeader('content-type',types[path.extname(file)]);
    if(u.pathname==='/')return res.end(fs.readFileSync(file,'utf8').replace('</head>','<script src="/fixture-seed.js"></script></head>').replace('</body>','<script src="/fixture-checkout.js"></script></body>'));
    res.end(fs.readFileSync(file));
  }).listen(4199,'127.0.0.1',()=>console.log('Local UI fixture http://127.0.0.1:4199 - financial mutations disabled'));
})();
