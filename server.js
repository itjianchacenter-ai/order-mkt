require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { db, nextOrderNumber, DB_PATH, ROLES, hashPassword, checkPassword, seedDefaults } = require('./db');
const { generateQR } = require('./qr');
const { bankAccount, paymentMode } = require('./lib/payment');
const qrConfigured = () => Boolean(paymentMode(process.env));   // มีวิธีรับเงิน (บัญชีธนาคาร หรือ PromptPay)
const { verifySlip, isEnabled: slipOkEnabled } = require('./slip-verify');
const mailer = require('./mailer');
const M = require('./lib/menu');
const W = require('./lib/window');
const { approvalEmail: approvalEmailOf, issueEmail, rejectEmail, normalizeEmail, validEmail } = require('./lib/email');

const PORT = parseInt(process.env.PORT || '3870', 10);
const IS_PROD = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-order-jianchatea';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DESIGN_DIR = path.join(UPLOAD_DIR, 'design');   // promote / set images uploaded on the Design page (public)
fs.mkdirSync(DESIGN_DIR, { recursive: true });

if (IS_PROD && JWT_SECRET === 'dev-secret-order-jianchatea') {
  console.error('[boot] FATAL: set JWT_SECRET in .env before running in production.');
  process.exit(1);
}

// ─── JSON files that ops can edit without a restart ───
function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); } catch (e) { return fallback; }
}
function loadMenu() { return M.normalizeMenu(readJson('menu.json', { sets: [] })); }
function loadStores() { return M.normalizeStores(readJson('stores.json', [])); }
// สาขาให้เลือกที่หน้าสมัครสมาชิก (Location) — จากรายชื่อสาขา JIANCHA ทั้งหมด เรียงตามชื่อ
function loadMemberStores() { return M.normalizeStores(readJson('member-stores.json', [])).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })); }
// Campaign design (promote images + Match Sets) lives in lib/menu.js; a campaign without a saved design uses data/menu.json as its template.
const { normalizeDesign, slugOf, slugify, lim, readCampaignBody } = M;
const campaignDesign = (c) => M.campaignDesign(c, loadMenu());
/** What the customer site sells for a campaign: its design's active sets and promote images. */
const menuFor = (c) => M.menuFor(c, loadMenu());

// First run: the three back-office accounts and the first campaign (stock / promo range seeded from menu.json)
{
  const m = loadMenu();
  seedDefaults({ campaign: { stock_total: m.stock.total, stock_drink: m.stock.drink, stock_dessert: m.stock.dessert, promo_from: m.promo_code.from, promo_to: m.promo_code.to, promo_prefix: m.promo_code.prefix } });
}

// ─── Campaigns, stock, promotion codes ───
function activeCampaign() {
  return db.prepare('SELECT * FROM campaigns WHERE active = 1 ORDER BY created_at LIMIT 1').get()
    || db.prepare('SELECT * FROM campaigns ORDER BY created_at LIMIT 1').get();
}
function getCampaign(id) { return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id); }
/** Campaign by its customer URL slug (order.jianchatea.com/<slug>/); also accepts the id for older links. */
function campaignBySlug(slug) {
  const s = slugOf(slug); if (!s) return null;
  return db.prepare('SELECT * FROM campaigns WHERE slug = ?').get(s) || db.prepare("SELECT * FROM campaigns WHERE lower(replace(id, '-', '')) = ?").get(s) || null;
}
/** The campaign a customer request is about: ?campaign=<slug> / body.campaign, otherwise the active one. */
function requestCampaign(req) {
  const s = (req.query && req.query.campaign) || (req.body && req.body.campaign) || '';
  return (s && campaignBySlug(s)) || activeCampaign();
}
function campaignView(c) {
  const d = campaignDesign(c);
  return { id: c.id, slug: c.slug, url: `/${c.slug}/`, name: c.name, active: Boolean(c.active), orders_open: c.orders_open !== 0, stock: { total: c.stock_total, drink: c.stock_drink, dessert: c.stock_dessert }, promo_code: M.promoRangeView(c), created_at: c.created_at,
    cover: d.promote_images[0] || '', set_count: d.sets.filter((x) => x.active).length, has_design: Boolean(c.design_json) };
}
const campaignPublic = (c) => ({ id: c.id, slug: c.slug, url: `/${c.slug}/`, name: c.name, active: Boolean(c.active), orders_open: c.orders_open !== 0 });
/** Pieces committed by every non-cancelled order of a campaign (pending ones reserve stock). */
function stockUsage(campaignId) {
  const r = db.prepare(`SELECT COALESCE(SUM(l.quantity * COALESCE(l.pieces, 1)), 0) AS total,
                               COALESCE(SUM(l.quantity * COALESCE(l.drink_pieces, 0)), 0) AS drink,
                               COALESCE(SUM(l.quantity * COALESCE(l.dessert_pieces, 0)), 0) AS dessert
                        FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.status <> 'cancelled' AND o.campaign_id = ?`).get(campaignId);
  const h = db.prepare('SELECT COALESCE(SUM(sets), 0) AS total, COALESCE(SUM(drink), 0) AS drink, COALESCE(SUM(dessert), 0) AS dessert FROM holds WHERE campaign_id = ? AND expires_at > ?').get(campaignId, W.bangkokNow());   // คิวที่จองไว้ (รอชำระเงิน)
  return { drink: r.drink + h.drink, dessert: r.dessert + h.dessert, total: r.total + h.total, held: h.total };
}
const holdMinutes = () => Math.max(1, Number(process.env.HOLD_MINUTES) || 15);   // เวลาจองคิวหลังกด Confirm (นาที)
function stockView(c) {
  const limits = { total: c.stock_total, drink: c.stock_drink, dessert: c.stock_dessert };
  const used = stockUsage(c.id); const remaining = {};
  for (const k of ['total', 'drink', 'dessert']) remaining[k] = limits[k] == null ? null : Math.max(0, limits[k] - used[k]);
  return { limits, used, remaining, sold_out: ['total', 'drink', 'dessert'].some((k) => remaining[k] === 0), order_window: orderWindow(c) };
}
// ─── ช่วงเปิดรับออเดอร์ + โควตาต่อวัน (นับตามวันเวลาไทย; lib/window.js) ───
// วันของรอบสั่ง: วันนี้ (เวลาไทย) หรือรอบวันแรกเมื่ออยู่ในช่วงเปิดล่วงหน้า ORDER_EARLY_HOURS ชั่วโมงก่อนวันแรก
const bangkokToday = (menu) => W.effectiveOrderDay((menu || loadMenu()).order_days, { override: process.env.ORDER_DAY_OVERRIDE, earlyHours: parseFloat(process.env.ORDER_EARLY_HOURS || '0') || 0 });
const { fmtDayTH, fmtDayEN } = W;
/** สถานะการรับออเดอร์ของแคมเปญวันนี้: open | before | closed | full (+ ข้อความแจ้งลูกค้า) */
function orderWindow(c) {
  const menu = menuFor(c); const days = menu.order_days || []; const today = bangkokToday(menu);
  // โควตาต่อวันนับเป็น "ชุด" (quantity × pieces) ไม่ใช่จำนวนออเดอร์
  const SETS = 'COALESCE(SUM(l.quantity * COALESCE(l.pieces, 1)), 0) AS n';
  const today_count = db.prepare(`SELECT ${SETS} FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.campaign_id = ? AND o.order_day = ? AND o.status <> 'cancelled'`).get(c.id, today).n;
  const total_count = days.length ? db.prepare(`SELECT ${SETS} FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.campaign_id = ? AND o.status <> 'cancelled' AND o.order_day IN (${days.map(() => '?').join(',')})`).get(c.id, ...days).n : today_count;
  const ts = W.bangkokNow();
  const today_held = db.prepare('SELECT COALESCE(SUM(sets), 0) AS n FROM holds WHERE campaign_id = ? AND order_day = ? AND expires_at > ?').get(c.id, today, ts).n;
  const total_held = days.length ? db.prepare(`SELECT COALESCE(SUM(sets), 0) AS n FROM holds WHERE campaign_id = ? AND expires_at > ? AND order_day IN (${days.map(() => '?').join(',')})`).get(c.id, ts, ...days).n : today_held;
  return { ...W.computeOrderWindow(menu, today, { today_count: today_count + today_held, total_count: total_count + total_held }), today_held };
}
const stockShortfall = (want, c) => M.stockShortfall(want, stockView(c).remaining);

