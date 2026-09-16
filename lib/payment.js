/* วิธีรับเงินของร้าน (อ่านจากตัวแปรแวดล้อม) — ใช้ทั้ง server.js และ worker
   แบบโอนเข้าบัญชีธนาคาร: BANK_NAME + BANK_ACCOUNT_NAME + BANK_ACCOUNT_NO (ลูกค้าเห็นเลขบัญชี + ยอดที่ต้องโอน แล้วแนบสลิป)
   แบบ PromptPay QR:     PROMPTPAY_ID หรือ PROMPTPAY_QR_PAYLOAD (หน้า pay แสดง QR ตามยอด)
   ตั้งทั้งสองแบบ = ใช้บัญชีธนาคาร */
const s = (v) => String(v || '').trim();
function bankAccount(env) {
  const account_no = s(env.BANK_ACCOUNT_NO).replace(/[^\d-]/g, '');
  if (!account_no) return null;
  return { bank: s(env.BANK_NAME) || 'ธนาคาร', account_name: s(env.BANK_ACCOUNT_NAME), account_no, branch: s(env.BANK_BRANCH) };
}
const promptPayConfigured = (env) => Boolean(s(env.PROMPTPAY_QR_PAYLOAD) || s(env.PROMPTPAY_ID));
/** 'bank' | 'promptpay' | '' (ยังไม่ได้ตั้งค่า) */
const paymentMode = (env) => (bankAccount(env) ? 'bank' : (promptPayConfigured(env) ? 'promptpay' : ''));
module.exports = { bankAccount, promptPayConfigured, paymentMode };
