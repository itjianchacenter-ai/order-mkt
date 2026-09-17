/* /api/* of the ordering system on Cloudflare (Pages Functions + D1 + R2). Same contract as server.js so public/*.html work unchanged. */
import { json, fail, HttpError, signToken, verifyToken, hashPassword, checkPassword, parseCookies, cookie, sql, uuid, randomHex, randomInt } from './util.js';
import { MENU, STORES } from './data.js';
import { generateQR } from './qr.js';
import { bankAccount, paymentMode } from '../lib/payment.js';
const qrConfigured = (env) => Boolean(paymentMode(env));
import { sendMail } from './mail.js';
import { verifySlip, slipOkEnabled } from './slip.js';
import { putFile, getFile, deleteFile, fileMax, usingR2 } from './files.js';
import { wipeOrders } from './reset.js';
import * as M from '../lib/menu.js';
import * as W from '../lib/window.js';
import { approvalEmail, issueEmail, rejectEmail, normalizeEmail, validEmail } from '../lib/email.js';

const CUSTOMER_COOKIE = 'jc_cid', ADMIN_COOKIE = 'jc_admin';
const YEAR = 365 * 24 * 3600;
const secretOf = (env) => (env.JWT_SECRET || '').trim() || 'dev-secret-order-jianchatea';
const baseUrlOf = (c) => ((c.env.PUBLIC_BASE_URL || '').trim() || c.url.origin).replace(/\/+$/, '');
const now = () => W.bangkokNow();
// วันของรอบสั่ง: วันนี้ (เวลาไทย) หรือรอบวันแรกเมื่ออยู่ในช่วงเปิดล่วงหน้า ORDER_EARLY_HOURS ชั่วโมงก่อนวันแรก (x-test-day ใช้เฉพาะ TEST_MODE)
const todayOf = (c, menu) => W.effectiveOrderDay(menu ? menu.order_days : MENU.order_days, { override: c.env.TEST_MODE ? (c.req.headers.get('x-test-day') || c.env.ORDER_DAY_OVERRIDE) : c.env.ORDER_DAY_OVERRIDE, earlyHours: parseFloat(c.env.ORDER_EARLY_HOURS || '0') || 0 });

// ─── campaigns ───
const campaignDesign = (c) => M.campaignDesign(c, MENU);
const menuFor = (c) => M.menuFor(c, MENU);
async function activeCampaign(db) {
  return (await db.get('SELECT * FROM campaigns WHERE active = 1 ORDER BY created_at LIMIT 1')) || (await db.get('SELECT * FROM campaigns ORDER BY created_at LIMIT 1'));
}
const getCampaign = (db, id) => db.get('SELECT * FROM campaigns WHERE id = ?', id);
/** Campaign by its customer URL slug (order.jianchatea.com/<slug>/); also accepts the id for older links. */
export async function campaignBySlug(db, slug) {
  const s = M.slugOf(slug); if (!s) return null;
  return (await db.get('SELECT * FROM campaigns WHERE slug = ?', s)) || (await db.get("SELECT * FROM campaigns WHERE lower(replace(id, '-', '')) = ?", s)) || null;
}
/** The campaign a customer request is about: ?campaign=<slug> / body.campaign, otherwise the active one. */
async function requestCampaign(c, body) {
  const s = c.url.searchParams.get('campaign') || (body && body.campaign) || '';
  return (s && await campaignBySlug(c.db, s)) || activeCampaign(c.db);
}
function campaignView(c) {
  const d = campaignDesign(c);
  return { id: c.id, slug: c.slug, url: `/${c.slug}/`, name: c.name, active: Boolean(c.active), orders_open: c.orders_open !== 0, stock: { total: c.stock_total, drink: c.stock_drink, dessert: c.stock_dessert }, promo_code: M.promoRangeView(c), created_at: c.created_at,
    cover: d.promote_images[0] || '', set_count: d.sets.filter((x) => x.active).length, has_design: Boolean(c.design_json) };
}
const campaignPublic = (c) => ({ id: c.id, slug: c.slug, url: `/${c.slug}/`, name: c.name, active: Boolean(c.active), orders_open: c.orders_open !== 0 });
const SETS_SUM = 'COALESCE(SUM(l.quantity * COALESCE(l.pieces, 1)), 0) AS n';
const HOLD_USAGE_SQL = 'SELECT COALESCE(SUM(sets), 0) AS total, COALESCE(SUM(drink), 0) AS drink, COALESCE(SUM(dessert), 0) AS dessert FROM holds WHERE campaign_id = ? AND expires_at > ?';
const holdMinutes = (env) => Math.max(1, Number(env.HOLD_MINUTES) || 15);   // เวลาจองคิวหลังกด Confirm (นาที)
const USAGE_SQL = `SELECT COALESCE(SUM(l.quantity * COALESCE(l.pieces, 1)), 0) AS total, COALESCE(SUM(l.quantity * COALESCE(l.drink_pieces, 0)), 0) AS drink, COALESCE(SUM(l.quantity * COALESCE(l.dessert_pieces, 0)), 0) AS dessert
  FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.status <> 'cancelled' AND o.campaign_id = ?`;
/* stock/order-window ของแคมเปญ cache ในหน่วยความจำของ isolate สั้น ๆ (ค่าเริ่มต้น 5 วินาที; STOCK_CACHE_MS=0 = ปิด, ปิดอัตโนมัติใน TEST_MODE)
   → ผู้เข้าชมพร้อมกันหลายพันคนใช้ผลอ่านฐานข้อมูลชุดเดียวกัน ไม่กระทบความถูกต้อง: โควตา/สต๊อกจริงตรวจซ้ำใน transaction ตอนบันทึกออเดอร์เสมอ */
const stockCache = new Map();
const stockCacheMs = (env) => (env.TEST_MODE === '1' ? 0 : (env.STOCK_CACHE_MS != null && env.STOCK_CACHE_MS !== '' ? Math.max(0, Number(env.STOCK_CACHE_MS) || 0) : 5000));
const stockCacheKey = (c, camp) => `${camp.id}|${c.req.headers.get('x-test-day') || ''}|${camp.stock_total}|${camp.stock_drink}|${camp.stock_dessert}|${camp.design_json ? camp.design_json.length : 0}`;
async function stockView(c, camp) {
  const ttl = stockCacheMs(c.env); const key = stockCacheKey(c, camp);
  if (ttl > 0) { const hit = stockCache.get(key); if (hit && hit.exp > Date.now()) return hit.value; }
  const limits = { total: camp.stock_total, drink: camp.stock_drink, dessert: camp.stock_dessert };
  const o = await c.db.get(USAGE_SQL, camp.id);
  const h = await c.db.get(HOLD_USAGE_SQL, camp.id, now());   // คิวที่จองไว้ (รอชำระเงิน) นับเป็นใช้แล้ว
  const used = { total: o.total + h.total, drink: o.drink + h.drink, dessert: o.dessert + h.dessert }; const remaining = {};
  for (const k of ['total', 'drink', 'dessert']) remaining[k] = limits[k] == null ? null : Math.max(0, limits[k] - used[k]);
  const value = { limits, used: { drink: used.drink, dessert: used.dessert, total: used.total, held: h.total }, remaining, sold_out: ['total', 'drink', 'dessert'].some((k) => remaining[k] === 0), order_window: await orderWindow(c, camp) };
  if (ttl > 0) stockCache.set(key, { value, exp: Date.now() + ttl });
  return value;
}
const invalidateStock = () => stockCache.clear();   // หลังบันทึก/ยกเลิก/ล้างออเดอร์ใน isolate นี้ → ผู้สั่งเห็นตัวเลขใหม่ทันที
async function orderWindow(c, camp) {
  const menu = menuFor(camp); const days = menu.order_days || []; const today = todayOf(c, menu);
  // โควตาต่อวันนับเป็น "ชุด" (quantity × pieces) ไม่ใช่จำนวนออเดอร์
  const today_count = (await c.db.get(`SELECT ${SETS_SUM} FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.campaign_id = ? AND o.order_day = ? AND o.status <> 'cancelled'`, camp.id, today)).n;
  const total_count = days.length ? (await c.db.get(`SELECT ${SETS_SUM} FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.campaign_id = ? AND o.status <> 'cancelled' AND o.order_day IN (${days.map(() => '?').join(',')})`, camp.id, ...days)).n : today_count;
  // คิวที่จองไว้ระหว่างรอชำระเงิน (ยังไม่หมดอายุ) หักโควตาด้วย
  const ts = now();
  const today_held = (await c.db.get('SELECT COALESCE(SUM(sets), 0) AS n FROM holds WHERE campaign_id = ? AND order_day = ? AND expires_at > ?', camp.id, today, ts)).n;
  const total_held = days.length ? (await c.db.get(`SELECT COALESCE(SUM(sets), 0) AS n FROM holds WHERE campaign_id = ? AND expires_at > ? AND order_day IN (${days.map(() => '?').join(',')})`, camp.id, ts, ...days)).n : today_held;
  return { ...W.computeOrderWindow(menu, today, { today_count: today_count + today_held, total_count: total_count + total_held }), today_held };
}

