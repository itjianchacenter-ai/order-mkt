/* อีเมลถึงลูกค้าผ่าน Resend (HTTP API) — ตั้ง RESEND_API_KEY + MAIL_FROM ใน Cloudflare Pages
   ไม่ตั้งค่า = ไม่ส่งจริง บันทึก mail_log เป็น "logged"; MAIL_TRANSPORT=json = จำลองว่าส่งแล้ว (ใช้ทดสอบ) */
export const mailConfigured = (env) => Boolean((env.RESEND_API_KEY || '').trim()) || env.MAIL_TRANSPORT === 'json';
export async function sendMail(env, { to, subject, html, text }) {
  if (!to) return { status: 'failed', error: 'no recipient' };
  if (env.MAIL_TRANSPORT === 'json') return { status: 'sent', id: 'json' };
  if (!(env.RESEND_API_KEY || '').trim()) { console.log(`[mail] (not configured) to=${to} subject=${subject}`); return { status: 'logged' }; }
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || 'JIANCHA Order <no-reply@jianchatea.com>', to: [to], subject, html, text }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { status: 'failed', error: String(data.message || data.error || `HTTP ${r.status}`).slice(0, 300) };
    return { status: 'sent', id: data.id || '' };
  } catch (e) { return { status: 'failed', error: String(e.message || e).slice(0, 300) }; }
}
