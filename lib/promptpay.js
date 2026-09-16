/* PromptPay / Thai-QR (EMVCo) payload — pure, shared by qr.js (Node) and the Cloudflare worker */
function crc16(s) {
  let c = 0xffff;
  for (let i = 0; i < s.length; i++) {
    c ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) c = (c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1) & 0xffff;
  }
  return c.toString(16).toUpperCase().padStart(4, '0');
}
const tag = (t, v) => t + String(v.length).padStart(2, '0') + v;
/** Static Thai-QR payload of the shop → dynamic one with this order's amount (tag 01 -> 12, tag 54, CRC) */
function injectAmount(base, amount) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error(`invalid QR amount: ${amount}`);
  const tags = {};
  for (let i = 0; i < base.length;) {
    const t = base.slice(i, i + 2);
    const l = parseInt(base.slice(i + 2, i + 4), 10);
    tags[t] = base.slice(i + 4, i + 4 + l);
    i += 4 + l;
  }
  tags['01'] = '12';
  tags['54'] = amt.toFixed(2);
  delete tags['63'];
  const body = Object.keys(tags).sort().map((t) => tag(t, tags[t])).join('') + '6304';
  return body + crc16(body);
}
/** PromptPay QR for a phone number (10 digits), national id / tax id (13 digits) or e-wallet id (15 digits) */
function promptPayPayload(id, amount) {
  const digits = String(id || '').replace(/\D/g, '');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error(`invalid QR amount: ${amount}`);
  let type, target;
  if (digits.length === 15) { type = '03'; target = digits; }
  else if (digits.length === 13) { type = '02'; target = digits; }
  else { type = '01'; target = ('0066' + digits.replace(/^0/, '').replace(/^66/, '')).padEnd(13, '0').slice(0, 13); }
  const merchant = tag('00', 'A000000677010111') + tag(type, target);
  const body = tag('00', '01') + tag('01', '12') + tag('29', merchant) + tag('53', '764') + tag('54', amt.toFixed(2)) + tag('58', 'TH') + '6304';
  return body + crc16(body);
}
/** Payload for the configured shop: PROMPTPAY_QR_PAYLOAD (static Thai-QR) wins over PROMPTPAY_ID */
function paymentPayload({ promptpayId = '', staticPayload = '' }, amount) {
  return staticPayload.trim() ? injectAmount(staticPayload.trim(), amount) : promptPayPayload(promptpayId.trim() || '0000000000', amount);
}
module.exports = { crc16, injectAmount, promptPayPayload, paymentPayload };