// ─── customers (anonymous cookie per browser; Google account once signed in) ───
const customerRow = (db, id) => db.get('SELECT id, google_sub, email, name, picture, pdpa_accepted_at FROM customers WHERE id = ?', id);
const loginRequired = (env) => Boolean((env.GOOGLE_CLIENT_ID || '').trim());
async function customerLoggedIn(c) { const r = await customerRow(c.db, c.customerId); return Boolean(r && r.google_sub); }
async function meView(c, id = c.customerId) {
  const r = await customerRow(c.db, id); const logged_in = Boolean(r && r.google_sub);
  return { logged_in, login_required: loginRequired(c.env), google_client_id: (c.env.GOOGLE_CLIENT_ID || '').trim(), email: logged_in ? r.email : '', name: logged_in ? r.name : '', picture: logged_in ? r.picture : '', pdpa_accepted_at: (r && r.pdpa_accepted_at) || '' };
}
const touchCustomerStmt = (db, id) => db.stmt('INSERT INTO customers(id, created_at, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at', id, now(), now());
const linkCampaignStmt = (db, customerId, campaignId) => db.stmt('INSERT INTO customer_campaigns(customer_id, campaign_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT(customer_id, campaign_id) DO UPDATE SET last_seen_at = excluded.last_seen_at', customerId, campaignId, now(), now());
async function setCustomerCookie(c, cid) { c.cookies.push(cookie(CUSTOMER_COOKIE, await signToken({ cid }, secretOf(c.env)), { maxAge: YEAR, secure: c.secure })); c.customerId = cid; }
// ตรวจ ID token กับ Google (tokeninfo ตรวจลายเซ็นให้) แล้วเช็ค aud/iss/exp/email_verified เอง
async function verifyGoogleToken(env, credential) {
  if (!credential || typeof credential !== 'string' || credential.length > 4096) throw new Error('bad credential');
  const url = (env.GOOGLE_TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo') + '?id_token=' + encodeURIComponent(credential);
  const r = await fetch(url); const p = await r.json().catch(() => null);
  if (!r.ok || !p || !p.sub) throw new Error('token rejected');
  if (p.aud !== (env.GOOGLE_CLIENT_ID || '').trim()) throw new Error('aud mismatch');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(p.iss)) throw new Error('iss mismatch');
  if (Number(p.exp) * 1000 < Date.now()) throw new Error('expired');
  if (String(p.email_verified) !== 'true') throw new Error('email not verified');
  return { sub: p.sub, email: p.email, name: p.name || p.email, picture: p.picture || '' };
}

// ─── back-office auth & roles ───
const PERMS = { orders_view: ['it_admin', 'admin', 'finance'], slip_review: ['it_admin', 'finance'], pickup: ['it_admin', 'admin', 'finance'], cancel: ['it_admin', 'finance'], code: ['it_admin', 'admin', 'finance'], accounts: ['it_admin'], campaigns: ['it_admin'] };
const ROLES = ['it_admin', 'admin', 'finance'];
async function adminUser(c) {
  if (c._admin !== undefined) return c._admin;
  let u = null;
  const t = await verifyToken(parseCookies(c.req)[ADMIN_COOKIE], secretOf(c.env));
  if (t && t.uid) { const row = await c.db.get('SELECT id, username, role, display_name, department, active, created_at FROM users WHERE id = ?', t.uid); if (row && row.active) u = row; }
  c._admin = u; return u;
}
const can = (u, perm) => Boolean(u && PERMS[perm] && PERMS[perm].includes(u.role));
async function requirePerm(c, perm) {
  const u = await adminUser(c);
  if (!u) fail(401, 'unauthorized');
  if (!can(u, perm)) fail(403, 'สิทธิ์ไม่เพียงพอ / Not allowed for your role');
  return u;
}
const userView = (u) => ({ id: u.id, username: u.username, role: u.role, display_name: u.display_name, department: u.department, active: Boolean(u.active), created_at: u.created_at });
const permissionsOf = (u) => Object.fromEntries(Object.keys(PERMS).map((k) => [k, can(u, k)]));

// ─── orders ───
const PAYABLE = ['pending', 'slip_rejected'];
const SLIP_ACCEPTED = ['pending', 'slip_uploaded', 'slip_rejected'];
async function getOrder(db, id) {
  const o = await db.get('SELECT o.*, c.name AS campaign_name FROM orders o LEFT JOIN campaigns c ON c.id = o.campaign_id WHERE o.id = ?', id);
  if (!o) return null;
  o.lines = await db.all('SELECT * FROM order_lines WHERE order_id = ? ORDER BY id', id);
  return o;
}
async function orderView(c, o, { admin = false } = {}) {
  const v = {
    id: o.id, order_number: o.order_number, campaign_id: o.campaign_id, campaign_name: o.campaign_name || '', store_id: o.store_id, store_name: o.store_name,
    total: o.total, status: o.status, note: o.note, phone: o.phone || '', email: o.email || '', pickup_date: o.pickup_date || '', pickup_time: o.pickup_time || '', created_at: o.created_at, paid_at: o.paid_at,
    picked_up_at: o.picked_up_at, has_slip: Boolean(o.slip_path), slip_reason: o.slip_reason,
    promo_code: o.promo_code || null, code_available: ['paid', 'picked_up'].includes(o.status), payable: PAYABLE.includes(o.status),
    lines: (o.lines || []).map((l) => {
      let items = []; try { items = l.items_json ? JSON.parse(l.items_json) : []; } catch (e) { items = []; }
      const name = l.set_id ? `${l.set_label || 'SET ' + l.set_id} · ${l.set_name}` : [l.drink_name, l.dessert_name].filter(Boolean).join(' + ');
      return { set_id: l.set_id || '', set_label: l.set_label || '', set_name: l.set_name || '', items, name, pieces: l.pieces ?? 1, drink_id: l.drink_id, drink_name: l.drink_name, dessert_id: l.dessert_id, dessert_name: l.dessert_name, quantity: l.quantity, unit_price: l.unit_price, line_total: l.line_total };
    }),
  };
  if (admin) {
    // หลังบ้านเห็นบัญชี Google (อีเมล/ชื่อ) ของผู้สั่ง + ผลอีเมลยืนยัน + เวลายอมรับ PDPA + สลิป
    const cu = await customerRow(c.db, o.customer_id);
    const m = await c.db.get("SELECT to_email, status, error, created_at FROM mail_log WHERE order_id = ? AND kind = 'approved' ORDER BY id DESC LIMIT 1", o.id);
    const im = await c.db.get("SELECT to_email, status, error, created_at FROM mail_log WHERE order_id = ? AND kind = 'issue' ORDER BY id DESC LIMIT 1", o.id);
    const rm = await c.db.get("SELECT to_email, status, error, created_at FROM mail_log WHERE order_id = ? AND kind = 'rejected' ORDER BY id DESC LIMIT 1", o.id);
    Object.assign(v, { customer_email: (cu && cu.email) || '', customer_name: (cu && cu.name) || '', customer_google: Boolean(cu && cu.google_sub), approval_mail: m ? { to: m.to_email, status: m.status, error: m.error || '', at: m.created_at } : null,
      issue_mail: im ? { to: im.to_email, status: im.status, error: im.error || '', at: im.created_at } : null,
      reject_mail: rm ? { to: rm.to_email, status: rm.status, error: rm.error || '', at: rm.created_at } : null,
      pdpa_accepted_at: o.pdpa_accepted_at || '', customer_id: o.customer_id, slip_url: o.slip_path ? `/uploads/${o.slip_path.split('/').pop()}` : '', slip_ref: o.slip_ref, slip_amount: o.slip_amount, slip_verified: o.slip_verified, cancelled_at: o.cancelled_at });
  }
  return v;
}
async function ownOrder(c, id) {
  const o = await getOrder(c.db, id);
  if (!o || (o.customer_id !== c.customerId && !(await adminUser(c)))) fail(404, 'ไม่พบคำสั่งซื้อ');
  return o;
}
async function notifyApproved(c, orderId) {
  // อนุมัติแล้ว → ออกรหัสโปรโมชันเรียงลำดับทันที (ลูกค้ากด "รับ code" เพื่อดู) แล้วส่งอีเมลพร้อมรหัส
  try { await assignPromoCode(c, orderId); } catch (e) { console.error('[promo] ' + (e.body ? e.body.error : e.message)); }
  const row = await getOrder(c.db, orderId); if (!row) return;
  const o = await orderView(c, row); const cust = await customerRow(c.db, row.customer_id); const camp = row.campaign_id ? await getCampaign(c.db, row.campaign_id) : null;
  const to = row.email || (cust && cust.email) || '';   // อีเมลที่กรอกตอนสั่ง (ถ้าไม่มี = อีเมลบัญชี Google)
  const mail = approvalEmail(o, camp, baseUrlOf(c), { logos: 'url' });
  const r = to ? await sendMail(c.env, { to, ...mail }) : { status: 'failed', error: 'ออเดอร์นี้ไม่มีอีเมล' };
  await c.db.run('INSERT INTO mail_log(order_id, kind, to_email, subject, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', orderId, 'approved', to, mail.subject, r.status, r.error || '', now());
  return r;
}
/* บัญชีกด Reject สลิป → แจ้งทีมการตลาด (ISSUE_NOTIFY_EMAIL ค่าเริ่มต้น marketing@jianchatea.com; คั่นหลายคนด้วย , ; ว่าง = ไม่ส่ง) */
const issueNotifyTo = (env) => (env.ISSUE_NOTIFY_EMAIL == null ? 'marketing@jianchatea.com' : String(env.ISSUE_NOTIFY_EMAIL).trim());
async function notifyIssue(c, orderId, { by = '', reason = '' } = {}) {
  const to = issueNotifyTo(c.env); if (!to) return null;
  const row = await getOrder(c.db, orderId); if (!row) return null;
  const o = await orderView(c, row, { admin: true }); const camp = row.campaign_id ? await getCampaign(c.db, row.campaign_id) : null;
  const mail = issueEmail(o, camp, baseUrlOf(c), { by, reason });
  const r = await sendMail(c.env, { to, ...mail });
  await c.db.run('INSERT INTO mail_log(order_id, kind, to_email, subject, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', orderId, 'issue', to, mail.subject, r.status, r.error || '', now());
  return r;
}

