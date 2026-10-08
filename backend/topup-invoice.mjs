import { readFile } from 'node:fs/promises';
import moneyDisplay from '../money-display.js';

export const PAYMENT_ACCOUNT = Object.freeze({ bank: 'Голомт банк', iban: 'MN240015001605336658', name: 'ЭЙР СЭЛС' });
export const ISSUER = Object.freeze({ name: 'ЭЙР СЭЛС ХХК', registration: '6876242', address: 'Монгол улс, Улаанбаатар хот, Сүхбаатар дүүрэг, 2-р хороо, Нарны зам 25-102' });
const asset = name => new URL(`../assets/invoice/${name}`, import.meta.url);
const BRAND_NAVY = '#0b2f5b';
const money = value => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
const escape = value => clean(value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
const amount = value => {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error('Invalid saved invoice amount.');
  return number;
};

export function invoiceModel(invoice) {
  const funding = invoice.pricing_model === 'cny-funding-v1' ? invoice.funding_quote : null;
  if (invoice.pricing_model === 'cny-funding-v1') {
    if (!funding || funding.version !== 1 || funding.model !== 'cny-funding-v1' || funding.transferCurrency !== 'CNY' || funding.account?.iban !== 'MN940015001605336659' || funding.account?.currency !== 'CNY') throw new Error('Saved CNY invoice quote is unavailable.');
    const values = ['principalCny','serviceFeeCny','correspondentFeeCny','bankFeeCny'].map(key => moneyDisplay.integer(funding[key],2,'saved CNY invoice'));
    if (values.reduce((sum,value)=>sum+value,0n) !== moneyDisplay.integer(funding.totalCny,2,'saved CNY invoice total')
      || values[0] !== moneyDisplay.integer(invoice.amount_cny,2,'saved wallet principal')
      || !Number.isSafeInteger(funding.totalMnt) || funding.totalMnt !== Number(invoice.total_mnt)
      || !/^\d{4}-\d{2}-\d{2}$/.test(funding.rateDate || '') || Number(funding.rateMnt) <= 0) throw new Error('Saved CNY invoice amounts do not match.');
    moneyDisplay.integer(funding.rateMnt,6,'saved invoice rate');
  }
  const rows = [
    ['Wallet цэнэглэлт', amount(invoice.amount_mnt)],
    ['Үйлчилгээний хөлс (3%)', amount(invoice.service_fee_mnt)],
    ['Корреспондент банкны шимтгэл (OUR)', amount(invoice.correspondent_fee_mnt)],
    ['Банкны шимтгэл', amount(invoice.bank_transfer_fee_mnt ?? invoice.khaan_transfer_fee_mnt)]
  ];
  const subtotal = rows.reduce((sum, row) => sum + row[1], 0);
  const total = amount(invoice.total_mnt ?? subtotal);
  if (funding && total !== subtotal) throw new Error('Saved CNY invoice rows do not match its total.');
  // Preserve historical invoice totals; never add new VAT or recalculate fees.
  if (Math.abs(total - subtotal) > 0.005) rows.push(['Бусад тохируулга', Number((total - subtotal).toFixed(2))]);
  const date = new Date(invoice.created_at);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid invoice date.');
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Ulaanbaatar', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(date);
  const part = name => parts.find(item => item.type === name).value;
  return { number:clean(invoice.invoice_number), created:`${part('year')}.${part('month')}.${part('day')}`,
    agency:clean(invoice.agencyName || '-'), registration:clean(invoice.agencyRegistrationNumber || '-'),
    address:clean(invoice.agencyAddress || ''), email:clean(invoice.agencyEmail || ''), phone:clean(invoice.agencyPhone || ''),
    note:clean(invoice.note || ''), rows, total, status:invoice.status,
    account: funding ? {bank:'Голомт банк',iban:funding.account.iban,name:'ЭЙР СЭЛС'} : PAYMENT_ACCOUNT,
    totalCny:funding ? amount(funding.totalCny) : null,
    rowsCny:funding ? [funding.principalCny,funding.serviceFeeCny,funding.correspondentFeeCny,funding.bankFeeCny].map(amount) : [],
    rate:funding ? amount(funding.rateMnt) : null, rateDate:funding ? clean(funding.rateDate) : null,
    reference:[invoice.agencyRegistrationNumber, invoice.invoice_number].filter(value => value && value !== '—' && value !== '-').map(clean).join(' / ') };
}

async function identity(options = {}) {
  const stampPath = options.stampPath ?? (process.env.INVOICE_STAMP_PATH || new URL('../private/invoice/stamp.png', import.meta.url));
  const signaturePath = options.signaturePath ?? (process.env.INVOICE_SIGNATURE_PATH || new URL('../private/invoice/signature.png', import.meta.url));
  const director = clean(options.directorName ?? (process.env.INVOICE_DIRECTOR_NAME || 'Д.Барсболд'));
  const load = async path => {
    if (!path) return null;
    let bytes;
    try { bytes = await readFile(path); }
    catch (error) {
      // Optional local artwork is Git-ignored; configured production paths must exist.
      if (error.code === 'ENOENT' && path instanceof URL && path.href.startsWith(new URL('../private/invoice/', import.meta.url).href)) return null;
      throw error;
    }
    if (bytes.length > 5_000_000) throw new Error('Invoice identity image is too large.');
    const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpg = bytes[0] === 255 && bytes[1] === 216;
    if (!png && !jpg) throw new Error('Invoice stamp/signature must be PNG or JPEG.');
    return { bytes, mime:png ? 'image/png' : 'image/jpeg' };
  };
  const [logo, stamp, signature] = await Promise.all([readFile(new URL('../nexahub-logo.png', import.meta.url)), load(stampPath), load(signaturePath)]);
  return { logo, stamp, signature, director };
}

export async function invoiceHtml(invoice, options = {}) {
  const m = invoiceModel(invoice), id = await identity(options);
  const image = item => `data:${item.mime};base64,${item.bytes.toString('base64')}`;
  return `<!doctype html><html lang="mn"><head><meta charset="utf-8"><title>${escape(m.number)}</title><style>th{background:${BRAND_NAVY}!important}
  *{box-sizing:border-box}body{margin:0;background:#edf1f5;font-family:Arial,"Segoe UI",sans-serif;color:#222;font-size:13px;line-height:1.5}.sheet{background:white;max-width:794px;min-height:1123px;margin:20px auto;padding:48px 45px;display:flex;flex-direction:column}.head,.parties{display:flex;justify-content:space-between;gap:25px}.logo{width:210px;display:block;margin:-12px 0 4px -20px}h1{font-size:30px;font-weight:400;margin:0}.meta{text-align:right}.parties{margin:48px 0 22px}.recipient{max-width:60%}.muted{color:#5e6269;font-size:12px}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#00afe8;color:white;font-weight:400;padding:11px 9px;text-align:left}td{padding:15px 9px;border-bottom:1px solid #aaa;vertical-align:top}.num{text-align:right;white-space:nowrap}.summary{margin:16px 0 22px auto;width:52%;font-size:13px}.sum{display:flex;justify-content:space-between;gap:15px;padding:10px}.sum.total{background:#f3f3f3;font-size:15px;font-weight:700}.bank{line-height:1.9;margin-top:4px}.reference{background:#f7f9fb;padding:10px 13px;border-left:3px solid #00afe8;overflow-wrap:anywhere}.identity{height:150px;margin-top:32px;position:relative;page-break-inside:avoid}.stamp{max-width:120px;max-height:100px;object-fit:contain}.signature{max-width:140px;max-height:65px;object-fit:contain;vertical-align:bottom}.signline{position:absolute;left:150px;bottom:28px;border-bottom:1px solid #777;min-width:220px;padding-bottom:6px}.footer{margin-top:auto;border-top:1px solid #bbb;padding-top:9px;font-size:11px;color:#666}.notice{font-weight:700;color:#b32828}p{overflow-wrap:anywhere}@media(max-width:600px){.sheet{padding:24px 16px;margin:0}.head,.parties{gap:12px}.logo{width:160px;margin-left:-15px}h1{font-size:25px}.recipient{max-width:65%}th,td{padding:10px 5px;font-size:10px}.summary{width:75%}.signline{left:110px;min-width:160px}}@media print{@page{size:A4;margin:0}body{background:white}.sheet{margin:0;max-width:none;min-height:297mm;padding:16mm}.head,.parties,.summary,.bank,.identity,tr{break-inside:avoid}}
  </style></head><body><main class="sheet"><header class="head"><div style="max-width:55%"><img class="logo" src="data:image/png;base64,${id.logo.toString('base64')}" alt="NEXAHUB by Air Sales"><strong>${ISSUER.name}</strong><div class="muted">РД: ${ISSUER.registration}<br>${ISSUER.address}</div></div><div class="meta"><h1>Нэхэмжлэх</h1><strong># ${escape(m.number)}</strong>${m.status === 'cancelled' ? '<p class="notice">ЦУЦЛАГДСАН</p>' : ''}</div></header>
  <section class="parties"><div class="recipient">Төлөгч байгууллага<br><strong>${escape(m.agency)}</strong><div class="muted">РД: ${escape(m.registration)}</div></div><div class="meta">Нэхэмжилсэн: <strong>${m.created}</strong></div></section>
  <table><thead><tr><th>#</th><th>Бараа &amp; үйлчилгээ</th><th class="num">Тоо</th><th class="num">Нэгж үнэ</th><th class="num">Нийт</th></tr></thead><tbody>${m.rows.map(([label,value],i)=>`<tr><td>${i+1}</td><td>${escape(label)}</td><td class="num">1</td><td class="num">${money(value)}${m.totalCny == null ? '' : `<div class="muted">CNY ${money(m.rowsCny[i])}</div>`}</td><td class="num">${money(value)}${m.totalCny == null ? '' : `<div class="muted">CNY ${money(m.rowsCny[i])}</div>`}</td></tr>`).join('')}</tbody></table>
  <section class="summary"><div class="sum"><span>Нийт дүн</span><span>${money(m.total)}</span></div><div class="sum total"><span>Эцсийн дүн</span><span>MNT ${money(m.total)}</span></div></section>
  ${m.totalCny == null ? '' : `<p class="muted">Валютын дүн (CNY): <strong>${money(m.totalCny)}</strong><br>Голомт банкны бэлэн бус зарах ханш: 1 CNY = ${money(m.rate)} MNT (${escape(m.rateDate)})<br>MNT дүн нь ханшийн илэрхийлэл. Шилжүүлэх нийт дүн: <strong>${money(m.totalCny)} CNY</strong>.<br>Цэнэглэх үйлчилгээний 3% буцаагдахгүй.</p>`}<section class="bank">Та төлбөрөө <strong>${m.account.bank}</strong> дахь<br><strong>${m.account.iban}</strong> тоот дансанд шилжүүлнэ үү.<br>Дансны нэр: <strong>${m.account.name}</strong></section><p class="reference">Гүйлгээний утга: <strong>${escape(m.reference)}</strong></p>${m.note ? `<p class="muted">Тайлбар: ${escape(m.note)}</p>` : ''}
  <section class="identity">${id.stamp ? `<img class="stamp" alt="Эйр Сэлсийн тамга" src="${image(id.stamp)}">` : ''}<div class="signline">${id.signature ? `<img class="signature" alt="Захирлын гарын үсэг" src="${image(id.signature)}">` : ''}<br>Захирал${id.director ? ` / ${escape(id.director)}` : ''}</div></section>
  <footer class="footer">Гүйлгээний утгад байгууллагын регистр болон нэхэмжлэхийн дугаарыг бичнэ үү.</footer></main></body></html>`;
}

export async function invoicePdf(invoice, options = {}) {
  // Node renderer used on the VPS; embeds fonts so Mongolian survives download/print.
  const [{ PDFDocument, rgb }, { default:fontkit }] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit')]);
  const m = invoiceModel(invoice), id = await identity(options), pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [font, bold] = await Promise.all(['Regular','Bold'].map(async weight => pdf.embedFont(await readFile(asset(`NotoSans-${weight}.ttf`)), { subset:true })));
  const ink=rgb(.12,.13,.15), muted=rgb(.38,.40,.43), blue=rgb(11/255,47/255,91/255), light=rgb(.96,.96,.96), rule=rgb(.68,.69,.71);
  const W=595.28,H=841.89,L=44,R=W-44;
  const charset = new Set(font.getCharacterSet());
  if ([...'ӨөҮү'].some(ch => !charset.has(ch.codePointAt(0)))) throw new Error('Invoice font is missing required Mongolian letters.');
  const safe = text => [...clean(text)].map(ch => ch === '\n' || charset.has(ch.codePointAt(0)) ? ch : '?').join('');
  let page=pdf.addPage([W,H]), y=H-48;
  const text=(value,x,yy,size=10,f=font,color=ink)=>page.drawText(safe(value),{x,y:yy,size,font:f,color});
  const right=(value,x,yy,size=10,f=font,color=ink)=>text(value,x-f.widthOfTextAtSize(safe(value),size),yy,size,f,color);
  const wrap=(value,width,size=10,f=font)=>{
    const result=[];
    for(const paragraph of safe(value).split('\n')){
      let line='';
      for(const word of paragraph.split(/\s+/)){
        if(f.widthOfTextAtSize((line ? line+' ' : '')+word,size)<=width){line+=(line?' ':'')+word;continue;}
        if(line){result.push(line);line='';}
        for(const ch of word){if(f.widthOfTextAtSize(line+ch,size)>width){result.push(line);line='';}line+=ch;}
      }
      result.push(line);
    }
    return result;
  };
  const ensure=height=>{if(y-height<72){page=pdf.addPage([W,H]);y=H-48;text(`Нэхэмжлэх # ${m.number}`,L,y,12,bold);y-=30;}};
  const paragraph=(value,{x=L,width=R-L,size=10,f=font,color=ink,gap=14}={})=>{for(const line of wrap(value,width,size,f)){ensure(gap);text(line,x,y,size,f,color);y-=gap;}};
  const logo=await pdf.embedPng(id.logo), logoSize=logo.scaleToFit(178,60);
  page.drawImage(logo,{x:L-17,y:y-logoSize.height+18,width:logoSize.width,height:logoSize.height});
  right('Нэхэмжлэх',R,y-8,24);right(`# ${m.number}`,R,y-30,11,bold);
  y-=59;text(ISSUER.name,L,y,10,bold);
  if(m.status==='cancelled')right('ЦУЦЛАГДСАН',R,y,11,bold,rgb(.7,.1,.1));
  y-=16;paragraph(`РД: ${ISSUER.registration}`,{width:280,size:9,color:muted,gap:12});
  paragraph(ISSUER.address,{width:280,size:9,color:muted,gap:12});
  y-=m.totalCny == null ? 18 : 8;right(`Нэхэмжилсэн:  ${m.created}`,R,y,10);paragraph('Төлөгч байгууллага',{width:280});
  paragraph(m.agency,{width:280,f:bold});paragraph(`РД: ${m.registration}`,{width:280,size:9,color:muted});
  y-=m.totalCny == null ? 17 : 8;
  const header=()=>{ensure(29);page.drawRectangle({x:L,y:y-25,width:R-L,height:25,color:blue});text('#',L+11,y-16,9,font,rgb(1,1,1));text('Бараа & үйлчилгээ',L+38,y-16,9,font,rgb(1,1,1));right('Тоо',R-189,y-16,9,font,rgb(1,1,1));right('Нэгж үнэ',R-93,y-16,9,font,rgb(1,1,1));right('Нийт',R-8,y-16,9,font,rgb(1,1,1));y-=25;};
  header();
  for(const [index,[label,value]] of m.rows.entries()){
    const lines=wrap(label,210,9.5),height=Math.max(m.totalCny == null ? 32 : 44,lines.length*13+18);
    if(y-height<90){ensure(height+25);header();}
    text(String(index+1),L+11,y-18,9.5);lines.forEach((line,i)=>text(line,L+38,y-18-i*13,9.5));
    right('1',R-189,y-18,9.5);right(money(value),R-93,y-18,9.5);right(money(value),R-8,y-18,9.5);
    if(m.totalCny != null) { right(`CNY ${money(m.rowsCny[index])}`,R-93,y-32,8,font,muted);right(`CNY ${money(m.rowsCny[index])}`,R-8,y-32,8,font,muted); }
    y-=height;page.drawLine({start:{x:L,y},end:{x:R,y},thickness:.5,color:rule});
  }
  ensure(100);y-=m.totalCny == null ? 26 : 18;text('Нийт дүн',R-232,y,10);right(money(m.total),R-8,y,10);
  y-=m.totalCny == null ? 40 : 30;page.drawRectangle({x:R-256,y:y-12,width:256,height:m.totalCny == null ? 34 : 30,color:light});text('Эцсийн дүн',R-244,y,11,bold);right(`MNT ${money(m.total)}`,R-8,y,11,bold);
  y-=m.totalCny == null ? 36 : 28;
  if(m.totalCny != null) {
    paragraph(`Валютын дүн (CNY): ${money(m.totalCny)}`,{f:bold});
    paragraph(`Голомт бэлэн бус зарах: 1 CNY = ${money(m.rate)} MNT (${m.rateDate})`,{size:9,color:muted});
    paragraph(`MNT дүн нь ханшийн илэрхийлэл. Шилжүүлэх нийт дүн: ${money(m.totalCny)} CNY.`,{size:9,f:bold});
    paragraph('Цэнэглэх үйлчилгээний 3% буцаагдахгүй.',{size:9,color:muted});
    y-=6;
  }
  ensure(m.totalCny == null ? 160 : 85);
  paragraph(`Та төлбөрөө ${m.account.bank} дахь`);
  paragraph(`${m.account.iban} тоот дансанд шилжүүлнэ үү.`,{f:bold});
  paragraph(`Дансны нэр: ${m.account.name}`,{f:bold});
  y-=m.totalCny == null ? 9 : 4;paragraph(`Гүйлгээний утга: ${m.reference}`,{f:bold});
  if(m.note){y-=12;paragraph(`Тайлбар: ${m.note}`,{size:9,color:muted,gap:13});}
  y-=8;ensure(110);
  const putImage=async(item,x,top,maxWidth,maxHeight)=>{if(!item)return;const image=item.mime==='image/png'?await pdf.embedPng(item.bytes):await pdf.embedJpg(item.bytes);const size=image.scaleToFit(maxWidth,maxHeight);page.drawImage(image,{x,y:top-size.height,...size});};
  await putImage(id.stamp,L,y,105,90);await putImage(id.signature,L+148,y-14,130,55);
  page.drawLine({start:{x:L+137,y:y-76},end:{x:R-18,y:y-76},thickness:.5,color:rule});
  text(`Захирал${id.director ? ' / '+id.director : ''}`,L+137,y-94,10);
  const pages=pdf.getPages();
  for(const [index,item] of pages.entries()){
    page=item;page.drawLine({start:{x:L,y:49},end:{x:R,y:49},thickness:.5,color:rule});
    text('Гүйлгээний утгад байгууллагын регистр, нэхэмжлэхийн дугаарыг бичнэ үү.',L,35,8,font,muted);
    right(`${index+1} / ${pages.length}`,R,19,8,font,muted);
  }
  pdf.setTitle(`Нэхэмжлэх ${m.number}`);pdf.setAuthor(ISSUER.name);pdf.setCreator('NEXAHUB by Air Sales');
  return Buffer.from(await pdf.save());
}
