/* Slip verification via SlipOK (https://slipok.com) — same rules as slip-verify.js.
   Without SLIPOK_API_KEY the slip is NOT auto-approved: the order goes to "slip_uploaded" and finance confirms it. */
import { sha256hex } from './util.js';
const AMOUNT_TOLERANCE = 0.5, WINDOW_BEFORE_MIN = 5, WINDOW_AFTER_MIN = 24 * 60;
export const slipOkEnabled = (env) => Boolean((env.SLIPOK_API_KEY || '').trim());
function parseSlipDate(v) {
  if (v == null || v === '') return NaN;
  const s = String(v).trim();
  if (/^\d{8}$/.test(s)) return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00+07:00`).getTime();
  return new Date(s).getTime();
}
function checkTimeWindow(slipTransDate, orderCreatedAt) {
  const slipMs = parseSlipDate(slipTransDate);
  const orderMs = new Date(String(orderCreatedAt).replace(' ', 'T') + '+07:00').getTime();
  if (isNaN(slipMs) || isNaN(orderMs)) return { ok: true };
  if (slipMs < orderMs - WINDOW_BEFORE_MIN * 60000) return { ok: false, reason: 'สลิปโอนก่อนสร้างคำสั่งซื้อ (อาจเป็นสลิปเก่า)' };
  if (slipMs > orderMs + WINDOW_AFTER_MIN * 60000) return { ok: false, reason: 'วันที่บนสลิปเกินกำหนดชำระ' };
  return { ok: true };
}
async function slipOKVerify(env, bytes, type, expectedAmount) {
  const key = (env.SLIPOK_API_KEY || '').trim();
  const branch = (env.SLIPOK_BRANCH_ID || '').trim() || '0';
  const promptpayId = (env.PROMPTPAY_ID || '').replace(/[- ]/g, '');
  try {
    const form = new FormData(); form.append('files', new Blob([bytes], { type: type || 'image/jpeg' }), 'slip.jpg');
    const r = await fetch(`https://api.slipok.com/api/line/apikey/${branch}`, { method: 'POST', headers: { 'x-authorization': key }, body: form, signal: AbortSignal.timeout(parseInt(env.SLIPOK_TIMEOUT_MS || '20000', 10)) });
    if (!r.ok) return { verified: false, reason: `SlipOK API error: ${r.status}` };
    const data = await r.json();
    if (!data.success) return { verified: false, reason: data.message || 'SlipOK: อ่านสลิปไม่ได้' };
    const slip = data.data || {};
    const amount = parseFloat(slip.amount) || 0;
    const proxy = String(slip.receiver?.proxy?.value || '').replace(/[- ]/g, '');
    const amountOk = Math.abs(amount - expectedAmount) < AMOUNT_TOLERANCE;
    const receiverOk = !promptpayId || !proxy || proxy.includes(promptpayId) || promptpayId.includes(proxy);
    let reason = '';
    if (!amountOk) reason = `ยอดไม่ตรง: สลิป ${amount.toFixed(2)} ≠ คำสั่งซื้อ ${expectedAmount.toFixed(2)}`;
    if (!receiverOk) reason += (reason ? ' | ' : '') + 'ผู้รับเงินไม่ตรง';
    return { verified: amountOk && receiverOk, amount, ref: slip.transRef || '', transDate: slip.transTimestamp || slip.transDate || '', reason: reason || 'ตรวจสอบผ่าน' };
  } catch (e) { return { verified: false, reason: `SlipOK error: ${e.message}` }; }
}
/** @returns {{verified, manual, reason, slip_hash, ref?, amount?}} manual=true → finance must confirm */
export async function verifySlip(env, bytes, type, expectedAmount, { orderCreatedAt, isDuplicate } = {}) {
  const slip_hash = await sha256hex(bytes);
  if (isDuplicate && await isDuplicate({ hash: slip_hash })) return { verified: false, manual: false, reason: 'ภาพสลิปนี้เคยถูกใช้แล้ว', slip_hash };
  if (!slipOkEnabled(env)) return { verified: false, manual: true, reason: 'รอเจ้าหน้าที่ตรวจสอบสลิป', slip_hash };
  const core = await slipOKVerify(env, bytes, type, expectedAmount);
  core.slip_hash = slip_hash; core.manual = false;
  if (!core.verified) return core;
  if (isDuplicate && core.ref && await isDuplicate({ ref: core.ref })) return { ...core, verified: false, reason: `สลิปนี้ (ref ${core.ref}) ถูกใช้แล้ว` };
  if (orderCreatedAt && core.transDate) { const tw = checkTimeWindow(core.transDate, orderCreatedAt); if (!tw.ok) return { ...core, verified: false, reason: tw.reason }; }
  return core;
}
