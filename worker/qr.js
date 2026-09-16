/* PromptPay QR as an SVG data URL (qrcode's pure-JS core, no canvas/png) */
import QRCore from 'qrcode/lib/core/qrcode.js';
import SvgTag from 'qrcode/lib/renderer/svg-tag.js';
import { paymentPayload } from '../lib/promptpay.js';
export const qrConfigured = (env) => Boolean((env.PROMPTPAY_QR_PAYLOAD || '').trim() || (env.PROMPTPAY_ID || '').trim());
export function generateQR(env, amount) {
  const payload = paymentPayload({ promptpayId: env.PROMPTPAY_ID || '', staticPayload: env.PROMPTPAY_QR_PAYLOAD || '' }, amount);
  const svg = SvgTag.render(QRCore.create(payload, { errorCorrectionLevel: 'M' }), { width: 400, margin: 2, color: { dark: '#000000ff', light: '#ffffffff' } });
  return 'data:image/svg+xml;base64,' + btoa(svg);
}
