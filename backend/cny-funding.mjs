import { randomBytes } from 'node:crypto';
import money from '../money-display.js';
export const CNY_PAYMENT_ACCOUNT = Object.freeze({ bank: 'Голомт банк', iban: 'MN940015001605336659', name: 'ЭЙР СЭЛС', currency: 'CNY' });
export function fundingQuote(amountCny, rate) {
  const principal = money.integer(amountCny, 2, 'CNY funding amount');
  if (principal <= 0n || principal > 200_000_000n) throw new Error('Supply a CNY amount between 0.01 and 2,000,000.00.');
  const fx = money.integer(rate?.nonCashSellMnt, 6, 'Golomt sell rate');
  const day = rate?.fundingRateDate;
  const date = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(day+'T00:00:00Z') : null;
  if (fx <= 0n || fx > 1_000_000_000_000n || !date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== day) throw new Error('Dated Golomt sell rate required.');
  const service = (principal * 3n + 50n) / 100n;
  const correspondent = principal <= 10_000_000n ? 5_000n : 15_000n;
  const tariffMnt = principal <= 5_000_000n ? 5000 : principal <= 10_000_000n ? 10000 : 20000;
  // Cover the MNT-denominated bank tariff in exact CNY cents, never reduce the
  // wallet principal to pay fees. MNT rounding remains presentation only.
  const bank = (BigInt(tariffMnt) * 100n * 1_000_000n + fx - 1n) / fx;
  const line = (label, cents) => ({ label, amountCny: Number(cents) / 100,
    amountMnt: money.roundMnt(Number(cents) / 100, rate.nonCashSellMnt) });
  const rows = [line('Wallet цэнэглэлт', principal), line('Үйлчилгээний хөлс (3%)', service),
    line('Корреспондент банкны шимтгэл (OUR)', correspondent), line('Банкны шимтгэл', bank)];
  return { version: 1, model: 'cny-funding-v1', transferCurrency: 'CNY',
    principalCny: Number(principal) / 100, serviceFeePercent: 3, serviceFeeCny: Number(service) / 100,
    correspondentFeeCny: Number(correspondent) / 100, bankFeeCny: Number(bank) / 100,
    bankTariffMnt: tariffMnt, totalCny: Number(principal + service + correspondent + bank) / 100,
    totalMnt: rows.reduce((sum, row) => sum + row.amountMnt, 0),
    rateMnt: Number(rate.nonCashSellMnt), rateDate: rate.fundingRateDate,
    account: { ...CNY_PAYMENT_ACCOUNT }, rows };
}
export const invoiceNumber = () => `INV-${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '')}-${randomBytes(5).toString('hex').toUpperCase()}`;
