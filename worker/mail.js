/* อีเมลถึงลูกค้า — เลือกช่องทางจากตัวแปรใน Cloudflare Pages (ตรวจตามลำดับ)
   1) Microsoft 365 (Graph API): MS_TENANT_ID + MS_CLIENT_ID + MS_CLIENT_SECRET + MAIL_FROM (กล่องจดหมายผู้ส่ง เช่น no-reply@jianchatea.com)
   2) Resend (HTTP API): RESEND_API_KEY + MAIL_FROM
   ไม่ตั้งค่า = ไม่ส่งจริง บันทึก mail_log เป็น "logged"; MAIL_TRANSPORT=json = จำลองว่าส่งแล้ว (ใช้ทดสอบ) */
const trim = (v) => String(v || '').trim();
const graphConfigured = (env) => Boolean(trim(env.MS_TENANT_ID) && trim(env.MS_CLIENT_ID) && trim(env.MS_CLIENT_SECRET));
export const mailConfigured = (env) => graphConfigured(env) || Boolean(trim(env.RESEND_API_KEY)) || env.MAIL_TRANSPORT === 'json';
const DEFAULT_FROM = 'JIANCHA Order <no-reply@jianchatea.com>';
/* "JIANCHA Order <no-reply@jianchatea.com>" → { name, address } */
export function parseFrom(v) {
  const s = trim(v) || DEFAULT_FROM; const m = s.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>$/);
  return m ? { name: m[1].trim().replace(/^"|"$/g, ''), address: m[2] } : { name: '', address: s };
}

/* ── Microsoft Graph: client credentials (สิทธิ์ Mail.Send แบบ Application) → POST /users/{sender}/sendMail ── */
let graphToken = null;   // { value, exp } ต่อ isolate
async function graphAccessToken(env) {
  if (graphToken && graphToken.exp > Date.now() + 60_000) return graphToken.value;
  const url = trim(env.MS_TOKEN_URL) || `https://login.microsoftonline.com/${encodeURIComponent(trim(env.MS_TENANT_ID))}/oauth2/v2.0/token`;
  const form = new URLSearchParams({ client_id: trim(env.MS_CLIENT_ID), client_secret: trim(env.MS_CLIENT_SECRET), scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error('Microsoft token: ' + String(data.error_description || data.error || `HTTP ${r.status}`).split('\n')[0].slice(0, 200));
  graphToken = { value: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return graphToken.value;
}
async function sendViaGraph(env, { to, subject, html, text }) {
  const from = parseFrom(env.MAIL_FROM);
  const token = await graphAccessToken(env);
  const base = trim(env.MS_GRAPH_URL) || 'https://graph.microsoft.com/v1.0';
  const message = { subject, body: { contentType: 'HTML', content: html || text || '' }, toRecipients: [{ emailAddress: { address: to } }] };
  if (from.name) message.from = { emailAddress: { address: from.address, name: from.name } };
  const r = await fetch(`${base}/users/${encodeURIComponent(from.address)}/sendMail`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ message, saveToSentItems: false }) });
  if (r.status === 202 || r.ok) return { status: 'sent', id: r.headers.get('request-id') || 'graph' };
  if (r.status === 401) graphToken = null;   // token ใช้ไม่ได้แล้ว → ขอใหม่ครั้งหน้า
  const data = await r.json().catch(() => ({}));
  return { status: 'failed', error: String((data.error && (data.error.message || data.error.code)) || `HTTP ${r.status}`).slice(0, 300) };
}

/* ── Resend ── */
async function sendViaResend(env, { to, subject, html, text }) {
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${trim(env.RESEND_API_KEY)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: trim(env.MAIL_FROM) || DEFAULT_FROM, to: [to], subject, html, text }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return { status: 'failed', error: String(data.message || data.error || `HTTP ${r.status}`).slice(0, 300) };
  return { status: 'sent', id: data.id || '' };
}

export async function sendMail(env, msg) {
  if (!msg.to) return { status: 'failed', error: 'no recipient' };
  if (env.MAIL_TRANSPORT === 'json') return { status: 'sent', id: 'json' };
  try {
    if (graphConfigured(env)) return await sendViaGraph(env, msg);
    if (trim(env.RESEND_API_KEY)) return await sendViaResend(env, msg);
  } catch (e) { return { status: 'failed', error: String(e.message || e).slice(0, 300) }; }
  console.log(`[mail] (not configured) to=${msg.to} subject=${msg.subject}`); return { status: 'logged' };
}