const app = express();
app.set('trust proxy', 1);   // อยู่หลัง reverse proxy / Cloudflare: อ่าน IP และ https จาก X-Forwarded-*
app.disable('x-powered-by');
// API และรูปสลิปห้าม cache ที่ CDN/Cloudflare (ข้อมูลออเดอร์/สต๊อก/โควตาต้องสดเสมอ)
app.use(['/api', '/uploads'], (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ─── Customer identity: anonymous httpOnly cookie, one per browser ───
const CUSTOMER_COOKIE = 'jc_cid';
app.use((req, res, next) => {
  let cid = req.cookies[CUSTOMER_COOKIE];
  if (cid) {
    try { cid = jwt.verify(cid, JWT_SECRET).cid; } catch (e) { cid = null; }
  }
  if (!cid) {
    cid = crypto.randomUUID();
    res.cookie(CUSTOMER_COOKIE, jwt.sign({ cid }, JWT_SECRET), {
      httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 365 * 24 * 3600 * 1000, path: '/',
    });
  }
  req.customerId = cid;
  next();
});
// ─── Customer login with Google (Sign in with Google → ID token → verified here) ───
// GOOGLE_CLIENT_ID ว่าง = ยังไม่เปิดใช้ login (สั่งซื้อแบบไม่ล็อกอินเหมือนเดิม) — ตั้งค่าแล้วลูกค้าต้องล็อกอินก่อนกด Confirm
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const loginRequired = () => Boolean(GOOGLE_CLIENT_ID);
const customerRow = (id) => db.prepare('SELECT id, google_sub, email, name, picture, pdpa_accepted_at FROM customers WHERE id = ?').get(id) || null;
const customerLoggedIn = (id) => { const c = customerRow(id); return Boolean(c && c.google_sub); };
function meView(id) {
  const c = customerRow(id); const logged_in = Boolean(c && c.google_sub);
  return { logged_in, login_required: loginRequired(), google_client_id: GOOGLE_CLIENT_ID, email: logged_in ? c.email : '', name: logged_in ? c.name : '', picture: logged_in ? c.picture : '', pdpa_accepted_at: (c && c.pdpa_accepted_at) || '' };
}
// ตรวจ ID token กับ Google (tokeninfo ตรวจลายเซ็นให้) แล้วเช็ค aud/iss/exp/email_verified เอง
async function verifyGoogleToken(credential) {
  if (!credential || typeof credential !== 'string' || credential.length > 4096) throw new Error('bad credential');
  const url = (process.env.GOOGLE_TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo') + '?id_token=' + encodeURIComponent(credential);
  const r = await fetch(url); const p = await r.json().catch(() => null);
  if (!r.ok || !p || !p.sub) throw new Error('token rejected');
  if (p.aud !== GOOGLE_CLIENT_ID) throw new Error('aud mismatch');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(p.iss)) throw new Error('iss mismatch');
  if (Number(p.exp) * 1000 < Date.now()) throw new Error('expired');
  if (String(p.email_verified) !== 'true') throw new Error('email not verified');
  return { sub: p.sub, email: p.email, name: p.name || p.email, picture: p.picture || '' };
}
function linkCustomerCampaign(customerId, campaignId) {
  if (!customerId || !campaignId) return;
  db.prepare(`INSERT INTO customer_campaigns(customer_id, campaign_id) VALUES (?, ?) ON CONFLICT(customer_id, campaign_id) DO UPDATE SET last_seen_at = datetime('now','localtime')`).run(customerId, campaignId);
}
function setCustomerCookie(res, cid) {
  res.cookie(CUSTOMER_COOKIE, jwt.sign({ cid }, JWT_SECRET), { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 365 * 24 * 3600 * 1000, path: '/' });
}
app.get('/api/me', (req, res) => res.json(meView(req.customerId)));
// ลูกค้ากดยอมรับ PDPA (pop-up หน้าแคมเปญ) → บันทึกเวลาไว้กับตัวตนของเบราว์เซอร์/บัญชี Google (ติดไปกับบัญชีเมื่อล็อกอิน)
app.post('/api/pdpa', (req, res) => {
  touchCustomer(req.customerId);
  db.prepare("UPDATE customers SET pdpa_accepted_at = COALESCE(pdpa_accepted_at, datetime('now','localtime')) WHERE id = ?").run(req.customerId);
  res.json(meView(req.customerId));
});
app.post('/api/auth/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า Google login (GOOGLE_CLIENT_ID)' });
  let g; try { g = await verifyGoogleToken(req.body && req.body.credential); } catch (e) { return res.status(401).json({ error: 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่ / Google sign-in failed' }); }
  const anon = req.customerId;
  let acct = db.prepare('SELECT id FROM customers WHERE google_sub = ?').get(g.sub);
  // บัญชีที่เตรียมไว้ล่วงหน้าด้วยอีเมล (เช่น เจ้าของออเดอร์เดิม) ยังไม่เคยล็อกอิน → ผูกกับ Google account นี้
  if (!acct && g.email) acct = db.prepare('SELECT id FROM customers WHERE google_sub IS NULL AND lower(email) = ? ORDER BY created_at LIMIT 1').get(String(g.email).toLowerCase()) || null;
  const tx = db.transaction(() => {
    if (!acct) {
      // บัญชีใหม่: ใช้แถวลูกค้าของเบราว์เซอร์นี้เป็นบัญชี (ออเดอร์ที่สั่งไว้ก่อนล็อกอินติดมาด้วย)
      touchCustomer(anon); acct = { id: anon };
    } else if (acct.id !== anon) {
      // เคยล็อกอินจากเครื่องอื่น: ย้ายออเดอร์ที่สั่งแบบไม่ล็อกอินในเบราว์เซอร์นี้ไปไว้กับบัญชี (และการยอมรับ PDPA ถ้าบัญชียังไม่มี)
      db.prepare('UPDATE orders SET customer_id = ? WHERE customer_id = ?').run(acct.id, anon);
      db.prepare('UPDATE customers SET pdpa_accepted_at = (SELECT pdpa_accepted_at FROM customers WHERE id = ?) WHERE id = ? AND pdpa_accepted_at IS NULL').run(anon, acct.id);
    }
    db.prepare(`UPDATE customers SET google_sub = ?, email = ?, name = ?, picture = ?, last_login_at = datetime('now','localtime'), last_seen_at = datetime('now','localtime') WHERE id = ?`).run(g.sub, g.email, g.name, g.picture, acct.id);
  });
  tx();
  const fromCampaign = req.body && req.body.campaign ? campaignBySlug(String(req.body.campaign)) : null;
  if (fromCampaign) linkCustomerCampaign(acct.id, fromCampaign.id);
  // ออเดอร์เก่าของบัญชี → ผูกแคมเปญให้ครบ (กรณีสั่งไว้ก่อนมีตารางนี้)
  for (const r of db.prepare('SELECT DISTINCT campaign_id FROM orders WHERE customer_id = ? AND campaign_id IS NOT NULL').all(acct.id)) linkCustomerCampaign(acct.id, r.campaign_id);
  setCustomerCookie(res, acct.id); req.customerId = acct.id;
  res.json(meView(acct.id));
});
app.post('/api/auth/logout', (req, res) => {
  // ออกจากระบบ = เริ่มตัวตนใหม่แบบไม่ล็อกอินในเบราว์เซอร์นี้ (ออเดอร์ยังอยู่กับบัญชี Google)
  const cid = crypto.randomUUID(); setCustomerCookie(res, cid); req.customerId = cid;
  res.json(meView(cid));
});

function touchCustomer(id) {
  db.prepare(`INSERT INTO customers(id) VALUES (?) ON CONFLICT(id) DO UPDATE SET last_seen_at = datetime('now','localtime')`).run(id);
}

// ─── Back-office auth & roles ───
// it_admin: everything · admin (marketing): view orders, pick-up, codes · finance: approve/reject slips, cancel
const PERMS = {
  orders_view: ['it_admin', 'admin', 'finance'],
  slip_review: ['it_admin', 'finance'],
  pickup: ['it_admin', 'admin', 'finance'],
  cancel: ['it_admin', 'finance'],
  code: ['it_admin', 'admin', 'finance'],
  accounts: ['it_admin'],
  campaigns: ['it_admin'],
  member_list: ['it_admin', 'admin'],   // อัปโหลดรายชื่อ ELITE
};
const ADMIN_COOKIE = 'jc_admin';
function adminFromReq(req) {
  if (req._adminUser !== undefined) return req._adminUser;
  let u = null;
  try {
    const t = jwt.verify(req.cookies[ADMIN_COOKIE] || '', JWT_SECRET);
    const row = db.prepare('SELECT id, username, role, display_name, department, active FROM users WHERE id = ?').get(t.uid);
    if (row && row.active) u = row;
  } catch (e) { /* not logged in */ }
  req._adminUser = u;
  return u;
}
const can = (user, perm) => Boolean(user && PERMS[perm] && PERMS[perm].includes(user.role));
function requirePerm(perm) {
  return (req, res, next) => {
    const u = adminFromReq(req);
    if (!u) return res.status(401).json({ error: 'unauthorized' });
    if (!can(u, perm)) return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอ / Not allowed for your role' });
    next();
  };
}
const requireAdmin = requirePerm('orders_view');
function userView(u) { return { id: u.id, username: u.username, role: u.role, display_name: u.display_name, department: u.department, active: Boolean(u.active), created_at: u.created_at }; }
function permissionsOf(u) { const p = {}; for (const k of Object.keys(PERMS)) p[k] = can(u, k); return p; }

// ─── Static pages ───
app.get('/backend', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin-page.html')));   // หลังบ้าน JIANCHA Page
app.get('/admin-page', (req, res) => res.redirect(301, '/backend' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));   // ลิงก์เก่า
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'landing.html')));   // "Order with us" -> active campaign page
app.use(express.static(PUBLIC_DIR, { extensions: ['html'], index: false }));

