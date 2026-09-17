/* ส่งอีเมลยืนยันตัวอย่างไปยังที่อยู่ที่ระบุ เพื่อทดสอบการตั้งค่า SMTP ใน .env
   ใช้: node scripts/send-test-mail.js someone@example.com */
require('dotenv').config();
const to = process.argv[2];
if (!to) { console.error('usage: node scripts/send-test-mail.js <email>'); process.exit(1); }
process.env.DB_PATH = process.env.DB_PATH || require('path').join(require('os').tmpdir(), 'jc-mail-test.db');
const app = require('../server');
const mailer = require('../mailer');
const o = { order_number: '2026091800042', total: 1117, store_name: 'JIANCHA - Siam Paragon', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', phone: '0812345678', note: 'หวานน้อย',
  lines: [
    { name: 'SET A · MOONLIT RUBY FRESH SET', quantity: 2, line_total: 738, items: [{ name_en: 'Mooncake' }, { name_en: 'Snowy Mooncake' }, { name_en: 'Pomegranate Iced Tea with Grape' }] },
    { name: 'SET B · MOONLIT RUBY SMOOTHIE SET', quantity: 1, line_total: 379, items: [{ name_en: 'Mooncake' }, { name_en: 'Snowy Mooncake' }, { name_en: 'Pomegranate Tea Smoothie with Grape' }] },
  ] };
const mail = app.locals.approvalEmail(o, { name: 'JIANCHA x NAVORI', slug: 'jianchaxnavori' }, (process.env.PUBLIC_BASE_URL || 'https://order.jianchatea.com').replace(/\/+$/, ''));
(async () => {
  if (!mailer.isConfigured()) { console.error('SMTP ยังไม่ได้ตั้งค่า (SMTP_HOST / SMTP_USER / SMTP_PASS ใน .env)'); process.exit(2); }
  const r = await mailer.sendMail({ to, subject: '[ทดสอบ] ' + mail.subject, html: mail.html, text: mail.text, attachments: mail.attachments });
  console.log(r.status === 'sent' ? `ส่งแล้ว → ${to} (${r.id})` : `ส่งไม่สำเร็จ: ${r.error}`);
  process.exit(r.status === 'sent' ? 0 : 1);
})();