/* Reject → อีเมลถึงลูกค้า (อีเมลที่กรอกตอนสั่ง): เหตุผล + ลิงก์อัปโหลดใหม่ + QR LINE OA (LINE_OA_QR = URL/path รูป, LINE_OA_URL = ลิงก์เพิ่มเพื่อน) */
const LINE_OA_QR_DEFAULT = '/img/line-oa-qr.png', LINE_OA_URL_DEFAULT = 'https://page.line.me/jiancha';
const lineQrUrl = (c) => { const v = String(c.env.LINE_OA_QR == null ? LINE_OA_QR_DEFAULT : c.env.LINE_OA_QR).trim();   // ตั้ง LINE_OA_QR='' เพื่อปิดการแนบรูป
  return v ? (v.startsWith('http') ? v : baseUrlOf(c) + v) : ''; };
const lineOaUrl = (c) => String(c.env.LINE_OA_URL == null ? LINE_OA_URL_DEFAULT : c.env.LINE_OA_URL).trim();
async function notifyRejected(c, orderId, { reason = '' } = {}) {
  const row = await getOrder(c.db, orderId); if (!row) return null;
  const cust = await customerRow(c.db, row.customer_id); const to = row.email || (cust && cust.email) || '';
  const o = await orderView(c, row); const camp = row.campaign_id ? await getCampaign(c.db, row.campaign_id) : null;
  const mail = rejectEmail(o, camp, baseUrlOf(c), { reason, lineQr: lineQrUrl(c), lineUrl: lineOaUrl(c) });
  const r = to ? await sendMail(c.env, { to, ...mail }) : { status: 'failed', error: 'ออเดอร์นี้ไม่มีอีเมล' };
  await c.db.run('INSERT INTO mail_log(order_id, kind, to_email, subject, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', orderId, 'rejected', to, mail.subject, r.status, r.error || '', now());
  return r;
}

// ─── uploads (R2) ───
const IMG_EXT = { 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/jpeg': '.jpg', 'image/heic': '.heic', 'image/heif': '.heif' };
async function fileFrom(c, fd, field, accept) {
  const f = fd.get(field);
  if (!f || typeof f === 'string' || !accept.test(f.type || '')) return null;
  if (f.size > fileMax(c.env)) fail(400, usingR2(c.env) ? 'ไฟล์ใหญ่เกิน 8 MB' : 'ไฟล์ใหญ่เกิน 1.5 MB กรุณาเลือกรูปที่เล็กลง / Image too large (max 1.5 MB)');
  return { bytes: await f.arrayBuffer(), type: f.type, ext: IMG_EXT[f.type] || '.jpg', name: f.name || '' };
}
async function readUpload(c, field, accept) {
  let fd; try { fd = await c.req.formData(); } catch (e) { return null; }
  return fileFrom(c, fd, field, accept);
}
const SLIP_TYPES = /^image\/(jpeg|png|webp|heic|heif)$/;
/** คำสั่งซื้อ: multipart (order = JSON string, slip = รูป) หรือ JSON ล้วน */
async function readOrderRequest(c) {
  if (/multipart\/form-data/i.test(c.req.headers.get('content-type') || '')) {
    let fd; try { fd = await c.req.formData(); } catch (e) { fail(400, 'ข้อมูลคำสั่งซื้อไม่ถูกต้อง'); }
    let b = {}; try { b = JSON.parse(fd.get('order') || '{}'); } catch (e) { fail(400, 'ข้อมูลคำสั่งซื้อไม่ถูกต้อง'); }
    return { b: b && typeof b === 'object' ? b : {}, slip: await fileFrom(c, fd, 'slip', SLIP_TYPES) };
  }
  return { b: await body(c), slip: null };
}

// ─── router ───
const routes = [];
const on = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });
const body = async (c) => { try { const b = await c.req.json(); return b && typeof b === 'object' ? b : {}; } catch (e) { return {}; } };