// ─── Public API ───
app.get('/api/menu', (req, res) => { const c = requestCampaign(req); res.json({ ...menuFor(c), campaign: campaignPublic(c), stock: stockView(c) }); });
app.get('/api/stock', (req, res) => res.json(stockView(requestCampaign(req))));
app.get('/api/stores', (req, res) => res.json(loadStores()));
app.get('/api/member-stores', (req, res) => res.json(loadMemberStores()));   // Location ของหน้าสมัครสมาชิก
// รายชื่อ ELITE: เบอร์ใช้สมัครได้ไหม (ไม่มีรายชื่อ + แคมเปญไม่บังคับ = ได้ทุกเบอร์)
function eliteOk(campaign, phone) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM member_list').get().n;
  return !M.memberListRequired(campaign, n) || Boolean(db.prepare('SELECT 1 FROM member_list WHERE phone = ?').get(phone));
}
// ตรวจเบอร์ทันทีที่ลูกค้ากรอก: { campaign, phone } → { eligible }
app.post('/api/members/check', (req, res) => {
  const b = req.body || {}; const campaign = b.campaign ? campaignBySlug(String(b.campaign)) : null;
  if (!campaign) return res.status(404).json({ error: 'ไม่พบแคมเปญ / Campaign not found' });
  const phone = M.normPhoneTH(b.phone); if (!phone) return res.status(400).json({ error: 'กรุณาใส่เบอร์โทรศัพท์มือถือ 10 หลัก / Please enter a valid phone number', field: 'phone' });
  const eligible = eliteOk(campaign, phone);
  const row = eligible ? db.prepare('SELECT email FROM member_list WHERE phone = ?').get(phone) : null;
  res.json({ eligible, message: eligible ? '' : M.NOT_ELITE_MESSAGE, email_masked: row ? M.maskEmail(row.email) : '' });
});
// สมัครสมาชิก (หน้าแรกแบบ Membership): { campaign: slug, first_name, last_name, phone, pickup_time, store_id }
//   1 เบอร์ต่อ 1 แคมเปญ — ส่งซ้ำด้วยเบอร์เดิม = อัปเดตข้อมูลเดิม
app.post('/api/members', (req, res) => {
  const b = req.body || {};
  const campaign = b.campaign ? campaignBySlug(String(b.campaign)) : null;
  if (!campaign) return res.status(404).json({ error: 'ไม่พบแคมเปญ / Campaign not found' });
  if (campaignDesign(campaign).home !== 'membership') return res.status(400).json({ error: 'แคมเปญนี้ไม่ได้เปิดรับสมัครสมาชิก / This campaign has no membership sign-up' });
  const v = M.readMemberBody(b, menuFor(campaign), loadMemberStores());
  if (v.error) return res.status(400).json({ error: v.error, field: v.field });
  if (!eliteOk(campaign, v.phone)) return res.status(403).json({ error: M.NOT_ELITE_MESSAGE, field: 'phone', not_elite: true });
  const ts = W.bangkokNow(); const store_name = `${v.store.brand} - ${v.store.name}`;
  const email = v.use_list_email ? ((db.prepare('SELECT email FROM member_list WHERE phone = ?').get(v.phone) || {}).email || '').toLowerCase() : v.email;
  db.prepare(`INSERT INTO members(id, campaign_id, customer_id, first_name, last_name, phone, email, pickup_time, store_id, store_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, phone) DO UPDATE SET customer_id = excluded.customer_id, first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email, pickup_time = excluded.pickup_time, store_id = excluded.store_id, store_name = excluded.store_name, updated_at = excluded.updated_at`)
    .run(crypto.randomUUID(), campaign.id, req.customerId || null, v.first_name, v.last_name, v.phone, email, v.pickup_time, v.store.id, store_name, ts, ts);
  const m = db.prepare('SELECT first_name, last_name, phone, email, pickup_time, store_id, store_name, created_at, updated_at FROM members WHERE campaign_id = ? AND phone = ?').get(campaign.id, v.phone);
  res.status(201).json({ ok: true, member: m, campaign: campaignPublic(campaign) });
});
app.get('/api/config', (req, res) => res.json({ payment_ready: qrConfigured(), payment_mode: paymentMode(process.env), slip_auto_verify: slipOkEnabled(), login_required: loginRequired(), google_client_id: GOOGLE_CLIENT_ID }));


