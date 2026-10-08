const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const path=require('node:path');
test('display-only switch changes only money text, retains inputs and stores no tokens',()=>{
  const storage=new Map(),listeners={},watch={};
  const nameInput={value:'BARS',dataset:{},textContent:''};
  const selector={value:'MNT'},heading={dataset:{currencyHeading:'AMOUNT'},textContent:''};
  const price={dataset:{moneyCny:'2000.00',moneyRate:'536.29',moneyMnt:'1072580'},textContent:'',matches:()=>true};
  const refund={dataset:{moneyCny:'1800.00',moneyRate:'536.29',moneyDirection:'refund'},textContent:'',matches:()=>true};
  const document={body:{},documentElement:{dataset:{}},querySelectorAll:q=>({'[data-money-cny]':[price,refund],'[data-currency-selector]':[selector],'[data-currency-heading]':[heading]})[q]||[],addEventListener:(event,fn)=>listeners[event]=fn};
  const context=vm.createContext({document,localStorage:{getItem:key=>storage.get(key),setItem:(key,v)=>storage.set(key,v)},MutationObserver:class{constructor(fn){watch.callback=fn;}observe(){}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../money-display.js'),'utf8'),context);
  const money=context.PortalMoney;
  assert.equal(price.textContent,'₮ 1,072,580');assert.equal(refund.textContent,'₮ 965,320');
  money.setCurrency('CNY');assert.equal(price.textContent,'¥ 2,000.00');assert.equal(refund.textContent,'¥ 1,800.00');assert.equal(heading.textContent,'AMOUNT (CNY)');
  assert.equal(nameInput.value,'BARS');assert.equal(selector.value,'CNY');
  money.setCurrency('MNT');assert.equal(price.textContent,'₮ 1,072,580');
  assert.equal(storage.size,1);assert.equal(storage.get('nexahub-display-currency'),'MNT');
  assert.equal(money.markupCny('1<script>'),'—');assert.equal(money.markupCny(1,{rate:'1" onmouseover=alert(1)'}),'—');
  assert.equal(money.markupCny(1,{direction:'<script>'}).includes('<script>'),false);
  const newPrice={nodeType:1,dataset:{moneyCny:'10',moneyRate:'536.29'},textContent:'',matches:()=>true};
  watch.callback([{addedNodes:[newPrice]}]);assert.equal(newPrice.textContent,'₮ 5,370');
  // Explicit user selector change uses the same display-only path.
  listeners.change({target:{value:'CNY',matches:()=>true}});assert.equal(price.textContent,'¥ 2,000.00');
});