on('GET', '/api/me', async (c) => json(await meView(c)));
// ลูกค้ากดยอมรับ PDPA (pop-up หน้าแคมเปญ) → บันทึกเวลาไว้กับตัวตนของเบราว์เซอร์/บัญชี Google
on('POST', '/api/pdpa', async (c) => {
  await c.db.batch([touchCustomerStmt(c.db, c.customerId), c.db.stmt('UPDATE customers SET pdpa_accepted_at = COALESCE(pdpa_accepted_at, ?) WHERE id = ?', now(), c.customerId)]);
  return json(await meView(c));
});
on('POST', '/api/auth/google', async (c) => {
  if (!loginRequired(c.env)) fail(503, 'ยังไม่ได้ตั้งค่า Google login (GOOGLE_CLIENT_ID)');
  const b = await body(c);
  let g; try { g = await verifyGoogleToken(c.env, b.credential); } catch (e) { fail(401, 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่ / Google sign-in failed'); }
  const anon = c.customerId; const db = c.db;
  let acct = await db.get('SELECT id FROM customers WHERE google_sub = ?', g.sub);
  // บัญชีที่เตรียมไว้ล่วงหน้าด้วยอีเมล (เช่น เจ้าของออเดอร์เดิม) ยังไม่เคยล็อกอิน → ผูกกับ Google account นี้
  if (!acct && g.email) acct = (await db.get('SELECT id FROM customers WHERE google_sub IS NULL AND lower(email) = ? ORDER BY created_at LIMIT 1', String(g.email).toLowerCase())) || null;
  const stmts = [];
  if (!acct) { stmts.push(touchCustomerStmt(db, anon)); acct = { id: anon }; }   // บัญชีใหม่: แถวลูกค้าของเบราว์เซอร์นี้กลายเป็นบัญชี
  else if (acct.id !== anon) {
    // เคยล็อกอินจากเครื่องอื่น: ย้ายออเดอร์ที่สั่งแบบไม่ล็อกอินในเบราว์เซอร์นี้ไปไว้กับบัญชี (และการยอมรับ PDPA ถ้าบัญชียังไม่มี)
    stmts.push(db.stmt('UPDATE orders SET customer_id = ? WHERE customer_id = ?', acct.id, anon));
    stmts.push(db.stmt('UPDATE customers SET pdpa_accepted_at = (SELECT pdpa_accepted_at FROM customers WHERE id = ?) WHERE id = ? AND pdpa_accepted_at IS NULL', anon, acct.id));
  }
  stmts.push(db.stmt('UPDATE customers SET google_sub = ?, email = ?, name = ?, picture = ?, last_login_at = ?, last_seen_at = ? WHERE id = ?', g.sub, g.email, g.name, g.picture, now(), now(), acct.id));
  const fromCampaign = b.campaign ? await campaignBySlug(db, String(b.campaign)) : null;
  if (fromCampaign) stmts.push(linkCampaignStmt(db, acct.id, fromCampaign.id));
  await db.batch(stmts);
  // ออเดอร์เก่าของบัญชี → ผูกแคมเปญให้ครบ
  const camps = await db.all('SELECT DISTINCT campaign_id FROM orders WHERE customer_id = ? AND campaign_id IS NOT NULL', acct.id);
  if (camps.length) await db.batch(camps.map((r) => linkCampaignStmt(db, acct.id, r.campaign_id)));
  await setCustomerCookie(c, acct.id);
  return json(await meView(c, acct.id));
});
on('POST', '/api/auth/logout', async (c) => { const cid = uuid(); await setCustomerCookie(c, cid); return json(await meView(c, cid)); });

on('GET', '/api/menu', async (c) => { const camp = await requestCampaign(c); return json({ ...menuFor(camp), campaign: campaignPublic(camp), stock: await stockView(c, camp) }); });
on('GET', '/api/stock', async (c) => json(await stockView(c, await requestCampaign(c))));
on('GET', '/api/stores', async () => json(STORES));
on('GET', '/api/config', async (c) => json({ payment_ready: qrConfigured(c.env), payment_mode: paymentMode(c.env), slip_auto_verify: slipOkEnabled(c.env), login_required: loginRequired(c.env), google_client_id: (c.env.GOOGLE_CLIENT_ID || '').trim() }));

/** ตรวจคำสั่งซื้อ (ยังไม่บันทึก): login, เบอร์, สาขา, รายการ, แคมเปญ, วันเวลารับของ, ช่วงเปิดรับ → ข้อมูลพร้อมบันทึก
 *  Body: { store_id, note, phone, email, pickup_date, pickup_time, campaign?: slug, lines: [{set_id, quantity}] } */
async function validateOrder(c, b) {
  if (loginRequired(c.env) && !(await customerLoggedIn(c))) fail(401, { error: 'กรุณาเข้าสู่ระบบด้วย Google ก่อนยืนยันคำสั่งซื้อ / Please sign in with Google first', login_required: true });
  const { store_id, note = '', lines } = b;
  const phone = String(b.phone || '').replace(/[^\d+]/g, '').slice(0, 20);
  if (!/^(\+66|0)\d{8,9}$/.test(phone)) fail(400, { error: 'กรุณาใส่เบอร์ติดต่อผู้รับขนม (เบอร์มือถือ 10 หลัก) / Contact number is required', field: 'phone' });
  const email = normalizeEmail(b.email);   // อีเมลผู้สั่ง (รับอีเมลยืนยัน + รหัสโปรโมชัน)
  if (!validEmail(email)) fail(400, { error: 'กรุณาใส่อีเมลให้ถูกต้อง (ใช้ส่งอีเมลยืนยันคำสั่งซื้อ) / A valid email is required', field: 'email' });
  const store = STORES.find((s) => s.id === String(store_id));
  if (!store) fail(400, 'กรุณาเลือกสาขาที่รับสินค้า');
  if (!Array.isArray(lines) || lines.length === 0) fail(400, 'ยังไม่มีรายการในตะกร้า');
  const campaign = await requestCampaign(c, b);
  if (campaign.orders_open === 0) fail(400, 'แคมเปญนี้ปิดรับคำสั่งซื้อแล้ว / This campaign is closed');
  const menu = menuFor(campaign); const today = todayOf(c, menu);
  // วันรับของกำหนดจากรอบสั่ง (pickup_map) ลูกค้าไม่ต้องเลือก; แคมเปญที่ไม่มีตารางยังให้เลือกจากรายการได้
  const mustPickup = (menu.pickup_map || {})[today];
  const pickup_date = mustPickup || String(b.pickup_date || '').trim();
  if (!mustPickup && menu.pickup_dates.length && !menu.pickup_dates.includes(pickup_date)) fail(400, { error: 'กรุณาเลือกวันที่รับของ / Please choose a pick-up date', field: 'pickup_date' });
  const pickup_time = String(b.pickup_time || '').trim();
  if (menu.pickup_times.length && !menu.pickup_times.includes(pickup_time)) fail(400, { error: 'กรุณาเลือกเวลาที่รับของ / Please choose a pick-up time', field: 'pickup_time' });
  const built = M.buildOrderRows(lines, menu); if (built.error) fail(400, built.error);
  // ช่วงวันเปิดรับ (นอกช่วง = ไม่ต้องลอง); โควตาต่อวันและสต๊อกตรวจซ้ำใน transaction ตอนบันทึก กันสั่งเกินพร้อมกัน
  invalidateStock(); const sv = await stockView(c, campaign);
  if (!sv.order_window.open && !(sv.order_window.status === 'full')) fail(409, { error: sv.order_window.message, stock: sv });
  // คิวที่ลูกค้าคนนี้จองไว้เอง (กด Confirm ก่อนหน้า) ไม่นับเป็นของคนอื่น → บวกคืนก่อนตรวจ
  const own = (await c.db.get('SELECT COALESCE(SUM(sets), 0) AS sets, COALESCE(SUM(drink), 0) AS drink, COALESCE(SUM(dessert), 0) AS dessert FROM holds WHERE customer_id = ? AND campaign_id = ? AND order_day = ? AND expires_at > ?', c.customerId, campaign.id, today, now())) || { sets: 0, drink: 0, dessert: 0 };
  const rem = { total: sv.remaining.total == null ? null : sv.remaining.total + own.sets, drink: sv.remaining.drink == null ? null : sv.remaining.drink + own.drink, dessert: sv.remaining.dessert == null ? null : sv.remaining.dessert + own.dessert };
  const ow = { ...sv.order_window, today_remaining: sv.order_window.today_remaining == null ? null : sv.order_window.today_remaining + own.sets };
  if (sv.order_window.status === 'full' && own.sets === 0) fail(409, { error: sv.order_window.message, stock: sv });
  const short = M.stockShortfall(built.want, rem) || M.dayShortfall(built.want, ow); if (short) fail(409, { error: short, stock: sv });
  return { campaign, menu, today, store, store_name: `${store.brand} - ${store.name}`, phone, email, note: String(note).slice(0, 500), pickup_date: (mustPickup || menu.pickup_dates.length) ? pickup_date : '', pickup_time: menu.pickup_times.length ? pickup_time : '', rows: built.rows, want: built.want, total: built.total };
}
/** สรุปคำสั่งซื้อ + วิธีชำระเงิน (ยังไม่มีออเดอร์ในระบบจนกว่าจะส่งสลิป) */
/** จองคิว (hold) ให้ลูกค้าคนนี้: ลบคิวเดิม/คิวหมดอายุ แล้วจองใหม่แบบตรวจโควตา+สต๊อกใน batch เดียว → hold row หรือ null (เต็ม) */
async function reserveHold(c, v) {
  const { campaign, menu, today, want } = v; const db = c.db; const ts = now();
  const mins = holdMinutes(c.env); const exp = W.bangkokNow(new Date(Date.now() + mins * 60000)); const id = uuid();
  const conds = [], cargs = [];
  for (const [k, col] of [['total', 'COALESCE(l.pieces, 1)'], ['drink', 'COALESCE(l.drink_pieces, 0)'], ['dessert', 'COALESCE(l.dessert_pieces, 0)']]) {
    const limit = campaign['stock_' + k]; if (limit == null) continue;
    const hcol = k === 'total' ? 'sets' : k;
    conds.push(`(SELECT COALESCE(SUM(l.quantity * ${col}), 0) FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.status <> 'cancelled' AND o.campaign_id = ?) + (SELECT COALESCE(SUM(h.${hcol}), 0) FROM holds h WHERE h.campaign_id = ? AND h.expires_at > ?) + ? <= ?`); cargs.push(campaign.id, campaign.id, ts, want[k], limit);
  }
  if (menu.orders_per_day) { conds.push(`(SELECT COALESCE(SUM(l.quantity * COALESCE(l.pieces, 1)), 0) FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.campaign_id = ? AND o.order_day = ? AND o.status <> 'cancelled') + (SELECT COALESCE(SUM(h.sets), 0) FROM holds h WHERE h.campaign_id = ? AND h.order_day = ? AND h.expires_at > ?) + ? <= ?`); cargs.push(campaign.id, today, campaign.id, today, ts, want.total, menu.orders_per_day); }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
  const prev = await db.get('SELECT * FROM holds WHERE customer_id = ? AND campaign_id = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1', c.customerId, campaign.id, ts);
  await db.batch([
    db.stmt('DELETE FROM holds WHERE expires_at <= ?', ts),                                       // เก็บกวาดคิวหมดอายุ
    db.stmt('DELETE FROM holds WHERE customer_id = ? AND campaign_id = ?', c.customerId, campaign.id),   // คิวเดิมของลูกค้าคนนี้ (จองใหม่แทน)
    db.stmt(`INSERT INTO holds(id, customer_id, campaign_id, order_day, sets, drink, dessert, created_at, expires_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?${where}`, id, c.customerId, campaign.id, today, want.total, want.drink, want.dessert, ts, exp, ...cargs),
  ]);
  invalidateStock();
  const row = await db.get('SELECT id, expires_at FROM holds WHERE id = ?', id);
  // จองใหม่ไม่ได้ (เช่น เพิ่มจำนวนเกินที่เหลือ) → คืนคิวเดิมให้ ไม่ให้ลูกค้าเสียคิวที่มีอยู่
  if (!row && prev) { await db.run('INSERT OR IGNORE INTO holds(id, customer_id, campaign_id, order_day, sets, drink, dessert, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', prev.id, prev.customer_id, prev.campaign_id, prev.order_day, prev.sets, prev.drink, prev.dessert, prev.created_at, prev.expires_at); invalidateStock(); }
  return row;
}
/** ใส่ตะกร้า = จองคิวทันที: body { lines, campaign? } → คิวของลูกค้าคนนี้ถูกแทนด้วยจำนวนล่าสุด (ตะกร้าว่าง = คืนคิว) */
on('POST', '/api/hold', async (c) => {
  const b = await body(c); const campaign = await requestCampaign(c, b);
  const menu = menuFor(campaign); const today = todayOf(c, menu);
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (!lines.length || campaign.orders_open === 0) { await c.db.run('DELETE FROM holds WHERE customer_id = ? AND campaign_id = ?', c.customerId, campaign.id); invalidateStock(); return json({ held: 0, stock: await stockView(c, campaign) }); }
  const built = M.buildOrderRows(lines, menu); if (built.error) fail(400, built.error);
  invalidateStock(); const sv0 = await stockView(c, campaign);
  if (!sv0.order_window.open && sv0.order_window.status !== 'full') fail(409, { error: sv0.order_window.message, stock: sv0 });
  const hold = await reserveHold(c, { campaign, menu, today, want: built.want });
  if (!hold) { const sv = await stockView(c, campaign); fail(409, { error: M.stockShortfall(built.want, sv.remaining) || M.dayShortfall(built.want, sv.order_window) || sv.order_window.message || 'คิวเต็มแล้ว', stock: sv }); }
  return json({ held: built.want.total, hold_expires_at: hold.expires_at, hold_minutes: holdMinutes(c.env), stock: await stockView(c, campaign) });
});
on('DELETE', '/api/hold', async (c) => {
  const b = await body(c); const campaign = await requestCampaign(c, b);
  await c.db.run('DELETE FROM holds WHERE customer_id = ? AND campaign_id = ?', c.customerId, campaign.id); invalidateStock();
  return json({ held: 0, stock: await stockView(c, campaign) });
});
on('POST', '/api/quote', async (c) => {
  const v = await validateOrder(c, await body(c));
  // กด Confirm = จองคิวทันที (หักโควตา/สต๊อกระหว่างรอชำระเงิน) หมดอายุอัตโนมัติถ้าไม่ส่งสลิปทัน
  const hold = await reserveHold(c, v);
  if (!hold) { const sv = await stockView(c, v.campaign); fail(409, { error: M.stockShortfall(v.want, sv.remaining) || M.dayShortfall(v.want, sv.order_window) || sv.order_window.message || 'คิวเต็มแล้ว กรุณาลองใหม่', stock: sv }); }
  const lines = v.rows.map((r) => { let items = []; try { items = r.items_json ? JSON.parse(r.items_json) : []; } catch (e) { items = []; }
    return { set_id: r.set_id, set_label: r.set_label, set_name: r.set_name, items, name: r.set_id ? `${r.set_label || 'SET ' + r.set_id} · ${r.set_name}` : [r.drink_name, r.dessert_name].filter(Boolean).join(' + '), pieces: r.pieces, quantity: r.quantity, unit_price: r.unit_price, line_total: r.line_total }; });
  let payment = null;
  if (v.total > 0) {
    if (!qrConfigured(c.env)) fail(503, 'ยังไม่ได้ตั้งค่าบัญชีรับเงินของร้าน (BANK_ACCOUNT_NO หรือ PROMPTPAY_ID)');
    const bank = bankAccount(c.env); payment = bank ? { bank } : { qr_data_url: generateQR(c.env, v.total) };
  }
  return json({ campaign: campaignPublic(v.campaign), campaign_name: v.campaign.name, store_id: v.store.id, store_name: v.store_name, phone: v.phone, email: v.email, note: v.note, pickup_date: v.pickup_date, pickup_time: v.pickup_time, order_day: v.today, lines, total: v.total, amount: v.total, payment, slip_required: v.total > 0, hold_expires_at: hold.expires_at, hold_minutes: holdMinutes(c.env) });
});
/** บันทึกออเดอร์ (โควตาต่อวัน + สต๊อกตรวจใน transaction เดียวกับการบันทึก) → แถวออเดอร์ หรือ 409 */
async function insertOrder(c, v, { slipStatus = null, slipAt = null } = {}) {
  const { campaign, menu, today, store, rows, want, total } = v;
  const pdpaAt = ((await customerRow(c.db, c.customerId)) || {}).pdpa_accepted_at || '';
  const id = uuid(); const ts = now(); const dayKey = today.replace(/-/g, ''); const db = c.db;
  const conds = [], cargs = [];
  for (const [k, col] of [['total', 'COALESCE(l.pieces, 1)'], ['drink', 'COALESCE(l.drink_pieces, 0)'], ['dessert', 'COALESCE(l.dessert_pieces, 0)']]) {
    const limit = campaign['stock_' + k]; if (limit == null) continue;
    const hcol = k === 'total' ? 'sets' : k;
    conds.push(`(SELECT COALESCE(SUM(l.quantity * ${col}), 0) FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.status <> 'cancelled' AND o.campaign_id = ?) + (SELECT COALESCE(SUM(h.${hcol}), 0) FROM holds h WHERE h.campaign_id = ? AND h.expires_at > ? AND h.customer_id <> ?) + ? <= ?`); cargs.push(campaign.id, campaign.id, ts, c.customerId, want[k], limit);
  }
  // โควตาชุดต่อวัน: ชุดที่ขายแล้ว + คิวที่คนอื่นจองไว้ (รอชำระเงิน) + ออเดอร์นี้ ≤ โควตา
  if (menu.orders_per_day) { conds.push(`(SELECT COALESCE(SUM(l.quantity * COALESCE(l.pieces, 1)), 0) FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.campaign_id = ? AND o.order_day = ? AND o.status <> 'cancelled') + (SELECT COALESCE(SUM(h.sets), 0) FROM holds h WHERE h.campaign_id = ? AND h.order_day = ? AND h.expires_at > ? AND h.customer_id <> ?) + ? <= ?`); cargs.push(campaign.id, today, campaign.id, today, ts, c.customerId, want.total, menu.orders_per_day); }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
  const status = total > 0 ? (slipStatus || 'pending') : 'paid';
  const stmts = [touchCustomerStmt(db, c.customerId), linkCampaignStmt(db, c.customerId, campaign.id),
    db.stmt('DELETE FROM holds WHERE customer_id = ? AND campaign_id = ?', c.customerId, campaign.id),   // คิวที่จองไว้ถูกใช้เป็นออเดอร์
    // ทะเบียนลูกค้า: อีเมลที่กรอกติดกับตัวตนของเบราว์เซอร์นี้ (บัญชี Google ใช้อีเมลของ Google ไม่ทับ)
    db.stmt('UPDATE customers SET email = ? WHERE id = ? AND google_sub IS NULL', v.email, c.customerId),
    db.stmt(`INSERT INTO orders(id, order_number, customer_id, campaign_id, store_id, store_name, total, note, phone, email, pickup_date, pickup_time, pdpa_accepted_at, order_day, status, paid_at, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${where}`,
    id, 'tmp-' + id, c.customerId, campaign.id, store.id, v.store_name, total, v.note, v.phone, v.email, v.pickup_date, v.pickup_time, pdpaAt, today, status, status === 'paid' ? (slipAt || ts) : null, ts, ...cargs),
    // เลขออเดอร์ YYYYMMDD + ลำดับ 5 หลักของวัน (นับเฉพาะเมื่อบันทึกออเดอร์สำเร็จ)
    db.stmt('INSERT INTO order_counters(day, seq) VALUES (?, 0) ON CONFLICT(day) DO NOTHING', dayKey),
    db.stmt('UPDATE order_counters SET seq = seq + 1 WHERE day = ? AND EXISTS (SELECT 1 FROM orders WHERE id = ?)', dayKey, id),
    db.stmt("UPDATE orders SET order_number = (SELECT day || printf('%05d', seq) FROM order_counters WHERE day = ?) WHERE id = ?", dayKey, id),
    ...rows.map((r) => db.stmt(`INSERT INTO order_lines(order_id, set_id, set_label, set_name, items_json, pieces, drink_pieces, dessert_pieces, drink_id, drink_name, dessert_id, dessert_name, quantity, unit_price, line_total)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM orders WHERE id = ?)`, id, r.set_id, r.set_label, r.set_name, r.items_json, r.pieces, r.drink_pieces, r.dessert_pieces, r.drink_id, r.drink_name, r.dessert_id, r.dessert_name, r.quantity, r.unit_price, r.line_total, id))];
  await db.batch(stmts); invalidateStock();
  const o = await getOrder(db, id);
  if (!o) {
    // ไม่ถูกบันทึก = สต๊อกไม่พอหรือโควตาวันนี้เต็มพอดี → บอกเหตุผล
    const sv = await stockView(c, campaign);
    const short = M.stockShortfall(want, sv.remaining) || M.dayShortfall(want, sv.order_window);
    fail(409, { error: short || sv.order_window.message || 'ไม่สามารถบันทึกคำสั่งซื้อได้ กรุณาลองใหม่', stock: sv });
  }
  return o;
}
/** สั่งซื้อ = ส่งสลิปพร้อมรายการ (multipart: order = JSON, slip = รูป) — ออเดอร์เกิดในระบบเมื่อมีสลิปเท่านั้น
 *  (JSON ล้วนใช้ได้เฉพาะออเดอร์ยอด 0 บาท) */
on('POST', '/api/orders', async (c) => {
  const { b, slip } = await readOrderRequest(c);
  const v = await validateOrder(c, b);
  let r = null;
  if (v.total > 0) {
    if (!slip) fail(400, { error: 'กรุณาแนบสลิปโอนเงิน (jpg/png) / Please attach your transfer slip', field: 'slip' });
    const isDuplicate = async ({ hash, ref }) => {
      if (hash && await c.db.get('SELECT 1 AS x FROM orders WHERE slip_hash = ? AND status <> ?', hash, 'cancelled')) return true;
      if (ref && await c.db.get('SELECT 1 AS x FROM orders WHERE slip_ref = ? AND status <> ?', ref, 'cancelled')) return true;
      return false;
    };
    r = await verifySlip(c.env, slip.bytes, slip.type, v.total, { isDuplicate });
    // สลิปซ้ำ/ตรวจไม่ผ่าน = ไม่สร้างออเดอร์ (ไม่กินโควตา ไม่ขึ้นหลังบ้าน)
    if (!r.verified && !r.manual) fail(400, { error: r.reason || 'สลิปไม่ผ่านการตรวจสอบ / Slip rejected', field: 'slip' });
  }
  const ts = now();
  const o = await insertOrder(c, v, { slipStatus: r ? (r.verified ? 'paid' : 'slip_uploaded') : null, slipAt: ts });
  if (r) {
    const key = `slips/${Date.now()}-${randomHex(6)}${slip.ext}`;
    await putFile(c.env, key, slip.bytes, slip.type, ts);
    await c.db.run('UPDATE orders SET slip_path = ?, slip_hash = ?, slip_ref = ?, slip_amount = ?, slip_reason = ?, slip_verified = ? WHERE id = ?', key, r.slip_hash || '', r.ref || '', r.amount ?? null, r.reason || '', r.verified ? 1 : 0, o.id);
    if (r.verified) await notifyApproved(c, o.id);   // ตรวจอัตโนมัติผ่าน → อีเมลยืนยันทันที
  }
  return json(await orderView(c, await getOrder(c.db, o.id)), 201);
});
on('GET', '/api/orders', async (c) => {
  // ประวัติการสั่งซื้อแยกตามบัญชี Google: ยังไม่ล็อกอิน (เมื่อเปิดใช้ login) = ไม่มีออเดอร์
  if (loginRequired(c.env) && !(await customerLoggedIn(c))) return json([]);
  const ids = await c.db.all('SELECT id FROM orders WHERE customer_id = ? ORDER BY created_at DESC, order_number DESC LIMIT 100', c.customerId);
  const out = []; for (const { id } of ids) out.push(await orderView(c, await getOrder(c.db, id)));
  return json(out);
});
on('GET', '/api/orders/:id', async (c) => json(await orderView(c, await ownOrder(c, c.params.id))));
on('GET', '/api/orders/:id/qr', async (c) => {
  const o = await ownOrder(c, c.params.id);
  if (!PAYABLE.includes(o.status)) fail(400, 'คำสั่งซื้อนี้ไม่ได้อยู่ในสถานะรอชำระเงิน');
  if (!qrConfigured(c.env)) fail(503, 'ยังไม่ได้ตั้งค่าบัญชีรับเงินของร้าน (BANK_ACCOUNT_NO หรือ PROMPTPAY_ID)');
  if (!(o.total > 0)) fail(400, 'ยอดคำสั่งซื้อเป็น 0 ไม่ต้องชำระเงิน');
  // โอนเข้าบัญชีธนาคาร: ส่งรายละเอียดบัญชีให้ลูกค้าโอนเอง; PromptPay: ส่ง QR ตามยอด
  const bank = bankAccount(c.env);
  if (bank) return json({ bank, amount: o.total });
  return json({ qr_data_url: generateQR(c.env, o.total), amount: o.total });
});
// POS promotion code for a paid order: a random unused number in the campaign's range, assigned once
async function assignPromoCode(c, orderId) {
  const db = c.db;
  const o = await db.get('SELECT status, promo_code, campaign_id FROM orders WHERE id = ?', orderId);
  if (!o) fail(404, 'ไม่พบคำสั่งซื้อ');
  if (o.promo_code) return o.promo_code;
  if (!['paid', 'picked_up'].includes(o.status)) fail(400, 'รับ code ได้เมื่อชำระเงินเรียบร้อยแล้ว / Available after payment');
  const camp = (await getCampaign(db, o.campaign_id)) || (await activeCampaign(db));
  // เรียงลำดับตามการอนุมัติ: เลขสูงสุดที่เคยออกในแคมเปญ + 1 (ไม่ใช้ซ้ำแม้ออเดอร์ถูกยกเลิก) รูปแบบ prefix + เลขเติมศูนย์ เช่น NVR260001
  for (let attempt = 0; attempt < 5; attempt++) {
    const usedRows = await db.all('SELECT promo_code FROM orders WHERE campaign_id = ? AND promo_code IS NOT NULL', camp.id);
    const n = M.nextPromoNumber(usedRows.map((r) => r.promo_code), camp);
    if (n == null) fail(409, 'รหัสโปรโมชันถูกใช้ครบแล้ว กรุณาติดต่อเจ้าหน้าที่');
    const code = M.formatPromoCode(camp, n);
    // ตั้งเฉพาะเมื่อยังไม่มี code (กันกดซ้ำพร้อมกัน); unique index กันเลขซ้ำ → อ่านใหม่แล้วลองเลขถัดไป
    try { const r = await db.run('UPDATE orders SET promo_code = ? WHERE id = ? AND promo_code IS NULL', code, orderId); if (r.meta.changes > 0) return code; } catch (e) { continue; }
    return (await db.get('SELECT promo_code FROM orders WHERE id = ?', orderId)).promo_code;
  }
  fail(409, 'ออกรหัสโปรโมชันไม่สำเร็จ กรุณาลองใหม่');
}
on('POST', '/api/orders/:id/code', async (c) => {
  const o = await ownOrder(c, c.params.id);
  const u = await adminUser(c);
  if (u && o.customer_id !== c.customerId && !can(u, 'code')) fail(403, 'สิทธิ์ไม่เพียงพอ');
  const promo_code = await assignPromoCode(c, o.id);
  return json({ promo_code, order: await orderView(c, await getOrder(c.db, o.id)) });
});
on('POST', '/api/orders/:id/slip', async (c) => {
  const o = await ownOrder(c, c.params.id);
  const f = await readUpload(c, 'slip', /^image\/(jpeg|png|webp|heic|heif)$/);
  if (!f) fail(400, 'กรุณาแนบรูปสลิป (jpg/png)');
  if (!SLIP_ACCEPTED.includes(o.status)) fail(400, 'คำสั่งซื้อนี้ชำระเงินแล้ว');
  const isDuplicate = async ({ hash, ref }) => {
    if (hash && await c.db.get('SELECT 1 AS x FROM orders WHERE slip_hash = ? AND id <> ? AND status <> ?', hash, o.id, 'cancelled')) return true;
    if (ref && await c.db.get('SELECT 1 AS x FROM orders WHERE slip_ref = ? AND id <> ? AND status <> ?', ref, o.id, 'cancelled')) return true;
    return false;
  };
  const r = await verifySlip(c.env, f.bytes, f.type, o.total, { orderCreatedAt: o.created_at, isDuplicate });
  // สลิปซ้ำ/ตรวจไม่ผ่าน = ไม่แตะออเดอร์เดิม (สลิปเดิมและสถานะคงอยู่) แค่บอกเหตุผล
  if (!r.verified && !r.manual) return json({ ok: false, status: o.status, reason: r.reason, order: await orderView(c, o) });
  const key = `slips/${Date.now()}-${randomHex(6)}${f.ext}`;
  await putFile(c.env, key, f.bytes, f.type, now());
  if (o.slip_path && o.slip_path !== key) c.ctx.waitUntil(deleteFile(c.env, o.slip_path));
  // verified by SlipOK -> paid; no verifier -> finance reviews; failed check -> back to payable with the reason
  const status = r.verified ? 'paid' : 'slip_uploaded';
  await c.db.run(`UPDATE orders SET slip_path = ?, slip_hash = ?, slip_ref = ?, slip_amount = ?, slip_reason = ?, slip_verified = ?, status = ?, paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END WHERE id = ?`,
    key, r.slip_hash || '', r.ref || '', r.amount ?? null, r.reason || '', r.verified ? 1 : 0, status, status, now(), o.id);
  if (status === 'paid') await notifyApproved(c, o.id);
  return json({ ok: r.verified || r.manual, status, reason: r.reason, order: await orderView(c, await getOrder(c.db, o.id)) });
});

// ─── back-office ───
on('POST', '/api/admin/login', async (c) => {
  const { username = '', password = '' } = await body(c);
  const u = await c.db.get('SELECT * FROM users WHERE username = ? AND active = 1', String(username).trim());
  if (!u || !(await checkPassword(password, u.password_hash))) fail(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  c.cookies.push(cookie(ADMIN_COOKIE, await signToken({ uid: u.id, role: u.role, exp: Math.floor(Date.now() / 1000) + 12 * 3600 }, secretOf(c.env)), { secure: c.secure }));
  return json({ ok: true, user: userView(u), permissions: permissionsOf(u) });
});
on('POST', '/api/admin/logout', async (c) => { c.cookies.push(cookie(ADMIN_COOKIE, '', { maxAge: 0, secure: c.secure })); return json({ ok: true }); });
on('GET', '/api/admin/me', async (c) => {
  const u = await adminUser(c);
  return json({ admin: Boolean(u), user: u ? userView(u) : null, permissions: u ? permissionsOf(u) : {}, slip_auto_verify: slipOkEnabled(c.env), payment_ready: qrConfigured(c.env), payment_mode: paymentMode(c.env), reset_orders_at: (c.env.RESET_ORDERS_AT || '').trim(), order_early_hours: parseFloat(c.env.ORDER_EARLY_HOURS || '0') || 0, public_base_url: (c.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''), file_storage: usingR2(c.env) ? 'r2' : 'd1' });
});
on('POST', '/api/admin/me/password', async (c) => {
  const u = await requirePerm(c, 'orders_view'); const { current = '', password = '' } = await body(c);
  const row = await c.db.get('SELECT password_hash FROM users WHERE id = ?', u.id);
  if (!(await checkPassword(current, row.password_hash))) fail(400, 'รหัสผ่านเดิมไม่ถูกต้อง');
  if (String(password).length < 6) fail(400, 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร');
  await c.db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', await hashPassword(password), now(), u.id);
  return json({ ok: true });
});
// Accounts (it_admin only)
on('GET', '/api/admin/users', async (c) => { await requirePerm(c, 'accounts'); return json((await c.db.all("SELECT * FROM users ORDER BY CASE role WHEN 'it_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, username")).map(userView)); });
on('POST', '/api/admin/users', async (c) => {
  await requirePerm(c, 'accounts');
  const { username = '', password = '', role = '', display_name = '', department = '' } = await body(c);
  const name = String(username).trim();
  if (!/^[a-z0-9._-]{2,40}$/i.test(name)) fail(400, 'username ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีด (2-40 ตัว)');
  if (String(password).length < 6) fail(400, 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร');
  if (!ROLES.includes(role)) fail(400, 'role ไม่ถูกต้อง');
  if (await c.db.get('SELECT 1 AS x FROM users WHERE username = ?', name)) fail(409, 'username นี้มีอยู่แล้ว');
  const id = uuid();
  await c.db.run('INSERT INTO users(id, username, password_hash, role, display_name, department, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, name, await hashPassword(password), role, String(display_name).slice(0, 80), String(department).slice(0, 80), now(), now());
  return json(userView(await c.db.get('SELECT * FROM users WHERE id = ?', id)), 201);
});
on('PATCH', '/api/admin/users/:id', async (c) => {
  const me = await requirePerm(c, 'accounts');
  const u = await c.db.get('SELECT * FROM users WHERE id = ?', c.params.id); if (!u) fail(404, 'ไม่พบผู้ใช้');
  const b = await body(c);
  const next = { display_name: b.display_name ?? u.display_name, department: b.department ?? u.department, role: b.role ?? u.role, active: b.active == null ? u.active : (b.active ? 1 : 0) };
  if (!ROLES.includes(next.role)) fail(400, 'role ไม่ถูกต้อง');
  if (u.id === me.id && (next.role !== 'it_admin' || !next.active)) fail(400, 'ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้');
  if (u.role === 'it_admin' && (next.role !== 'it_admin' || !next.active)) {
    const others = (await c.db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'it_admin' AND active = 1 AND id <> ?", u.id)).n;
    if (others === 0) fail(400, 'ต้องมี IT-Admin ที่ใช้งานได้อย่างน้อย 1 บัญชี');
  }
  if (b.password != null && b.password !== '') {
    if (String(b.password).length < 6) fail(400, 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร');
    await c.db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(b.password), u.id);
  }
  await c.db.run('UPDATE users SET display_name = ?, department = ?, role = ?, active = ?, updated_at = ? WHERE id = ?', String(next.display_name).slice(0, 80), String(next.department).slice(0, 80), next.role, next.active, now(), u.id);
  return json(userView(await c.db.get('SELECT * FROM users WHERE id = ?', u.id)));
});
// ล้างออเดอร์ทั้งหมด (ข้อมูลทดสอบ) — IT-Admin เท่านั้น ต้องส่ง confirm: 'RESET'
on('POST', '/api/admin/reset', async (c) => {
  await requirePerm(c, 'accounts');
  const b = await body(c); if (b.confirm !== 'RESET') fail(400, "ต้องยืนยันด้วยคำว่า RESET / Send { confirm: 'RESET' }");
  const r = await wipeOrders(c.env); invalidateStock();
  return json({ ok: true, ...r });
});
on('DELETE', '/api/admin/users/:id', async (c) => {
  const me = await requirePerm(c, 'accounts');
  const u = await c.db.get('SELECT * FROM users WHERE id = ?', c.params.id); if (!u) fail(404, 'ไม่พบผู้ใช้');
  if (u.id === me.id) fail(400, 'ลบบัญชีของตัวเองไม่ได้');
  await c.db.run('DELETE FROM users WHERE id = ?', u.id);
  return json({ ok: true });
});

// Campaigns (everyone can list; it_admin manages)
async function campaignStats(c, camp) {
  const s = await c.db.get(`SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status IN ('paid','picked_up') THEN total ELSE 0 END), 0) AS paid_amount,
    SUM(CASE WHEN status = 'slip_uploaded' THEN 1 ELSE 0 END) AS awaiting_review, SUM(CASE WHEN status = 'slip_rejected' THEN 1 ELSE 0 END) AS on_issue FROM orders WHERE campaign_id = ? AND status <> 'cancelled'`, camp.id);
  return { ...campaignView(camp), stats: { orders: s.orders, paid_amount: s.paid_amount, awaiting_review: s.awaiting_review || 0, on_issue: s.on_issue || 0, slip_issues: (s.awaiting_review || 0) + (s.on_issue || 0) }, stock_view: await stockView(c, camp) };
}
on('GET', '/api/admin/campaigns', async (c) => {
  await requirePerm(c, 'orders_view');
  const out = []; for (const camp of await c.db.all('SELECT * FROM campaigns ORDER BY active DESC, created_at DESC')) out.push(await campaignStats(c, camp));
  return json(out);
});
const setActiveCampaign = (db, id) => db.batch([db.stmt('UPDATE campaigns SET active = 0'), db.stmt('UPDATE campaigns SET active = 1 WHERE id = ?', id)]);
on('POST', '/api/admin/campaigns', async (c) => {
  await requirePerm(c, 'campaigns'); const b = await body(c);
  const v = M.readCampaignBody(b, { promo_from: 2026090001, promo_to: 2026092000, promo_prefix: '', stock_total: 1000 });
  if (v.error) fail(400, v.error);
  if (!v.name) fail(400, 'กรุณาใส่ชื่อแคมเปญ');
  if (!v.slug || v.slug.length < 2) fail(400, 'ลิงก์แคมเปญ (URL) ต้องเป็น a-z, 0-9 อย่างน้อย 2 ตัว');
  if (await c.db.get('SELECT 1 AS x FROM campaigns WHERE slug = ?', v.slug)) fail(409, `ลิงก์ /${v.slug}/ ถูกใช้แล้ว กรุณาตั้งใหม่`);
  let id = M.slugify(v.name); let n = 2;
  while (await getCampaign(c.db, id)) id = `${M.slugify(v.name)}-${n++}`;
  await c.db.run('INSERT INTO campaigns(id, slug, name, active, orders_open, stock_total, stock_drink, stock_dessert, promo_from, promo_to, promo_prefix, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, v.slug, v.name, v.orders_open, v.stock_total, v.stock_drink, v.stock_dessert, v.promo_from, v.promo_to, v.promo_prefix, now(), now());
  if (b.active) await setActiveCampaign(c.db, id);
  return json(await campaignStats(c, await getCampaign(c.db, id)), 201);
});
on('PATCH', '/api/admin/campaigns/:id', async (c) => {
  await requirePerm(c, 'campaigns');
  const camp = await getCampaign(c.db, c.params.id); if (!camp) fail(404, 'ไม่พบแคมเปญ');
  const b = await body(c); const v = M.readCampaignBody(b, camp);
  if (v.error) fail(400, v.error);
  if (!v.name) fail(400, 'กรุณาใส่ชื่อแคมเปญ');
  if (!v.slug || v.slug.length < 2) fail(400, 'ลิงก์แคมเปญ (URL) ต้องเป็น a-z, 0-9 อย่างน้อย 2 ตัว');
  if (await c.db.get('SELECT 1 AS x FROM campaigns WHERE slug = ? AND id <> ?', v.slug, camp.id)) fail(409, `ลิงก์ /${v.slug}/ ถูกใช้แล้ว กรุณาตั้งใหม่`);
  await c.db.run('UPDATE campaigns SET name = ?, slug = ?, orders_open = ?, stock_total = ?, stock_drink = ?, stock_dessert = ?, promo_from = ?, promo_to = ?, promo_prefix = ?, updated_at = ? WHERE id = ?', v.name, v.slug, v.orders_open, v.stock_total, v.stock_drink, v.stock_dessert, v.promo_from, v.promo_to, v.promo_prefix, now(), camp.id);
  if (b.active === true) await setActiveCampaign(c.db, camp.id);
  return json(await campaignStats(c, await getCampaign(c.db, camp.id)));
});
// Campaign design (it_admin): promote images + Match Sets shown on the customer homepage
on('GET', '/api/admin/campaigns/:id/design', async (c) => {
  await requirePerm(c, 'campaigns');
  const camp = await getCampaign(c.db, c.params.id); if (!camp) fail(404, 'ไม่พบแคมเปญ');
  return json({ campaign: campaignView(camp), design: campaignDesign(camp) });
});
on('PUT', '/api/admin/campaigns/:id/design', async (c) => {
  await requirePerm(c, 'campaigns');
  const camp = await getCampaign(c.db, c.params.id); if (!camp) fail(404, 'ไม่พบแคมเปญ');
  const d = M.normalizeDesign(await body(c));
  await c.db.run('UPDATE campaigns SET design_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(d), now(), camp.id);
  return json({ campaign: campaignView(await getCampaign(c.db, camp.id)), design: d });
});
on('POST', '/api/admin/design/upload', async (c) => {
  await requirePerm(c, 'campaigns');
  const f = await readUpload(c, 'image', /^image\/(jpeg|png|webp|gif|svg\+xml)$/);
  if (!f) fail(400, 'กรุณาเลือกไฟล์รูป (jpg/png/webp)');
  const name = `${Date.now()}-${randomHex(6)}${f.ext}`;
  await putFile(c.env, `design/${name}`, f.bytes, f.type, now());
  return json({ url: `/uploads/design/${name}` }, 201);
});

const PAGE_SIZE = 20;
// ─── Customers (ทุกบัญชี Google ที่เคยล็อกอินจากทุกเครื่อง/เบราว์เซอร์) ───
on('GET', '/api/admin/customers', async (c) => {
  await requirePerm(c, 'orders_view'); const qp = c.url.searchParams;
  const q = String(qp.get('q') || '').trim().toLowerCase();
  const cparam = String(qp.get('campaign') || '');
  const camp = cparam === 'all' ? null : (cparam ? await getCampaign(c.db, cparam) : await activeCampaign(c.db));
  if (cparam && cparam !== 'all' && !camp) fail(404, 'ไม่พบแคมเปญ');
  const where = ["(c.google_sub IS NOT NULL OR COALESCE(c.email, '') <> '')"]; const args = [];   // บัญชี Google หรือลูกค้าที่กรอกอีเมลตอนสั่งซื้อ
  const ordersWhere = ["status <> 'cancelled'" + (camp ? ' AND campaign_id = ?' : '')]; const oargs = camp ? [camp.id] : [];
  if (camp) where.push('(cc.customer_id IS NOT NULL OR o.customer_id IS NOT NULL)');
  if (q) { where.push('(lower(c.email) LIKE ? OR lower(c.name) LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const body_ = `FROM customers c
    LEFT JOIN (SELECT customer_id, COUNT(*) AS orders, SUM(CASE WHEN status IN ('paid','picked_up') THEN total ELSE 0 END) AS paid_total, MAX(created_at) AS last_order_at FROM orders WHERE ${ordersWhere.join(' AND ')} GROUP BY customer_id) o ON o.customer_id = c.id
    ${camp ? 'LEFT JOIN customer_campaigns cc ON cc.customer_id = c.id AND cc.campaign_id = ?' : ''}
    WHERE ${where.join(' AND ')}`;
  const allArgs = [...oargs, ...(camp ? [camp.id] : []), ...args];
  const total = (await c.db.get(`SELECT COUNT(*) AS n ${body_}`, ...allArgs)).n;
  const exp = qp.get('export') === '1';
  const page = exp ? 1 : Math.max(1, parseInt(qp.get('page'), 10) || 1);
  const rows = await c.db.all(`SELECT c.id, c.email, c.name, c.picture, c.created_at, c.last_login_at, c.last_seen_at, COALESCE(o.orders, 0) AS orders, COALESCE(o.paid_total, 0) AS paid_total, o.last_order_at${camp ? ', cc.first_seen_at AS joined_at' : ''} ${body_}
    ORDER BY COALESCE(c.last_login_at, c.last_seen_at) DESC, c.created_at DESC ${exp ? '' : 'LIMIT ? OFFSET ?'}`, ...allArgs, ...(exp ? [] : [PAGE_SIZE, (page - 1) * PAGE_SIZE]));
  return json({ campaign: camp ? campaignPublic(camp) : null, page, pages: exp ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE)), total, rows });
});
on('GET', '/api/admin/orders', async (c) => {
  await requirePerm(c, 'orders_view'); const qp = c.url.searchParams;
  const q = String(qp.get('q') || '').trim(), date = String(qp.get('date') || '').trim(), store = String(qp.get('store') || '').trim(), status = String(qp.get('status') || '').trim(), campaign = String(qp.get('campaign') || '').trim();
  const page = Math.max(1, parseInt(qp.get('page'), 10) || 1);
  const where = []; const args = [];
  // ค้นหาได้ทั้งเลขออเดอร์ สาขา เบอร์ติดต่อ และอีเมล/ชื่อบัญชี Google ของผู้สั่ง
  if (q) { where.push('(order_number LIKE ? OR store_name LIKE ? OR phone LIKE ? OR email LIKE ? OR customer_id IN (SELECT id FROM customers WHERE email LIKE ? OR name LIKE ?))'); args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (date) { where.push('substr(created_at, 1, 10) = ?'); args.push(date); }
  if (store) { where.push('store_id = ?'); args.push(store); }
  if (status) { where.push(`status IN (${status.split(',').map(() => '?').join(',')})`); args.push(...status.split(',')); }
  if (campaign) { where.push('campaign_id = ?'); args.push(campaign); }
  const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = (await c.db.get(`SELECT COUNT(*) AS n FROM orders${w}`, ...args)).n;
  const ids = await c.db.all(`SELECT id FROM orders${w} ORDER BY created_at DESC, order_number DESC LIMIT ? OFFSET ?`, ...args, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const rows = []; for (const { id } of ids) rows.push(await orderView(c, await getOrder(c.db, id), { admin: true }));
  return json({ page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, rows });
});
on('GET', '/api/admin/orders/:id', async (c) => { await requirePerm(c, 'orders_view'); const o = await getOrder(c.db, c.params.id); if (!o) fail(404, 'ไม่พบคำสั่งซื้อ'); return json(await orderView(c, o, { admin: true })); });
const TRANSITIONS = {
  paid: { from: ['pending', 'slip_uploaded', 'slip_rejected'], perm: 'slip_review', stamp: 'paid_at' },
  slip_rejected: { from: ['slip_uploaded', 'slip_rejected'], perm: 'slip_review' },   // Reject ซ้ำได้ระหว่างรอสลิปใหม่ (แจ้งทีมการตลาดอีกครั้ง)
  picked_up: { from: ['paid'], perm: 'pickup', stamp: 'picked_up_at' },
  cancelled: { from: ['pending', 'slip_uploaded', 'slip_rejected', 'paid'], perm: 'cancel', stamp: 'cancelled_at' },
};
on('POST', '/api/admin/orders/:id/status', async (c) => {
  const u = await requirePerm(c, 'orders_view');
  const o = await getOrder(c.db, c.params.id); if (!o) fail(404, 'ไม่พบคำสั่งซื้อ');
  const b = await body(c); const to = String(b.status || ''); const t = TRANSITIONS[to];
  if (!t) fail(400, 'สถานะไม่ถูกต้อง');
  if (!can(u, t.perm)) fail(403, 'สิทธิ์ไม่เพียงพอ / Not allowed for your role');
  if (!t.from.includes(o.status)) fail(400, `เปลี่ยนสถานะจาก ${o.status} เป็น ${to} ไม่ได้`);
  const reason = to === 'slip_rejected' ? String(b.reason || 'สลิปไม่ถูกต้อง กรุณาอัปโหลดใหม่').slice(0, 300) : (to === 'paid' ? 'ตรวจสอบผ่าน' : o.slip_reason);
  await c.db.run(`UPDATE orders SET status = ?, slip_reason = ?${t.stamp ? `, ${t.stamp} = ?` : ''} WHERE id = ?`, ...(t.stamp ? [to, reason, now(), o.id] : [to, reason, o.id]));
  invalidateStock();
  if (to === 'paid') await notifyApproved(c, o.id);   // บัญชีอนุมัติ → อีเมลยืนยันถึงลูกค้า
  if (to === 'slip_rejected') { await notifyIssue(c, o.id, { by: u.username || u.name || '', reason }); await notifyRejected(c, o.id, { reason }); }   // Reject → แจ้งทีมการตลาด + แจ้งลูกค้าให้อัปโหลดใหม่
  return json(await orderView(c, await getOrder(c.db, o.id), { admin: true }));
});
on('GET', '/api/admin/summary', async (c) => {
  await requirePerm(c, 'orders_view'); const qp = c.url.searchParams;
  const date = String(qp.get('date') || '').trim(), campaign = String(qp.get('campaign') || '').trim();
  const where = []; const args = [];
  if (date) { where.push('substr(created_at,1,10) = ?'); args.push(date); }
  if (campaign) { where.push('campaign_id = ?'); args.push(campaign); }
  const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const by_status = await c.db.all(`SELECT status, COUNT(*) n, COALESCE(SUM(total),0) amount FROM orders${w} GROUP BY status`, ...args);
  const by_store = await c.db.all(`SELECT store_id, store_name, COUNT(*) AS total, SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS to_pickup, SUM(CASE WHEN status = 'picked_up' THEN 1 ELSE 0 END) AS picked_up,
    SUM(CASE WHEN status = 'slip_uploaded' THEN 1 ELSE 0 END) AS awaiting_review, SUM(CASE WHEN status IN ('pending','slip_rejected') THEN 1 ELSE 0 END) AS unpaid
    FROM orders${w}${w ? ' AND' : ' WHERE'} status <> 'cancelled' GROUP BY store_id, store_name ORDER BY store_name`, ...args);
  const camp = campaign ? ((await getCampaign(c.db, campaign)) || (await activeCampaign(c.db))) : await activeCampaign(c.db);
  return json({ by_status, by_store, stock: await stockView(c, camp) });
});
// ทดสอบเท่านั้น (TEST_MODE=1 ตอนรัน wrangler pages dev): เข้าถึงฐานข้อมูลตรง
on('POST', '/api/_test/sql', async (c) => {
  if (!c.env.TEST_MODE) fail(404, 'not found');
  const { sql: q, args = [], mode = 'run' } = await body(c);
  const r = mode === 'get' ? await c.db.get(q, ...args) : mode === 'all' ? await c.db.all(q, ...args) : (await c.db.run(q, ...args)).meta;
  return json({ result: r ?? null });
});

// ─── slip images: only the owner or a logged-in back-office user ───
export async function serveSlip(c, name) {
  const key = `slips/${name}`;
  const o = await c.db.get('SELECT customer_id FROM orders WHERE slip_path = ?', key);
  if (!o || (o.customer_id !== c.customerId && !(await adminUser(c)))) return new Response('', { status: 404 });
  const obj = await getFile(c.env, key); if (!obj) return new Response('', { status: 404 });
  return new Response(obj.body, { headers: { 'content-type': obj.type || 'image/jpeg', 'cache-control': 'no-store' } });
}
// design images (promote / set pictures) are public
export async function serveDesign(c, name) {
  const obj = await getFile(c.env, `design/${name}`); if (!obj) return new Response('', { status: 404 });
  const h = { 'content-type': obj.type || 'image/jpeg', 'cache-control': 'public, max-age=604800' };
  if (/\.svg$/i.test(name)) Object.assign(h, { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' });
  return new Response(obj.body, { headers: h });
}

/** Build the request context (customer identity cookie) — shared by API and upload routes */
export async function makeContext(req, env, ctx) {
  const url = new URL(req.url);
  const c = { req, env, ctx, url, db: sql(env), cookies: [], secure: url.protocol === 'https:', params: {} };
  const t = await verifyToken(parseCookies(req)[CUSTOMER_COOKIE], secretOf(env));
  if (t && t.cid) c.customerId = t.cid; else await setCustomerCookie(c, uuid());
  return c;
}
export function withCookies(res, c) {
  if (!c.cookies.length) return res;
  const out = new Response(res.body, res);
  for (const ck of c.cookies) out.headers.append('set-cookie', ck);
  return out;
}
export async function handleApi(c) {
  const method = c.req.method.toUpperCase(); const path = c.url.pathname;
  try {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re); if (!m) continue;
      c.params = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      return await r.handler(c);
    }
    return json({ error: 'not found' }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json(e.body, e.status);
    console.error(e && e.stack || e);
    return json({ error: 'server error' }, 500);
  }
}
