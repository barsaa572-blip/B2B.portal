import './support/html-vm.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {PDFDocument} from 'pdf-lib';
import {invoiceModel, invoiceHtml, invoicePdf, PAYMENT_ACCOUNT} from '../backend/topup-invoice.mjs';
const invoice={invoice_number:'INV-TEST',created_at:'2026-09-29T17:00:00Z',agencyName:'ЭЙР СЭЛС ТЕСТ',agencyRegistrationNumber:'0000000',
 amount_mnt:1000000,amount_cny:1858.39,service_fee_mnt:30000,correspondent_fee_mnt:26905,bank_transfer_fee_mnt:5000,total_mnt:1061905,status:'pending'};
const unsigned={stampPath:'',signaturePath:'',directorName:''};

test('top-up credit is displayed truncated to one decimal without changing wallet cents',()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('const topupCreditText ='),source.indexOf('const walletEntryLabel ='));
 const ctx=vm.createContext({});vm.runInContext(code+';globalThis.format=topupCreditText;',ctx);
 assert.equal(ctx.format(1858.391),'¥ 1,858.3');assert.equal(ctx.format(1858.39),'¥ 1,858.3');
 assert.equal(ctx.format(1000),'¥ 1,000.0');assert.equal(ctx.format(0),'¥ 0.0');
 assert.match(source,/Wallet credit: <strong>\$\{topupCreditText\(walletCny\)\}/);
 assert.doesNotMatch(source,/Голомт Банкны шимтгэл/);
 assert.doesNotMatch(readFileSync(new URL('../index.html',import.meta.url),'utf8'),/A pending MNT payment invoice is created immediately/);
 assert.equal(invoice.amount_cny,1858.39);
});

test('invoice uses saved fees, local invoice date and supplied bank account without new VAT',()=>{
 const model=invoiceModel(invoice);
 assert.equal(model.created,'2026.09.30');assert.equal(model.total,1061905);
 assert.equal(model.rows.reduce((sum,row)=>sum+row[1],0),model.total);
 assert.equal(model.rows[3][0],'Банкны шимтгэл');
 assert.equal(PAYMENT_ACCOUNT.iban,'MN240015001605336658');assert.equal(PAYMENT_ACCOUNT.name,'ЭЙР СЭЛС');
 assert.equal(invoiceModel({...invoice,total_mnt:1062000}).total,1062000);
 assert.throws(()=>invoiceModel({...invoice,amount_mnt:NaN}));
});

test('HTML invoice escapes customer text and never copies CallPro stamp or unsupported terms',async()=>{
 const html=await invoiceHtml({...invoice,agencyName:'<script>alert(1)</script>',note:'<img src=x onerror=alert(1)>'},unsigned);
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|onerror=alert\(1\)>/);
 assert.match(html,/MN240015001605336658/);assert.match(html,/1,061,905.00/);
 assert.match(html,/#0b2f5b/);
 assert.doesNotMatch(html,/ЗАГВАР НЭХЭМЖЛЭХ|БОДИТ ТӨЛБӨР БҮҮ|INV-DEMO|agency@example.com/);
 assert.doesNotMatch(html,/CallPro|КоллПро|Батмарал|НӨАТ|0.3 хувь|Эцсийн хугацаа/);
 assert.doesNotMatch(html,/<img class="stamp"|<img class="signature"/);
});

test('download is a real A4 PDF with embedded fonts and can paginate long notes',async()=>{
 const bytes=await invoicePdf(invoice,unsigned);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 const pdf=await PDFDocument.load(bytes);assert.equal(pdf.getPageCount(),1);
 assert.ok(Math.abs(pdf.getPage(0).getWidth()-595.28)<1);
 assert.equal(pdf.getAuthor(),'ЭЙР СЭЛС ХХК');
 const html=await invoiceHtml(invoice,unsigned);
 assert.match(html,/ЭЙР СЭЛС ХХК/);assert.match(html,/РД: 6876242/);
 assert.match(html,/Сүхбаатар дүүрэг, 2-р хороо, Нарны зам 25-102/);
 const long=await PDFDocument.load(await invoicePdf({...invoice,note:'Урт тайлбар болон байгууллагын мэдээлэл. '.repeat(100)},unsigned));
 assert.ok(long.getPageCount()>1);
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 assert.match(source,/api\/invoices\/\$\{id\}\?format=pdf/);assert.match(source,/link.download = `\$\{number\}.pdf`/);
});