function getOrder(id) {
  const o = db.prepare('SELECT o.*, c.name AS campaign_name FROM orders o LEFT JOIN campaigns c ON c.id = o.campaign_id WHERE o.id = ?').get(id);
  if (!o) return null;
  o.lines = db.prepare('SELECT * FROM order_lines WHERE order_id = ? ORDER BY id').all(id);
  return o;
}
const PAYABLE = ['pending', 'slip_rejected'];               // customer may (re)scan the QR and upload a slip
const SLIP_ACCEPTED = ['pending', 'slip_uploaded', 'slip_rejected'];
function orderView(o, { admin = false } = {}) {
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
  // หลังบ้านเห็นบัญชี Google (อีเมล/ชื่อ) ของผู้สั่ง เผื่อต้องติดต่อ (บัญชีที่เตรียมไว้ล่วงหน้ายังไม่ล็อกอินก็แสดงอีเมล)
  if (admin) {
    const c = customerRow(o.customer_id); Object.assign(v, { customer_email: (c && c.email) || '', customer_name: (c && c.name) || '', customer_google: Boolean(c && c.google_sub) });
    const m = db.prepare("SELECT to_email, status, error, created_at FROM mail_log WHERE order_id = ? AND kind = 'approved' ORDER BY id DESC LIMIT 1").get(o.id);
    v.approval_mail = m ? { to: m.to_email, status: m.status, error: m.error || '', at: m.created_at } : null;
    const im = db.prepare("SELECT to_email, status, error, created_at FROM mail_log WHERE order_id = ? AND kind = 'issue' ORDER BY id DESC LIMIT 1").get(o.id);
    v.issue_mail = im ? { to: im.to_email, status: im.status, error: im.error || '', at: im.created_at } : null;
    const rm = db.prepare("SELECT to_email, status, error, created_at FROM mail_log WHERE order_id = ? AND kind = 'rejected' ORDER BY id DESC LIMIT 1").get(o.id);
    v.reject_mail = rm ? { to: rm.to_email, status: rm.status, error: rm.error || '', at: rm.created_at } : null;
  }
  if (admin) Object.assign(v, { pdpa_accepted_at: o.pdpa_accepted_at || '' });
  if (admin) Object.assign(v, { customer_id: o.customer_id, slip_url: o.slip_path ? `/uploads/${path.basename(o.slip_path)}` : '', slip_ref: o.slip_ref, slip_amount: o.slip_amount, slip_verified: o.slip_verified, cancelled_at: o.cancelled_at });
  return v;
}
function ownOrderOr404(req, res) {
  const o = getOrder(req.params.id);
  if (!o || (o.customer_id !== req.customerId && !adminFromReq(req))) { res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ' }); return null; }
  return o;
}

app.get('/api/orders', (req, res) => {
  // ประวัติการสั่งซื้อแยกตามบัญชี Google: ยังไม่ล็อกอิน (เมื่อเปิดใช้ login) = ไม่มีออเดอร์
  if (loginRequired() && !customerLoggedIn(req.customerId)) return res.json([]);
  const ids = db.prepare('SELECT id FROM orders WHERE customer_id = ? ORDER BY created_at DESC, order_number DESC LIMIT 100').all(req.customerId);
  res.json(ids.map(({ id }) => orderView(getOrder(id))));
});
app.get('/api/orders/:id', (req, res) => { const o = ownOrderOr404(req, res); if (o) res.json(orderView(o)); });

app.get('/api/orders/:id/qr', async (req, res) => {
  const o = ownOrderOr404(req, res); if (!o) return;
  if (!PAYABLE.includes(o.status)) return res.status(400).json({ error: 'คำสั่งซื้อนี้ไม่ได้อยู่ในสถานะรอชำระเงิน' });
  if (!qrConfigured()) return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่าบัญชีรับเงินของร้าน (BANK_ACCOUNT_NO หรือ PROMPTPAY_ID)' });
  if (!(o.total > 0)) return res.status(400).json({ error: 'ยอดคำสั่งซื้อเป็น 0 ไม่ต้องชำระเงิน' });
  // โอนเข้าบัญชีธนาคาร: ส่งรายละเอียดบัญชีให้ลูกค้าโอนเอง; PromptPay: ส่ง QR ตามยอด
  const bank = bankAccount(process.env);
  if (bank) return res.json({ bank, amount: o.total });
  try { res.json({ qr_data_url: await generateQR(o.total), amount: o.total }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Hand out (or repeat) the POS promotion code for a paid order: a random unused
// number in the campaign's range, assigned once and stored on the order.
const assignPromoCode = db.transaction((orderId) => {
  const o = db.prepare('SELECT status, promo_code, campaign_id FROM orders WHERE id = ?').get(orderId);
  if (!o) { const e = new Error('ไม่พบคำสั่งซื้อ'); e.status = 404; throw e; }
  if (o.promo_code) return o.promo_code;
  if (!['paid', 'picked_up'].includes(o.status)) { const e = new Error('รับ code ได้เมื่อชำระเงินเรียบร้อยแล้ว / Available after payment'); e.status = 400; throw e; }
  const c = getCampaign(o.campaign_id) || activeCampaign();
  // เรียงลำดับตามการอนุมัติ: เลขสูงสุดที่เคยออกในแคมเปญ + 1 (ไม่ใช้ซ้ำแม้ออเดอร์ถูกยกเลิก) รูปแบบ prefix + เลขเติมศูนย์ เช่น NVR260001
  const usedRows = db.prepare('SELECT promo_code FROM orders WHERE campaign_id = ? AND promo_code IS NOT NULL').all(c.id);
  const n = M.nextPromoNumber(usedRows.map((r) => r.promo_code), c);
  if (n == null) { const e = new Error('รหัสโปรโมชันถูกใช้ครบแล้ว กรุณาติดต่อเจ้าหน้าที่'); e.status = 409; throw e; }
  const code = M.formatPromoCode(c, n);
  db.prepare('UPDATE orders SET promo_code = ? WHERE id = ?').run(code, orderId);
  return code;
});
app.post('/api/orders/:id/code', (req, res) => {
  const o = ownOrderOr404(req, res); if (!o) return;
  const u = adminFromReq(req);
  if (u && o.customer_id !== req.customerId && !can(u, 'code')) return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอ' });
  try { res.json({ promo_code: assignPromoCode(o.id), order: orderView(getOrder(o.id)) }); }
  catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); throw e; }
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)),
});
/** ตรวจคำสั่งซื้อ (ยังไม่บันทึก) → { ok: true, ...ข้อมูลพร้อมบันทึก } หรือ { status, error, field }
 *  Body: { store_id, note, phone, pickup_date, pickup_time, campaign?: slug, lines: [{set_id, quantity}] } */
function validateOrder(req, b) {
  const bad = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });
  if (loginRequired() && !customerLoggedIn(req.customerId)) return bad(401, 'กรุณาเข้าสู่ระบบด้วย Google ก่อนยืนยันคำสั่งซื้อ / Please sign in with Google first', { login_required: true });
  const { store_id, note = '', lines } = b || {};
  const phone = String((b && b.phone) || '').replace(/[^\d+]/g, '').slice(0, 20);   // เบอร์ติดต่อผู้รับขนม
  if (!/^(\+66|0)\d{8,9}$/.test(phone)) return bad(400, 'กรุณาใส่เบอร์ติดต่อผู้รับขนม (เบอร์มือถือ 10 หลัก) / Contact number is required', { field: 'phone' });
  const email = normalizeEmail(b && b.email);   // อีเมลผู้สั่ง (รับอีเมลยืนยัน + รหัสโปรโมชัน)
  if (!validEmail(email)) return bad(400, 'กรุณาใส่อีเมลให้ถูกต้อง (ใช้ส่งอีเมลยืนยันคำสั่งซื้อ) / A valid email is required', { field: 'email' });
  const store = loadStores().find((s) => s.id === String(store_id));
  if (!store) return bad(400, 'กรุณาเลือกสาขาที่รับสินค้า');
  if (!Array.isArray(lines) || lines.length === 0) return bad(400, 'ยังไม่มีรายการในตะกร้า');
  const campaign = (b && b.campaign && campaignBySlug(b.campaign)) || requestCampaign(req);
  if (campaignDesign(campaign).home === 'membership') return bad(400, M.MEMBERSHIP_NO_ORDER);
  if (campaign.orders_open === 0) return bad(400, 'แคมเปญนี้ปิดรับคำสั่งซื้อแล้ว / This campaign is closed');
  const menu = menuFor(campaign);
  // วันรับของกำหนดจากรอบสั่ง (ตาราง pickup_map) ลูกค้าไม่ต้องเลือก; แคมเปญที่ไม่มีตารางยังให้เลือกจากรายการได้
  const mustPickup = (menu.pickup_map || {})[bangkokToday(menu)];
  const pickup_date = mustPickup || String((b && b.pickup_date) || '').trim();
  if (!mustPickup && menu.pickup_dates.length && !menu.pickup_dates.includes(pickup_date)) return bad(400, 'กรุณาเลือกวันที่รับของ / Please choose a pick-up date', { field: 'pickup_date' });
  const pickup_time = String((b && b.pickup_time) || '').trim();
  if (menu.pickup_times.length && !menu.pickup_times.includes(pickup_time)) return bad(400, 'กรุณาเลือกเวลาที่รับของ / Please choose a pick-up time', { field: 'pickup_time' });
  const built = M.buildOrderRows(lines, menu);
  if (built.error) return bad(400, built.error);
  const sv = stockView(campaign);
  if (!sv.order_window.open && sv.order_window.status !== 'full') return bad(409, sv.order_window.message, { stock: sv });
  // คิวที่ลูกค้าคนนี้จองไว้เอง (กด Confirm ก่อนหน้า) บวกคืนก่อนตรวจ
  const own = db.prepare('SELECT COALESCE(SUM(sets), 0) AS sets, COALESCE(SUM(drink), 0) AS drink, COALESCE(SUM(dessert), 0) AS dessert FROM holds WHERE customer_id = ? AND campaign_id = ? AND order_day = ? AND expires_at > ?').get(req.customerId, campaign.id, bangkokToday(menu), W.bangkokNow());
  if (sv.order_window.status === 'full' && own.sets === 0) return bad(409, sv.order_window.message, { stock: sv });
  const rem = { total: sv.remaining.total == null ? null : sv.remaining.total + own.sets, drink: sv.remaining.drink == null ? null : sv.remaining.drink + own.drink, dessert: sv.remaining.dessert == null ? null : sv.remaining.dessert + own.dessert };
  const ow = { ...sv.order_window, today_remaining: sv.order_window.today_remaining == null ? null : sv.order_window.today_remaining + own.sets };
  { const dshort = M.dayShortfall(built.want, ow); if (dshort) return bad(409, dshort, { stock: sv }); }
  const short = M.stockShortfall(built.want, rem); if (short) return bad(409, short, { stock: sv });
  return { ok: true, campaign, menu, store, store_name: `${store.brand} - ${store.name}`, phone, email, note: String(note).slice(0, 500), pickup_date: (mustPickup || menu.pickup_dates.length) ? pickup_date : '', pickup_time: menu.pickup_times.length ? pickup_time : '', rows: built.rows, want: built.want, total: built.total };
}
const sendBad = (res, v) => { const { ok, status, ...rest } = v; return res.status(status).json(rest); };
/** สรุปคำสั่งซื้อ + วิธีชำระเงิน (ยังไม่มีออเดอร์ในระบบจนกว่าจะส่งสลิป) */
/** จองคิว (hold): ลบคิวเดิม/หมดอายุ → ตรวจโควตา+สต๊อก (ไม่รวมคิวตัวเอง) → จองใหม่ ใน transaction เดียว; คืน hold หรือ error */
function reserveHold(req, v) {
  const { campaign, menu, want } = v; const today = bangkokToday(menu); const ts = W.bangkokNow();
  const exp = W.bangkokNow(new Date(Date.now() + holdMinutes() * 60000)); const id = crypto.randomUUID();
  return db.transaction(() => {
    db.prepare('DELETE FROM holds WHERE expires_at <= ?').run(ts);
    const prev = db.prepare('SELECT * FROM holds WHERE customer_id = ? AND campaign_id = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1').get(req.customerId, campaign.id, ts);
    db.prepare('DELETE FROM holds WHERE customer_id = ? AND campaign_id = ?').run(req.customerId, campaign.id);
    const sv = stockView(campaign);
    const short = M.stockShortfall(want, sv.remaining) || M.dayShortfall(want, sv.order_window) || (!sv.order_window.open ? sv.order_window.message : '');
    if (short) {   // จองใหม่ไม่ได้ → คืนคิวเดิม
      if (prev) db.prepare('INSERT OR IGNORE INTO holds(id, customer_id, campaign_id, order_day, sets, drink, dessert, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(prev.id, prev.customer_id, prev.campaign_id, prev.order_day, prev.sets, prev.drink, prev.dessert, prev.created_at, prev.expires_at);
      return { error: short, stock: sv };
    }
    db.prepare('INSERT INTO holds(id, customer_id, campaign_id, order_day, sets, drink, dessert, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, req.customerId, campaign.id, today, want.total, want.drink, want.dessert, exp);
    return { hold: { id, expires_at: exp } };
  })();
}
/** ใส่ตะกร้า = จองคิวทันที (ตะกร้าว่าง = คืนคิว) */
app.post('/api/hold', (req, res) => {
  const campaign = requestCampaign(req); const menu = menuFor(campaign); const b = req.body || {};
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length && campaignDesign(campaign).home === 'membership') return res.status(400).json({ error: M.MEMBERSHIP_NO_ORDER });
  if (!lines.length || campaign.orders_open === 0) { db.prepare('DELETE FROM holds WHERE customer_id = ? AND campaign_id = ?').run(req.customerId, campaign.id); return res.json({ held: 0, stock: stockView(campaign) }); }
  const built = M.buildOrderRows(lines, menu); if (built.error) return res.status(400).json({ error: built.error });
  const sv0 = stockView(campaign);
  if (!sv0.order_window.open && sv0.order_window.status !== 'full') return res.status(409).json({ error: sv0.order_window.message, stock: sv0 });
  const hr = reserveHold(req, { campaign, menu, want: built.want }); if (hr.error) return res.status(409).json({ error: hr.error, stock: hr.stock });
  res.json({ held: built.want.total, hold_expires_at: hr.hold.expires_at, hold_minutes: holdMinutes(), stock: stockView(campaign) });
});
app.delete('/api/hold', (req, res) => {
  const campaign = requestCampaign(req);
  db.prepare('DELETE FROM holds WHERE customer_id = ? AND campaign_id = ?').run(req.customerId, campaign.id);
  res.json({ held: 0, stock: stockView(campaign) });
});
app.post('/api/quote', async (req, res) => {
  const v = validateOrder(req, req.body || {}); if (!v.ok) return sendBad(res, v);
  const hr = reserveHold(req, v); if (hr.error) return res.status(409).json({ error: hr.error, stock: hr.stock });   // กด Confirm = จองคิวทันที
  const lines = v.rows.map((r) => { let items = []; try { items = r.items_json ? JSON.parse(r.items_json) : []; } catch (e) { items = []; }
    return { set_id: r.set_id, set_label: r.set_label, set_name: r.set_name, items, name: r.set_id ? `${r.set_label || 'SET ' + r.set_id} · ${r.set_name}` : [r.drink_name, r.dessert_name].filter(Boolean).join(' + '), pieces: r.pieces, quantity: r.quantity, unit_price: r.unit_price, line_total: r.line_total }; });
  let payment = null;
  if (v.total > 0) {
    if (!qrConfigured()) return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่าบัญชีรับเงินของร้าน (BANK_ACCOUNT_NO หรือ PROMPTPAY_ID)' });
    const bank = bankAccount(process.env); payment = bank ? { bank } : { qr_data_url: await generateQR(v.total) };
  }
  res.json({ campaign: campaignPublic(v.campaign), campaign_name: v.campaign.name, store_id: v.store.id, store_name: v.store_name, phone: v.phone, email: v.email, note: v.note, pickup_date: v.pickup_date, pickup_time: v.pickup_time, order_day: bangkokToday(v.menu), lines, total: v.total, amount: v.total, payment, slip_required: v.total > 0, hold_expires_at: hr.hold.expires_at, hold_minutes: holdMinutes() });
});
/** สั่งซื้อ = ส่งสลิปพร้อมรายการ (multipart: order = JSON, slip = รูป) — ออเดอร์เกิดในระบบเมื่อมีสลิปเท่านั้น (JSON ล้วนใช้ได้เฉพาะยอด 0 บาท) */
app.post('/api/orders', upload.single('slip'), async (req, res) => {
  const drop = () => { if (req.file) fs.unlink(req.file.path, () => {}); };
  let b = req.body || {};
  if (req.is('multipart/form-data')) { try { b = JSON.parse(b.order || '{}'); } catch (e) { drop(); return res.status(400).json({ error: 'ข้อมูลคำสั่งซื้อไม่ถูกต้อง' }); } }
  const v = validateOrder(req, b); if (!v.ok) { drop(); return sendBad(res, v); }
  const { campaign, menu, store, rows, want, total } = v;
  let r = null;
  if (total > 0) {
    if (!req.file) return res.status(400).json({ error: 'กรุณาแนบสลิปโอนเงิน (jpg/png) / Please attach your transfer slip', field: 'slip' });
    const isDuplicate = ({ hash, ref }) => {
      if (hash && db.prepare('SELECT 1 FROM orders WHERE slip_hash = ? AND status <> ?').get(hash, 'cancelled')) return true;
      if (ref && db.prepare('SELECT 1 FROM orders WHERE slip_ref = ? AND status <> ?').get(ref, 'cancelled')) return true;
      return false;
    };
    r = await verifySlip(req.file.path, total, { isDuplicate });
    // สลิปซ้ำ/ตรวจไม่ผ่าน = ไม่สร้างออเดอร์ (ไม่กินโควตา ไม่ขึ้นหลังบ้าน)
    if (!r.verified && !r.manual) { drop(); return res.status(400).json({ error: r.reason || 'สลิปไม่ผ่านการตรวจสอบ / Slip rejected', field: 'slip' }); }
  }
  const id = crypto.randomUUID();
  const status = total > 0 ? (r.verified ? 'paid' : 'slip_uploaded') : 'paid';
  const create = db.transaction(() => {
    db.prepare('DELETE FROM holds WHERE customer_id = ? AND campaign_id = ?').run(req.customerId, campaign.id);   // คิวที่จองไว้ถูกใช้เป็นออเดอร์
    const short = stockShortfall(want, campaign); // checked inside the write transaction so two customers cannot both take the last pieces
    if (short) { const e = new Error(short); e.status = 409; throw e; }
    const ow = orderWindow(campaign); // ช่วงวันเปิดรับ + โควตาต่อวัน ตรวจใน transaction เดียวกัน กันสั่งเกินโควตาพร้อมกัน
    if (!ow.open) { const e = new Error(ow.message); e.status = 409; e.order_window = ow; throw e; }
    { const dshort = M.dayShortfall(want, ow); if (dshort) { const e = new Error(dshort); e.status = 409; e.order_window = ow; throw e; } }   // โควตาชุดต่อวัน
    touchCustomer(req.customerId); linkCustomerCampaign(req.customerId, campaign.id);
    db.prepare('UPDATE customers SET email = ? WHERE id = ? AND google_sub IS NULL').run(v.email, req.customerId);   // ทะเบียนลูกค้า (บัญชี Google ใช้อีเมลของ Google)
    const pdpaAt = (customerRow(req.customerId) || {}).pdpa_accepted_at || '';
    const order_number = nextOrderNumber();
    db.prepare(`INSERT INTO orders(id, order_number, customer_id, campaign_id, store_id, store_name, total, note, phone, email, pickup_date, pickup_time, pdpa_accepted_at, order_day, status, paid_at, slip_path, slip_hash, slip_ref, slip_amount, slip_reason, slip_verified)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, order_number, req.customerId, campaign.id, store.id, v.store_name, total, v.note, v.phone, v.email, v.pickup_date, v.pickup_time, pdpaAt, ow.today,
                status, status === 'paid' ? W.bangkokNow() : null, r ? req.file.path : '', r ? (r.slip_hash || '') : '', r ? (r.ref || '') : '', r ? (r.amount ?? null) : null, r ? (r.reason || '') : '', r && r.verified ? 1 : 0);
    const ins = db.prepare(`INSERT INTO order_lines(order_id, set_id, set_label, set_name, items_json, pieces, drink_pieces, dessert_pieces, drink_id, drink_name, dessert_id, dessert_name, quantity, unit_price, line_total)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const x of rows) ins.run(id, x.set_id, x.set_label, x.set_name, x.items_json, x.pieces, x.drink_pieces, x.dessert_pieces, x.drink_id, x.drink_name, x.dessert_id, x.dessert_name, x.quantity, x.unit_price, x.line_total);
  });
  try { create(); } catch (e) { drop(); if (e.status === 409) return res.status(409).json({ error: e.message, stock: stockView(campaign) }); throw e; }
  if (status === 'paid' && total > 0) await notifyApproved(id);   // ตรวจอัตโนมัติผ่าน → อีเมลยืนยันทันที
  res.status(201).json(orderView(getOrder(id)));
});

app.post('/api/orders/:id/slip', upload.single('slip'), async (req, res) => {
  const o = ownOrderOr404(req, res); if (!o) return;
  if (!req.file) return res.status(400).json({ error: 'กรุณาแนบรูปสลิป (jpg/png)' });
  if (!SLIP_ACCEPTED.includes(o.status)) { fs.unlink(req.file.path, () => {}); return res.status(400).json({ error: 'คำสั่งซื้อนี้ชำระเงินแล้ว' }); }
  const isDuplicate = ({ hash, ref }) => {
    if (hash && db.prepare('SELECT 1 FROM orders WHERE slip_hash = ? AND id <> ? AND status <> ?').get(hash, o.id, 'cancelled')) return true;
    if (ref && db.prepare('SELECT 1 FROM orders WHERE slip_ref = ? AND id <> ? AND status <> ?').get(ref, o.id, 'cancelled')) return true;
    return false;
  };
  const r = await verifySlip(req.file.path, o.total, { orderCreatedAt: o.created_at, isDuplicate });
  // สลิปซ้ำ/ตรวจไม่ผ่าน = ไม่แตะออเดอร์เดิม (สลิปเดิมและสถานะคงอยู่) แค่บอกเหตุผล
  if (!r.verified && !r.manual) { fs.unlink(req.file.path, () => {}); return res.json({ ok: false, status: o.status, reason: r.reason, order: orderView(o) }); }
  if (o.slip_path && o.slip_path !== req.file.path) fs.unlink(o.slip_path, () => {});
  // verified by SlipOK -> paid; no verifier -> finance reviews; failed check -> back to payable with the reason
  const status = r.verified ? 'paid' : 'slip_uploaded';
  db.prepare(`UPDATE orders SET slip_path = ?, slip_hash = ?, slip_ref = ?, slip_amount = ?, slip_reason = ?, slip_verified = ?, status = ?,
              paid_at = CASE WHEN ? = 'paid' THEN datetime('now','localtime') ELSE paid_at END WHERE id = ?`)
    .run(req.file.path, r.slip_hash || '', r.ref || '', r.amount ?? null, r.reason || '', r.verified ? 1 : 0, status, status, o.id);
  if (status === 'paid') await notifyApproved(o.id);   // ตรวจอัตโนมัติผ่าน → อีเมลยืนยันทันที
  res.json({ ok: r.verified || r.manual, status, reason: r.reason, order: orderView(getOrder(o.id)) });
});

// Design images (promote / set pictures) are public: customers see them on the homepage
app.use('/uploads/design', (req, res, next) => { if (/\.svg$/i.test(req.path)) res.set({ 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' }); next(); }, express.static(DESIGN_DIR, { maxAge: '7d', index: false }));

// Slip images: only the owner or a logged-in back-office user
app.get('/uploads/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const o = db.prepare('SELECT customer_id FROM orders WHERE slip_path = ?').get(path.join(UPLOAD_DIR, name));
  if (!o || (o.customer_id !== req.customerId && !adminFromReq(req))) return res.status(404).end();
  res.sendFile(path.join(UPLOAD_DIR, name));
});

// ─── Back-office API ───
app.post('/api/admin/login', (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username).trim());
  if (!u || !checkPassword(password, u.password_hash)) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  res.cookie(ADMIN_COOKIE, jwt.sign({ uid: u.id, role: u.role }, JWT_SECRET, { expiresIn: '12h' }), { httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/' });
  res.json({ ok: true, user: userView(u), permissions: permissionsOf(u) });
});
app.post('/api/admin/logout', (req, res) => { res.clearCookie(ADMIN_COOKIE, { path: '/' }); res.json({ ok: true }); });
app.get('/api/admin/me', (req, res) => {
  const u = adminFromReq(req);
  res.json({ admin: Boolean(u), user: u ? userView(u) : null, permissions: u ? permissionsOf(u) : {}, slip_auto_verify: slipOkEnabled(), payment_ready: qrConfigured(), payment_mode: paymentMode(process.env), public_base_url: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '') });
});
app.post('/api/admin/me/password', requireAdmin, (req, res) => {
  const u = adminFromReq(req); const { current = '', password = '' } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.id);
  if (!checkPassword(current, row.password_hash)) return res.status(400).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
  if (String(password).length < 6) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร' });
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(hashPassword(password), u.id);
  res.json({ ok: true });
});

// Accounts (it_admin only)
app.get('/api/admin/users', requirePerm('accounts'), (req, res) => {
  res.json(db.prepare("SELECT * FROM users ORDER BY CASE role WHEN 'it_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, username").all().map(userView));
});
app.post('/api/admin/users', requirePerm('accounts'), (req, res) => {
  const { username = '', password = '', role = '', display_name = '', department = '' } = req.body || {};
  const name = String(username).trim();
  if (!/^[a-z0-9._-]{2,40}$/i.test(name)) return res.status(400).json({ error: 'username ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีด (2-40 ตัว)' });
  if (String(password).length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'role ไม่ถูกต้อง' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(name)) return res.status(409).json({ error: 'username นี้มีอยู่แล้ว' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users(id, username, password_hash, role, display_name, department) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, hashPassword(password), role, String(display_name).slice(0, 80), String(department).slice(0, 80));
  res.status(201).json(userView(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
});
app.patch('/api/admin/users/:id', requirePerm('accounts'), (req, res) => {
  const me = adminFromReq(req);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  const b = req.body || {};
  const next = { display_name: b.display_name ?? u.display_name, department: b.department ?? u.department, role: b.role ?? u.role, active: b.active == null ? u.active : (b.active ? 1 : 0) };
  if (!ROLES.includes(next.role)) return res.status(400).json({ error: 'role ไม่ถูกต้อง' });
  if (u.id === me.id && (next.role !== 'it_admin' || !next.active)) return res.status(400).json({ error: 'ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้' });
  if (u.role === 'it_admin' && (next.role !== 'it_admin' || !next.active)) {
    const others = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'it_admin' AND active = 1 AND id <> ?").get(u.id).n;
    if (others === 0) return res.status(400).json({ error: 'ต้องมี IT-Admin ที่ใช้งานได้อย่างน้อย 1 บัญชี' });
  }
  if (b.password != null && b.password !== '') {
    if (String(b.password).length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(b.password), u.id);
  }
  db.prepare("UPDATE users SET display_name = ?, department = ?, role = ?, active = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(String(next.display_name).slice(0, 80), String(next.department).slice(0, 80), next.role, next.active, u.id);
  res.json(userView(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)));
});
// ล้างออเดอร์ทั้งหมด (ข้อมูลทดสอบ) — IT-Admin เท่านั้น ต้องส่ง confirm: 'RESET' (บัญชี/แคมเปญ/ลูกค้าคงไว้)
app.post('/api/admin/reset', requirePerm('accounts'), (req, res) => {
  if (!req.body || req.body.confirm !== 'RESET') return res.status(400).json({ error: "ต้องยืนยันด้วยคำว่า RESET / Send { confirm: 'RESET' }" });
  const before = db.prepare('SELECT COUNT(*) AS n, COUNT(promo_code) AS codes FROM orders').get();
  const slips = db.prepare("SELECT slip_path FROM orders WHERE slip_path <> ''").all();
  db.transaction(() => { db.exec('DELETE FROM order_lines; DELETE FROM mail_log; DELETE FROM orders; DELETE FROM holds; DELETE FROM order_counters;'); })();
  for (const s of slips) fs.unlink(s.slip_path, () => {});
  res.json({ ok: true, orders: before.n, promo_codes: before.codes, slips: slips.length, before: null });
});
app.delete('/api/admin/users/:id', requirePerm('accounts'), (req, res) => {
  const me = adminFromReq(req);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  if (u.id === me.id) return res.status(400).json({ error: 'ลบบัญชีของตัวเองไม่ได้' });
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  res.json({ ok: true });
});

// Campaigns (everyone can list; it_admin manages)
function campaignStats(c) {
  const s = db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status IN ('paid','picked_up') THEN total ELSE 0 END), 0) AS paid_amount,
                        SUM(CASE WHEN status = 'slip_uploaded' THEN 1 ELSE 0 END) AS awaiting_review,
                        SUM(CASE WHEN status = 'slip_rejected' THEN 1 ELSE 0 END) AS on_issue FROM orders WHERE campaign_id = ? AND status <> 'cancelled'`).get(c.id);
  return { ...campaignView(c), stats: { orders: s.orders, paid_amount: s.paid_amount, awaiting_review: s.awaiting_review || 0, on_issue: s.on_issue || 0, slip_issues: (s.awaiting_review || 0) + (s.on_issue || 0) }, stock_view: stockView(c) };
}
app.get('/api/admin/campaigns', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM campaigns ORDER BY active DESC, created_at DESC').all().map(campaignStats));
});
const setActiveCampaign = db.transaction((id) => { db.exec('UPDATE campaigns SET active = 0'); db.prepare('UPDATE campaigns SET active = 1 WHERE id = ?').run(id); });
app.post('/api/admin/campaigns', requirePerm('campaigns'), (req, res) => {
  const v = readCampaignBody(req.body || {}, { promo_from: 2026090001, promo_to: 2026092000, promo_prefix: '', stock_total: 1000 });
  if (v.error) return res.status(400).json({ error: v.error });
  if (!v.name) return res.status(400).json({ error: 'กรุณาใส่ชื่อแคมเปญ' });
  if (!v.slug || v.slug.length < 2) return res.status(400).json({ error: 'ลิงก์แคมเปญ (URL) ต้องเป็น a-z, 0-9 อย่างน้อย 2 ตัว' });
  if (db.prepare('SELECT 1 FROM campaigns WHERE slug = ?').get(v.slug)) return res.status(409).json({ error: `ลิงก์ /${v.slug}/ ถูกใช้แล้ว กรุณาตั้งใหม่` });
  let id = slugify(v.name); let n = 2;
  while (getCampaign(id)) id = `${slugify(v.name)}-${n++}`;
  db.prepare('INSERT INTO campaigns(id, slug, name, active, orders_open, stock_total, stock_drink, stock_dessert, promo_from, promo_to, promo_prefix) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, v.slug, v.name, v.orders_open, v.stock_total, v.stock_drink, v.stock_dessert, v.promo_from, v.promo_to, v.promo_prefix);
  if (req.body && req.body.active) setActiveCampaign(id);
  res.status(201).json(campaignStats(getCampaign(id)));
});
app.patch('/api/admin/campaigns/:id', requirePerm('campaigns'), (req, res) => {
  const c = getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'ไม่พบแคมเปญ' });
  const v = readCampaignBody(req.body || {}, c);
  if (v.error) return res.status(400).json({ error: v.error });
  if (!v.name) return res.status(400).json({ error: 'กรุณาใส่ชื่อแคมเปญ' });
  if (!v.slug || v.slug.length < 2) return res.status(400).json({ error: 'ลิงก์แคมเปญ (URL) ต้องเป็น a-z, 0-9 อย่างน้อย 2 ตัว' });
  if (db.prepare('SELECT 1 FROM campaigns WHERE slug = ? AND id <> ?').get(v.slug, c.id)) return res.status(409).json({ error: `ลิงก์ /${v.slug}/ ถูกใช้แล้ว กรุณาตั้งใหม่` });
  db.prepare("UPDATE campaigns SET name = ?, slug = ?, orders_open = ?, stock_total = ?, stock_drink = ?, stock_dessert = ?, promo_from = ?, promo_to = ?, promo_prefix = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(v.name, v.slug, v.orders_open, v.stock_total, v.stock_drink, v.stock_dessert, v.promo_from, v.promo_to, v.promo_prefix, c.id);
  if (req.body && req.body.active === true) setActiveCampaign(c.id);
  res.json(campaignStats(getCampaign(c.id)));
});

// Campaign design (it_admin): promote images + Match Sets shown on the customer homepage
app.get('/api/admin/campaigns/:id/design', requirePerm('campaigns'), (req, res) => {
  const c = getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'ไม่พบแคมเปญ' });
  res.json({ campaign: campaignView(c), design: campaignDesign(c) });
});
app.put('/api/admin/campaigns/:id/design', requirePerm('campaigns'), (req, res) => {
  const c = getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'ไม่พบแคมเปญ' });
  const d = normalizeDesign(req.body || {});
  db.prepare("UPDATE campaigns SET design_json = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(JSON.stringify(d), c.id);
  const saved = getCampaign(c.id);
  res.json({ campaign: campaignView(saved), design: campaignDesign(saved) });
});
const designUpload = multer({
  storage: multer.diskStorage({
    destination: DESIGN_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${({ 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg' })[file.mimetype] || '.jpg'}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif|svg\+xml)$/.test(file.mimetype)),
});
app.post('/api/admin/design/upload', requirePerm('campaigns'), designUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาเลือกไฟล์รูป (jpg/png/webp)' });
  res.status(201).json({ url: `/uploads/design/${path.basename(req.file.path)}` });
});

// Orders
const PAGE_SIZE = 20; // รายการออเดอร์หลังบ้าน หน้าละ 20
// ─── Customers (ลูกค้าที่ล็อกอินด้วย Google) ───
// GET /api/admin/customers?campaign=<id|all>&q=&page=&export=1
//   campaign = id → เฉพาะลูกค้าที่ล็อกอินจาก /<แคมเปญ>/ หรือสั่งซื้อในแคมเปญนั้น (จำนวนออเดอร์/ยอดนับเฉพาะแคมเปญนั้น)
//   campaign = all → ทุกแคมเปญ; ไม่ส่ง = แคมเปญที่ Active
app.get('/api/admin/customers', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const cparam = String(req.query.campaign || '');
  const camp = cparam === 'all' ? null : (cparam ? getCampaign(cparam) : activeCampaign());
  if (cparam && cparam !== 'all' && !camp) return res.status(404).json({ error: 'ไม่พบแคมเปญ' });
  const where = ["(c.google_sub IS NOT NULL OR COALESCE(c.email, '') <> '')"]; const args = [];   // บัญชี Google หรือลูกค้าที่กรอกอีเมลตอนสั่งซื้อ
  const ordersWhere = ["status <> 'cancelled'" + (camp ? ' AND campaign_id = ?' : '')]; const oargs = camp ? [camp.id] : [];
  if (camp) { where.push('(cc.customer_id IS NOT NULL OR o.customer_id IS NOT NULL)'); }
  if (q) { where.push('(lower(c.email) LIKE ? OR lower(c.name) LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const sql = `FROM customers c
    LEFT JOIN (SELECT customer_id, COUNT(*) AS orders, SUM(CASE WHEN status IN ('paid','picked_up') THEN total ELSE 0 END) AS paid_total, MAX(created_at) AS last_order_at
               FROM orders WHERE ${ordersWhere.join(' AND ')} GROUP BY customer_id) o ON o.customer_id = c.id
    ${camp ? 'LEFT JOIN customer_campaigns cc ON cc.customer_id = c.id AND cc.campaign_id = ?' : ''}
    WHERE ${where.join(' AND ')}`;
  const allArgs = [...oargs, ...(camp ? [camp.id] : []), ...args];
  const total = db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...allArgs).n;
  const exp = req.query.export === '1';
  const page = exp ? 1 : Math.max(1, parseInt(req.query.page, 10) || 1);
  const rows = db.prepare(`SELECT c.id, c.email, c.name, c.picture, c.created_at, c.last_login_at, c.last_seen_at, COALESCE(o.orders, 0) AS orders, COALESCE(o.paid_total, 0) AS paid_total, o.last_order_at${camp ? ', cc.first_seen_at AS joined_at' : ''} ${sql}
    ORDER BY COALESCE(c.last_login_at, c.last_seen_at) DESC, c.created_at DESC ${exp ? '' : 'LIMIT ? OFFSET ?'}`).all(...allArgs, ...(exp ? [] : [PAGE_SIZE, (page - 1) * PAGE_SIZE]));
  res.json({ campaign: camp ? campaignPublic(camp) : null, page, pages: exp ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE)), total, rows });
});

// ─── ELITE list (ข้อมูลลูกค้าสมาชิก จากไฟล์ member-ELITE-*.xlsx) ───
// GET ?q=&page=&export=1 → { total, imported_at, rows }; PUT { rows: [{ phone, name, tier, email, data }] } = แทนที่ทั้งหมด
app.get('/api/admin/member-list', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase(); const qd = q.replace(/\D/g, '');
  const where = q ? `WHERE lower(name) LIKE ? OR lower(email) LIKE ?${qd ? ' OR phone LIKE ?' : ''}` : ''; const args = q ? [`%${q}%`, `%${q}%`, ...(qd ? [`%${qd.replace(/^66/, '')}%`] : [])] : [];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM member_list ${where}`).get(...args).n;
  const all = db.prepare('SELECT COUNT(*) AS n, MAX(imported_at) AS at FROM member_list').get();
  const exp = req.query.export === '1'; const page = exp ? 1 : Math.max(1, parseInt(req.query.page, 10) || 1);
  const rows = db.prepare(`SELECT phone, name, tier, email, data_json, imported_at FROM member_list ${where} ORDER BY rowid ${exp ? '' : 'LIMIT ? OFFSET ?'}`).all(...args, ...(exp ? [] : [PAGE_SIZE, (page - 1) * PAGE_SIZE]))
    .map(({ data_json, ...r }) => ({ ...r, data: (() => { try { return JSON.parse(data_json || '{}'); } catch (e) { return {}; } })() }));
  res.json({ total, all: all.n, imported_at: all.at || '', page, pages: exp ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE)), rows });
});
app.put('/api/admin/member-list', requirePerm('member_list'), (req, res) => {
  const v = M.readMemberListRows((req.body || {}).rows);
  if (v.error) return res.status(400).json({ error: v.error });
  if (!v.rows.length) return res.status(400).json({ error: 'ไม่พบเบอร์โทรศัพท์ในไฟล์ / No phone numbers found' });
  const ts = W.bangkokNow(); const ins = db.prepare('INSERT INTO member_list(phone, name, tier, email, data_json, imported_at) VALUES (?, ?, ?, ?, ?, ?)');
  db.transaction(() => { db.prepare('DELETE FROM member_list').run(); for (const r of v.rows) ins.run(r.phone, r.name, r.tier, r.email, r.data_json, ts); })();
  res.json({ ok: true, imported: v.rows.length, skipped: v.skipped, imported_at: ts });
});

