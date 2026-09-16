/**
 * PromptPay / Thai-QR payment generator (payload in lib/promptpay.js, shared with the Cloudflare worker).
 *  1. PROMPTPAY_QR_PAYLOAD set — take the merchant's static Thai-QR payload and
 *     make it dynamic with the order amount (tag 01 -> 12, tag 54 amount, CRC).
 *  2. Otherwise generate a plain PromptPay QR from PROMPTPAY_ID.
 */
const QRCode = require('qrcode');
const { injectAmount, paymentPayload } = require('./lib/promptpay');

function isConfigured() {
  return Boolean((process.env.PROMPTPAY_QR_PAYLOAD || '').trim() || (process.env.PROMPTPAY_ID || '').trim());
}

async function generateQR(amount) {
  const payload = paymentPayload({ promptpayId: process.env.PROMPTPAY_ID || '', staticPayload: process.env.PROMPTPAY_QR_PAYLOAD || '' }, amount);
  return QRCode.toDataURL(payload, { width: 400, margin: 2, color: { dark: '#000', light: '#fff' } });
}

module.exports = { generateQR, injectAmount, isConfigured };
