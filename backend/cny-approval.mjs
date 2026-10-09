import { HttpError } from './request-security.mjs';
import money from '../money-display.js';

export function approvalError(status, code, message) {
  return Object.assign(new HttpError(status, message), {code:'TOPUP_' + code});
}

export function verifiedReceipt(receipt = {}) {
  if (receipt.confirmed !== true) throw approvalError(400, 'CONFIRM_REQUIRED', 'Банкны орлогыг тулгаж баталгаажуулна уу.');
  const reference = typeof receipt.bankReference === 'string' ? receipt.bankReference.trim() : '';
  if (reference.length < 5 || reference.length > 200 || /[<>\u0000-\u001f\u007f]/.test(reference)) throw approvalError(400, 'REFERENCE_INVALID', 'Банкны гүйлгээний дугаар 5–200 тэмдэгттэй байх ёстой.');
  let cents;
  try { cents = money.integer(money.normalizeCnyInput(receipt.receivedCny), 2, 'received CNY'); }
  catch { throw approvalError(400, 'AMOUNT_INVALID', 'Бодитоор орсон NET CNY дүнг зөв оруулна уу (жишээ: 10,359.30).'); }
  if (cents <= 0n || cents > 300_000_000n) throw approvalError(400, 'AMOUNT_INVALID', 'Орсон NET CNY дүн зөвшөөрөгдөх хязгаараас гадуур байна.');
  return {reference, amount:Number(cents) / 100};
}

// Only exact known business failures are translated. Never expose provider details/hints.
export function approvalDatabaseError(data) {
  const failures = {
    'Active administrator and CNY funding migration required': [403, 'NOT_READY', 'Админы эрх эсвэл CNY цэнэглэх тохиргоог шалгана уу.'],
    'Verified bank reference and exact net CNY receipt required': [400, 'RECEIPT_INVALID', 'Банкны гүйлгээний дугаар болон NET CNY дүнг шалгана уу.'],
    'Invoice not found': [404, 'NOT_FOUND', 'Нэхэмжлэл олдсонгүй. Жагсаалтыг шинэчилнэ үү.'],
    'Receipt differs from the invoice; reconcile before credit': [409, 'AMOUNT_MISMATCH', 'Орсон NET CNY дүн нэхэмжлэлийн шилжүүлэх нийт дүнтэй таарахгүй байна. Wallet үндсэн дүн биш, нийт дүнгээр тулгана уу.'],
    'Receipt has already been recorded differently': [409, 'RECEIPT_CONFLICT', 'Энэ нэхэмжлэлийг өөр орлогын мэдээллээр өмнө нь баталгаажуулсан байна.'],
    'Invoice/agency is unavailable or has an unresolved payment': [409, 'UNAVAILABLE', 'Нэхэмжлэл pending биш, агентлаг идэвхгүй эсвэл шийдээгүй төлбөр байна. Эхлээд шалгана уу.']
  };
  if (data?.code === 'P0001' && Object.hasOwn(failures, data.message)) return approvalError(...failures[data.message]);
  if (data?.code === '23505') return approvalError(409, 'RECEIPT_DUPLICATE', 'Банкны гүйлгээ эсвэл нэхэмжлэлийг өмнө нь бүртгэсэн байна. Давхар орлого оруулахгүй.');
  if (data?.code === 'PGRST202') return approvalError(503, 'SCHEMA_UNAVAILABLE', 'CNY баталгаажуулах SQL функц эсвэл schema cache бэлэн биш байна. Админ тохиргоог шалгана уу.');
  return approvalError(503, 'SERVICE_UNAVAILABLE', 'Баталгаажуулах үйлчилгээний алдаа гарлаа. Орлого бүртгэгдсэн эсэхийг шалгаж, ижил гүйлгээний дугаартай дахин оролдоно уу.');
}