// ─── Members (สมัครจากหน้าแรกแบบ Membership) ───
// GET /api/admin/members?campaign=<id|all>&q=&page=&export=1   (ไม่ส่ง campaign = แคมเปญที่ Active)
app.get('/api/admin/members', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const cparam = String(req.query.campaign || '');
  const camp = cparam === 'all' ? null : (cparam ? getCampaign(cparam) : activeCampaign());
  if (cparam && cparam !== 'all' && !camp) return res.status(404).json({ error: 'ไม่พบแคมเปญ' });
  const where = []; const args = [];
  if (camp) { where.push('m.campaign_id = ?'); args.push(camp.id); }
  if (q) { where.push("(lower(m.first_name || ' ' || m.last_name) LIKE ? OR m.phone LIKE ? OR lower(m.store_name) LIKE ? OR lower(m.email) LIKE ?)"); args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM members m ${w}`).get(...args).n;
  const exp = req.query.export === '1';
  const page = exp ? 1 : Math.max(1, parseInt(req.query.page, 10) || 1);
  const rows = db.prepare(`SELECT m.id, m.campaign_id, c.name AS campaign_name, m.first_name, m.last_name, m.phone, m.email, m.pickup_time, m.store_id, m.store_name, m.created_at, m.updated_at
    FROM members m LEFT JOIN campaigns c ON c.id = m.campaign_id ${w} ORDER BY m.created_at DESC ${exp ? '' : 'LIMIT ? OFFSET ?'}`).all(...args, ...(exp ? [] : [PAGE_SIZE, (page - 1) * PAGE_SIZE]));
  res.json({ campaign: camp ? campaignPublic(camp) : null, page, pages: exp ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE)), total, rows });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim();
  const date = String(req.query.date || '').trim();      // YYYY-MM-DD
  const store = String(req.query.store || '').trim();
  const status = String(req.query.status || '').trim();
  const campaign = String(req.query.campaign || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const where = []; const args = [];
  // ค้นหาได้ทั้งเลขออเดอร์ สาขา เบอร์ติดต่อ และอีเมล/ชื่อบัญชี Google ของผู้สั่ง
  if (q) { where.push('(order_number LIKE ? OR store_name LIKE ? OR phone LIKE ? OR email LIKE ? OR customer_id IN (SELECT id FROM customers WHERE email LIKE ? OR name LIKE ?))'); args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (date) { where.push("substr(created_at, 1, 10) = ?"); args.push(date); }
  if (store) { where.push('store_id = ?'); args.push(store); }
  if (status) { where.push(`status IN (${status.split(',').map(() => '?').join(',')})`); args.push(...status.split(',')); }
  if (campaign) { where.push('campaign_id = ?'); args.push(campaign); }
  const sql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders${sql}`).get(...args).n;
  const ids = db.prepare(`SELECT id FROM orders${sql} ORDER BY created_at DESC, order_number DESC LIMIT ? OFFSET ?`).all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  res.json({ page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, rows: ids.map(({ id }) => orderView(getOrder(id), { admin: true })) });
});
app.get('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const o = getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ' });
  res.json(orderView(o, { admin: true }));
});
// target status -> allowed current statuses, and the permission needed
const TRANSITIONS = {
  paid: { from: ['pending', 'slip_uploaded', 'slip_rejected'], perm: 'slip_review', stamp: 'paid_at' },
  slip_rejected: { from: ['slip_uploaded', 'slip_rejected'], perm: 'slip_review' },   // Reject ซ้ำได้ระหว่างรอสลิปใหม่
  picked_up: { from: ['paid'], perm: 'pickup', stamp: 'picked_up_at' },
  cancelled: { from: ['pending', 'slip_uploaded', 'slip_rejected', 'paid'], perm: 'cancel', stamp: 'cancelled_at' },
};
app.post('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  const u = adminFromReq(req);
  const o = getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ' });
  const to = String((req.body || {}).status || '');
  const t = TRANSITIONS[to];
  if (!t) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
  if (!can(u, t.perm)) return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอ / Not allowed for your role' });
  if (!t.from.includes(o.status)) return res.status(400).json({ error: `เปลี่ยนสถานะจาก ${o.status} เป็น ${to} ไม่ได้` });
  const reason = to === 'slip_rejected' ? String((req.body || {}).reason || 'สลิปไม่ถูกต้อง กรุณาอัปโหลดใหม่').slice(0, 300) : (to === 'paid' ? 'ตรวจสอบผ่าน' : o.slip_reason);
  db.prepare(`UPDATE orders SET status = ?, slip_reason = ?${t.stamp ? `, ${t.stamp} = datetime('now','localtime')` : ''} WHERE id = ?`).run(to, reason, o.id);
  if (to === 'paid') await notifyApproved(o.id);   // บัญชีอนุมัติ → อีเมลยืนยันพร้อมรายการคำสั่งซื้อถึงลูกค้า
  if (to === 'slip_rejected') { await notifyIssue(o.id, { by: (u && u.username) || '', reason }); await notifyRejected(o.id, { reason }); }   // Reject → แจ้งทีมการตลาด + แจ้งลูกค้า
  res.json(orderView(getOrder(o.id), { admin: true }));
});

