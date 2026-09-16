/* อีเมลแจ้งลูกค้า (SMTP ผ่าน nodemailer)
   ตั้งค่าใน .env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM (ว่าง = ใช้ SMTP_USER)
   ไม่ตั้งค่า = ไม่ส่งจริง แต่บันทึกลง mail_log เป็น "logged" และพิมพ์ใน console (ใช้ทดสอบระบบได้)
   MAIL_TRANSPORT=json = ส่งผ่าน nodemailer แบบไม่ออกเครือข่าย (สำหรับ test) */
const nodemailer = require('nodemailer');

function config() {
  return {
    host: process.env.SMTP_HOST || '', port: parseInt(process.env.SMTP_PORT || '587', 10), user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '',
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true', from: process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@jianchatea.com',
  };
}
const isConfigured = () => { const c = config(); return Boolean(c.host && c.user && c.pass) || process.env.MAIL_TRANSPORT === 'json'; };

let _transport = null;
function transport() {
  if (_transport) return _transport;
  const c = config();
  _transport = process.env.MAIL_TRANSPORT === 'json' ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure || c.port === 465, auth: { user: c.user, pass: c.pass } });
  return _transport;
}

/** ส่งอีเมล → { status: 'sent' | 'logged' | 'failed', id, error } (ไม่ throw) */
async function sendMail({ to, subject, html, text, attachments = [] }) {
  if (!to) return { status: 'failed', error: 'no recipient' };
  if (!isConfigured()) { console.log(`[mail] (not configured) to=${to} subject=${subject}`); return { status: 'logged' }; }
  try {
    const info = await transport().sendMail({ from: config().from, to, subject, html, text, attachments });
    return { status: 'sent', id: info.messageId || '', message: info.message ? String(info.message) : '' };
  } catch (e) { console.error('[mail] send failed:', e.message); return { status: 'failed', error: String(e.message || e).slice(0, 300) }; }
}

module.exports = { sendMail, isConfigured, config };
