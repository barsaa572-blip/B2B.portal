// Local sample only. Does not create an invoice, booking or wallet transaction.
import { mkdir, writeFile } from 'node:fs/promises';
import { invoicePdf, invoiceHtml } from '../backend/topup-invoice.mjs';
const sample={invoice_number:'INV-DEMO-1000000',created_at:'2026-09-30T04:00:00Z',status:'pending',
  agencyName:'ЖИШЭЭ АГЕНТ ХХК',agencyRegistrationNumber:'0000000',agencyAddress:'Монгол Улс, Улаанбаатар хот',
  agencyEmail:'agency@example.com',agencyPhone:'00000000',amount_mnt:1000000,amount_cny:1858.39,
  service_fee_mnt:30000,correspondent_fee_mnt:26905,bank_transfer_fee_mnt:5000,total_mnt:1061905,
  note:'ЗАГВАР НЭХЭМЖЛЭХ - БОДИТ ТӨЛБӨР БҮҮ ХИЙГЭЭРЭЙ.'};
await mkdir(new URL('../output/pdf/',import.meta.url),{recursive:true});
await mkdir(new URL('../tmp/pdfs/',import.meta.url),{recursive:true});
const identity = process.argv.includes('--with-artwork') ? {
  stampPath:new URL('../private/invoice/stamp.png',import.meta.url),
  signaturePath:new URL('../private/invoice/signature.png',import.meta.url),
  directorName:'Д.Барсболд'
} : {stampPath:'',signaturePath:'',directorName:'Д.Барсболд'};
await writeFile(new URL('../output/pdf/NEXAHUB-invoice-preview.pdf',import.meta.url),await invoicePdf(sample,identity));
await writeFile(new URL('../tmp/pdfs/invoice-preview.html',import.meta.url),await invoiceHtml(sample,identity));
console.log('Created sample PDF and HTML preview; no live financial writes.');