// ─── อีเมลยืนยันการอนุมัติ (ส่งถึงอีเมล Google ที่ลูกค้าใช้สั่ง) ───
function approvalEmail(o, c, baseUrl) {
  const m = approvalEmailOf(o, c, baseUrl, { logos: 'cid' });   // โลโก้แนบไปกับอีเมล (cid)
  m.attachments = m.attachments.map((a) => ({ filename: a.filename, path: path.join(PUBLIC_DIR, 'img', a.filename), cid: a.cid }));
  return m;
}
async function notifyApproved(orderId) {
  // อนุมัติแล้ว → ออกรหัสโปรโมชันเรียงลำดับทันที (ลูกค้ากด "รับ code" เพื่อดู) แล้วส่งอีเมลพร้อมรหัส
  try { assignPromoCode(orderId); } catch (e) { console.error('[promo] ' + e.message); }
  const row = getOrder(orderId); if (!row) return;
  const o = orderView(row); const cust = customerRow(row.customer_id); const camp = row.campaign_id ? getCampaign(row.campaign_id) : null;
  const to = row.email || (cust && cust.email) || '';   // อีเมลที่กรอกตอนสั่ง (ถ้าไม่มี = อีเมลบัญชี Google)
  const mail = approvalEmail(o, camp, (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''));
  const r = to ? await mailer.sendMail({ to, ...mail }) : { status: 'failed', error: 'ออเดอร์นี้ไม่มีอีเมล' };
  db.prepare('INSERT INTO mail_log(order_id, kind, to_email, subject, status, error) VALUES (?, ?, ?, ?, ?, ?)').run(orderId, 'approved', to, mail.subject, r.status, r.error || '');
  return r;
}
/* บัญชีกด Reject สลิป → แจ้งทีมการตลาด (ISSUE_NOTIFY_EMAIL ค่าเริ่มต้น marketing@jianchatea.com; ว่าง = ไม่ส่ง) */
const issueNotifyTo = () => (process.env.ISSUE_NOTIFY_EMAIL == null ? 'marketing@jianchatea.com' : String(process.env.ISSUE_NOTIFY_EMAIL).trim());
async function notifyIssue(orderId, { by = '', reason = '' } = {}) {
  const to = issueNotifyTo(); if (!to) return null;
  const row = getOrder(orderId); if (!row) return null;
  const o = orderView(row, { admin: true }); const camp = row.campaign_id ? getCampaign(row.campaign_id) : null;
  const mail = issueEmail(o, camp, (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''), { by, reason });
  const r = await mailer.sendMail({ to, ...mail });
  db.prepare('INSERT INTO mail_log(order_id, kind, to_email, subject, status, error) VALUES (?, ?, ?, ?, ?, ?)').run(orderId, 'issue', to, mail.subject, r.status, r.error || '');
  return r;
}
/* Reject → อีเมลถึงลูกค้า: เหตุผล + ลิงก์อัปโหลดใหม่ + QR LINE OA */
async function notifyRejected(orderId, { reason = '' } = {}) {
  const row = getOrder(orderId); if (!row) return null;
  const cust = customerRow(row.customer_id); const to = row.email || (cust && cust.email) || '';
  const o = orderView(row); const camp = row.campaign_id ? getCampaign(row.campaign_id) : null;
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const qr = String(process.env.LINE_OA_QR == null ? '/img/line-oa-qr.png' : process.env.LINE_OA_QR).trim();
  const mail = rejectEmail(o, camp, base, { reason, lineQr: qr ? (qr.startsWith('http') ? qr : base + qr) : '', lineUrl: String(process.env.LINE_OA_URL == null ? 'https://page.line.me/jiancha' : process.env.LINE_OA_URL).trim() });
  const r = to ? await mailer.sendMail({ to, ...mail }) : { status: 'failed', error: 'ออเดอร์นี้ไม่มีอีเมล' };
  db.prepare('INSERT INTO mail_log(order_id, kind, to_email, subject, status, error) VALUES (?, ?, ?, ?, ?, ?)').run(orderId, 'rejected', to, mail.subject, r.status, r.error || '');
  return r;
}
app.get('/api/admin/summary', requireAdmin, (req, res) => {
  const date = String(req.query.date || '').trim();
  const campaign = String(req.query.campaign || '').trim();
  const where = []; const args = [];
  if (date) { where.push('substr(created_at,1,10) = ?'); args.push(date); }
  if (campaign) { where.push('campaign_id = ?'); args.push(campaign); }
  const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const byStatus = db.prepare(`SELECT status, COUNT(*) n, COALESCE(SUM(total),0) amount FROM orders${w} GROUP BY status`).all(...args);
  const byStore = db.prepare(`SELECT store_id, store_name, COUNT(*) AS total,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS to_pickup, SUM(CASE WHEN status = 'picked_up' THEN 1 ELSE 0 END) AS picked_up,
        SUM(CASE WHEN status = 'slip_uploaded' THEN 1 ELSE 0 END) AS awaiting_review, SUM(CASE WHEN status IN ('pending','slip_rejected') THEN 1 ELSE 0 END) AS unpaid
      FROM orders${w}${w ? ' AND' : ' WHERE'} status <> 'cancelled' GROUP BY store_id, store_name ORDER BY store_name`).all(...args);
  res.json({ by_status: byStatus, by_store: byStore, stock: stockView(campaign ? (getCampaign(campaign) || activeCampaign()) : activeCampaign()) });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

// Campaign pages: order.jianchatea.com/<slug>/ shows that campaign (and /<slug>/cart, /orders, /stores, /pay, /receipt)
const CAMPAIGN_PAGES = { '': 'index', cart: 'cart', orders: 'orders', stores: 'stores', pay: 'pay', receipt: 'receipt' };
app.get('/:slug/:page?', (req, res, next) => {
  const page = CAMPAIGN_PAGES[req.params.page || ''];
  const camp = page === undefined ? null : campaignBySlug(req.params.slug);
  if (!camp) return next();
  // แคมเปญหน้าสมัครสมาชิก: ไม่มีหน้าสั่งซื้อ (cart / orders / pay …) → กลับหน้าฟอร์ม
  if (req.params.page && campaignDesign(camp).home === 'membership') return res.redirect(302, `/${req.params.slug}/`);
  if (!req.params.page && !req.path.endsWith('/')) return res.redirect(301, `/${req.params.slug}/${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`);
  // หน้าแรกแบบ Membership (ตั้งในหน้า Design ของแคมเปญ) → ฟอร์มสมัครสมาชิกแทนเมนูสั่งซื้อ
  res.sendFile(path.join(PUBLIC_DIR, (page === 'index' && campaignDesign(camp).home === 'membership' ? 'membership' : page) + '.html'));
});
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'ไฟล์ใหญ่เกิน 8 MB' });
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`JIANCHA order site on http://localhost:${PORT}`);
    console.log(`  DB: ${DB_PATH}`);
    console.log(`  Campaign: ${activeCampaign().name}`);
    console.log(`  Payment: ${paymentMode(process.env) || 'NOT configured (set BANK_ACCOUNT_NO or PROMPTPAY_ID)'}`);
    console.log(`  SlipOK: ${slipOkEnabled() ? 'auto-verify' : 'manual review by finance'}`);
    console.log(`  Back-office users: ${db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get().n} (/backend)`);
  });
}
app.locals.approvalEmail = approvalEmail;   // ให้สคริปต์/เทสสร้างตัวอย่างอีเมลได้
module.exports = app;
