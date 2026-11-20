/* End-to-end API smoke test. Run: npm test (Node server on a temp database) or npm run test:cf (Cloudflare worker via wrangler pages dev, BASE_URL set) */
const CF = Boolean(process.env.BASE_URL);   // ทดสอบ worker ที่รันอยู่แล้ว (scripts/test-cf.js) แทน server.js
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `jc-order-test-${Date.now()}.db`);
process.env.PROMPTPAY_ID = '0812345678';
process.env.JWT_SECRET = 'test'; process.env.NODE_ENV = 'test'; process.env.SLIPOK_API_KEY = '';
process.env.ORDER_DAY_OVERRIDE = '2026-09-18'; // อยู่ในช่วงเปิดรับออเดอร์ของแม่แบบ (18–22 ก.ย. 2026)
process.env.MAIL_TRANSPORT = 'json'; // อีเมลยืนยันผ่าน nodemailer แบบไม่ออกเครือข่าย
process.env.GOOGLE_CLIENT_ID = 'test-client-id'; // เปิดบังคับล็อกอิน; token ตรวจกับ stub ด้านล่างแทน Google
const fs = require('fs'); const path = require('path');
const app = CF ? null : require('../server');
// แม่แบบ data/menu.json มีแบนเนอร์หรือไม่ (แคมเปญที่ยังไม่ตั้งค่า Design ต้องได้ค่าตามแม่แบบ)
const TEMPLATE_BANNERS = require('../data/menu.json').banner ? 1 : 0;

let base; const jars = {}; let testDay = '2026-09-18';
const setDay = (d) => { testDay = d; process.env.ORDER_DAY_OVERRIDE = d; };   // วันนี้ (เวลาไทย) ที่ระบบเห็น: env (Node) / header x-test-day (worker, TEST_MODE)
function cookieHeader(who) { return jars[who] ? { cookie: jars[who] } : {}; }
async function call(who, method, p, body, extraHeaders = {}) {
  const init = { method, headers: { ...cookieHeader(who), ...(CF ? { 'x-test-day': testDay } : {}), ...extraHeaders } };
  if (body instanceof FormData) init.body = body; else if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await fetch(base + p, init);
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (set.length) { const jar = Object.fromEntries((jars[who] || '').split('; ').filter(Boolean).map((c) => c.split(/=(.*)/s))); for (const c of set) { const [k, v] = c.split(';')[0].split(/=(.*)/s); if (v) jar[k] = v; else delete jar[k]; } jars[who] = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  let json = null; try { json = await r.json(); } catch (e) { /* none */ }
  return { status: r.status, json };
}
let failed = 0;
function check(name, cond, info) { if (cond) console.log('  ok  ', name); else { failed++; console.log('  FAIL', name, info ?? ''); } }
const tinyPng = (seed) => Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'), Buffer.from([seed])]);
const png = (seed) => { const f = new FormData(); f.append('slip', new Blob([tinyPng(seed)], { type: 'image/png' }), 'slip.png'); return f; };
const login = (who, username, password) => call(who, 'POST', '/api/admin/login', { username, password });
// สั่งซื้อ = ส่งรายการ + สลิป (multipart) — สลิปแต่ละใบไม่ซ้ำกัน (ระบบกันสลิปซ้ำ)
let slipSeed = 100;
const withEmail = (body) => (body && body.email === undefined ? { email: 'alice@gmail.com', ...body } : body);   // ทุกออเดอร์ต้องมีอีเมล
const orderForm = (body, seed) => { const f = new FormData(); f.append('order', JSON.stringify(withEmail(body))); f.append('slip', new Blob([tinyPng(seed)], { type: 'image/png' }), 'slip.png'); return f; };
const placeOrder = (who, body, seed) => { placeOrder.last = seed ?? slipSeed++; return call(who, 'POST', '/api/orders', orderForm(body, placeOrder.last)); };
// ฐานข้อมูลตรง: better-sqlite3 (Node) หรือ /api/_test/sql ของ worker (TEST_MODE)
const dbx = {
  run: async (q, ...args) => (CF ? (await call('sys', 'POST', '/api/_test/sql', { sql: q, args, mode: 'run' })).json.result : require('../db').db.prepare(q).run(...args)),
  get: async (q, ...args) => (CF ? (await call('sys', 'POST', '/api/_test/sql', { sql: q, args, mode: 'get' })).json.result : require('../db').db.prepare(q).get(...args)),
};

(async () => {
  const server = CF ? null : app.listen(0); base = CF ? process.env.BASE_URL.replace(/\/+$/, '') : `http://127.0.0.1:${server.address().port}`;
  // stub ของ oauth2.googleapis.com/tokeninfo: id_token = ชื่อผู้ใช้จำลอง ('bad' = ไม่ผ่าน)
  const http = require('http');
  const graphMail = [];   // อีเมลที่ worker ส่งผ่าน Microsoft Graph (stub; เฉพาะ test:cf)
  const tokeninfo = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    // stub ของ Microsoft identity + Graph sendMail
    if (u.pathname === '/ms/token') { let b = ''; req.on('data', (d) => { b += d; }); return req.on('end', () => { const f = new URLSearchParams(b); const ok = f.get('client_id') === 'test-client' && f.get('client_secret') === 'test-secret' && f.get('grant_type') === 'client_credentials'; res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' }); res.end(ok ? JSON.stringify({ access_token: 'graph-token', expires_in: 3600 }) : '{"error":"invalid_client"}'); }); }
    if (u.pathname.startsWith('/ms/graph/')) { let b = ''; req.on('data', (d) => { b += d; }); return req.on('end', () => { const m = u.pathname.match(/^\/ms\/graph\/users\/([^/]+)\/sendMail$/); if (!m || req.headers.authorization !== 'Bearer graph-token') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":{"code":"InvalidAuthenticationToken"}}'); } const j = JSON.parse(b); graphMail.push({ sender: decodeURIComponent(m[1]), to: j.message.toRecipients.map((x) => x.emailAddress.address), subject: j.message.subject, html: j.message.body.content }); res.writeHead(202, { 'request-id': 'req-' + graphMail.length }); res.end(); }); }
    const t = u.searchParams.get('id_token');
    if (!t || t === 'bad') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":"invalid_token"}'); }
    const wrongAud = t.endsWith('@wrong');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ iss: 'https://accounts.google.com', aud: wrongAud ? 'other-client' : 'test-client-id', sub: 'sub-' + t, email: t + '@gmail.com', email_verified: 'true', name: 'Test ' + t, picture: '', exp: String(Math.floor(Date.now() / 1000) + 3600) }));
  }).listen(CF ? parseInt(process.env.TOKENINFO_PORT || '8765', 10) : 0);
  process.env.GOOGLE_TOKENINFO_URL = `http://127.0.0.1:${tokeninfo.address().port}/tokeninfo`;
  try {
    let r = await call('customer', 'GET', '/api/menu');
    check('menu loads with sets + campaign + stock', r.status === 200 && r.json.sets.length === 2 && r.json.sets[0].label === 'SET A' && r.json.sets[0].items.length === 3 && r.json.campaign.name === 'JIANCHA x NAVORI' && r.json.stock.limits.total === 1000, r.json.sets);
    const menu = r.json; const A = menu.sets[0].id, B = menu.sets[1].id; // SET A 369 · SET B 379, each set = 1 unit of stock
    check('menu carries pick-up times', Array.isArray(menu.pickup_times) && menu.pickup_times.join('|') === '10:00-11:00 น.|13:00-15:00 น.|17:00-20:00 น.', menu.pickup_times);
    check('menu carries pick-up dates', Array.isArray(menu.pickup_dates) && menu.pickup_dates.join() === '2026-09-25,2026-09-26,2026-09-27,2026-09-28' && menu.sets[0].price === 369 && menu.sets[1].price === 379 && menu.sets[0].items[0].name_en === 'Golden Mung Snow Mooncake' && menu.sets[0].items[0].name_th === 'ขนมบัวหิมะไส้ถั่วทอง' && menu.sets[0].items[1].name_en === 'Taro Mochi Mooncake', menu.pickup_dates);
    { const rr = await fetch(base + '/api/menu'); check('api responses are not cacheable by CDN/Cloudflare', rr.headers.get('cache-control') === 'no-store'); }
    r = await call('customer', 'GET', '/api/stores'); check('stores load (5 branches: Central World Groove merged, Emsphere)', r.status === 200 && r.json.length === 5 && r.json.some((x) => x.name === 'Emsphere') && r.json.some((x) => x.name === 'Central World Groove') && !r.json.some((x) => x.name === 'Groove'));
    const storeId = r.json[1].id; // central-world (Central World Groove)

    // ── customer: Google login required before ordering ──
    r = await call('customer', 'GET', '/api/me'); check('me: not logged in, login required', r.json.logged_in === false && r.json.login_required === true && r.json.google_client_id === 'test-client-id');
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('order without login rejected (401)', r.status === 401 && r.json.login_required === true, r.json);
    r = await call('customer', 'POST', '/api/auth/google', { credential: 'bad' }); check('bad google token rejected', r.status === 401);
    r = await call('customer', 'POST', '/api/auth/google', { credential: 'alice@wrong' }); check('token for another client id rejected', r.status === 401);
    // PDPA: ยอมรับก่อนล็อกอิน → ติดไปกับบัญชี Google → ออเดอร์เก็บเวลายอมรับ
    r = await call('customer', 'GET', '/api/me'); check('me: pdpa not accepted yet', r.json.pdpa_accepted_at === '');
    r = await call('customer', 'POST', '/api/pdpa', {}); check('pdpa accepted (anonymous browser)', r.status === 200 && /^\d{4}-\d{2}-\d{2} /.test(r.json.pdpa_accepted_at), r.json);
    const pdpaAt = r.json.pdpa_accepted_at;
    r = await call('customer', 'POST', '/api/pdpa', {}); check('pdpa accept is idempotent (keeps first time)', r.json.pdpa_accepted_at === pdpaAt);
    r = await call('customer', 'POST', '/api/auth/google', { credential: 'alice', campaign: 'jianchaxnavori' }); check('google login ok', r.status === 200 && r.json.logged_in === true && r.json.email === 'alice@gmail.com' && r.json.name === 'Test alice', r.json);
    r = await call('customer', 'GET', '/api/me'); check('me: logged in', r.json.logged_in === true && r.json.email === 'alice@gmail.com');

    // ── customer: ordering ──
    r = await placeOrder('customer', { store_id: '', phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('order without store rejected', r.status === 400);
    // อีเมลผู้สั่ง: จำเป็นและต้องถูกรูปแบบ (ใช้ส่งอีเมลยืนยัน)
    r = await placeOrder('customer', { email: '', store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('order without email rejected', r.status === 400 && r.json.field === 'email', r.json);
    r = await placeOrder('customer', { email: 'not-an-email', store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('order with bad email rejected', r.status === 400 && r.json.field === 'email', r.json);
    r = await call('customer', 'POST', '/api/quote', { email: '  Somchai@Example.COM ', store_id: storeId, phone: '0812345678', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('quote echoes normalized email', r.status === 200 && r.json.email === 'somchai@example.com', r.json);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [] }); check('order without lines rejected', r.status === 400);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: 'nope', quantity: 1 }] }); check('unknown set rejected', r.status === 400);
    r = await placeOrder('customer', { store_id: storeId, lines: [{ set_id: A, quantity: 1 }] }); check('order without contact number rejected', r.status === 400 && r.json.field === 'phone', r.json);
    r = await placeOrder('customer', { store_id: storeId, phone: '12345', lines: [{ set_id: A, quantity: 1 }] }); check('order with bad contact number rejected', r.status === 400 && r.json.field === 'phone');
    r = await call('customer', 'GET', '/api/stock'); check('order window tells today\'s pick-up date + pairs', r.json.order_window.pickup_date === '2026-09-25' && r.json.order_window.pickup_pairs.length === 4 && r.json.order_window.pickup_pairs[3].order_days.join() === '2026-09-21,2026-09-22' && r.json.order_window.pickup_pairs[3].pickup === '2026-09-28' && r.json.order_window.pickup_pairs[3].order_range.th === '21–22 กันยายน 2569', r.json.order_window.pickup_pairs);
    for (const [day, pick] of [['2026-09-20', '2026-09-27'], ['2026-09-21', '2026-09-28'], ['2026-09-22', '2026-09-28']]) {
      setDay(day);
      r = await call('customer', 'GET', '/api/stock'); check(`round ${day} -> pick-up ${pick}`, r.json.order_window.pickup_date === pick, r.json.order_window.pickup_date);
    }
    setDay('2026-09-18');
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', lines: [{ set_id: A, quantity: 1 }] }); check('order without pick-up time rejected', r.status === 400 && r.json.field === 'pickup_time', r.json);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '09:00-10:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('order with a time outside the campaign list rejected', r.status === 400 && r.json.field === 'pickup_time', r.json);
    r = await placeOrder('customer', { store_id: storeId, note: 'no sugar', phone: '081-234-5678', email: 'Somchai@Example.com', pickup_date: '2026-09-27', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 2 }, { set_id: B, quantity: 1 }] }); // วันรับของถูกกำหนดจากรอบสั่ง (18 ก.ย. → 25 ก.ย.) ค่าที่ส่งมาถูกแทนที่
    check('order created', r.status === 201 && /^\d{13}$/.test(r.json.order_number) && r.json.campaign_id === 'jiancha-x-navori', r.json);
    const order = r.json; const orderSeed = placeOrder.last;
    check('phone kept (digits only)', r.json.phone === '0812345678', r.json.phone);
    check('email kept on the order (normalized)', r.json.email === 'somchai@example.com', r.json.email);
    r = await call('customer', 'GET', '/api/me'); check('pdpa acceptance follows the google account', r.json.pdpa_accepted_at === pdpaAt, r.json);
    // ล็อกอินบัญชีเดิมจากเบราว์เซอร์ใหม่ → เห็นออเดอร์เดิม; ออเดอร์ที่สั่งแบบไม่ล็อกอินก่อนหน้าย้ายมาด้วย (ทดสอบผ่านสถานะ login เพราะยังสั่งไม่ได้ก่อนล็อกอิน)
    r = await call('customer2', 'GET', '/api/orders'); check('new browser sees no orders', r.status === 200 && r.json.length === 0);
    r = await call('customer2', 'POST', '/api/auth/google', { credential: 'alice' }); check('same google account on new browser', r.json.logged_in === true);
    r = await call('customer2', 'GET', '/api/orders'); check('order history follows the google account', r.json.some((o) => o.id === order.id), r.json.map((o) => o.id));
    r = await call('customer2', 'POST', '/api/auth/logout'); check('logout', r.json.logged_in === false);
    r = await call('customer2', 'GET', '/api/orders'); check('after logout the browser has no orders', r.json.length === 0);
    r = await placeOrder('customer2', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('after logout ordering needs login again', r.status === 401);
    check('order lines + total', order.lines.length === 2 && order.total === 2 * 369 + 379 && order.pickup_date === '2026-09-25' && order.pickup_time === '13:00-15:00 น.' && order.lines[0].name === 'SET A · MOONLIT RUBY FRESH SET' && order.lines[0].items.length === 3 && order.store_name === 'JIANCHA - Central World Groove', order);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: B, quantity: 1 }] });
    check('order numbers increment', r.json.order_number === String(BigInt(order.order_number) + 1n), r.json.order_number);
    const order2 = r.json;
    r = await call('customer', 'GET', '/api/orders'); check('history lists own orders', r.status === 200 && r.json.length === 2);
    r = await call('other', 'GET', '/api/orders'); check('other browser sees nothing', r.json.length === 0);
    r = await call('other', 'GET', `/api/orders/${order.id}`); check('other browser cannot read order', r.status === 404);
    r = await call('customer', 'POST', '/api/quote', { email: 'alice@gmail.com', store_id: storeId, phone: '0812345678', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 2 }, { set_id: B, quantity: 1 }] }); const r0 = r;
    check('quote: total + QR payment, slip required, nothing saved', r.status === 200 && r.json.total === 1117 && r.json.slip_required === true && /^data:image\/(png|svg\+xml)/.test(r.json.payment.qr_data_url) && r.json.lines.length === 2 && r.json.pickup_date === '2026-09-25', r.json);
    r = await call('customer', 'GET', '/api/orders'); check('quote does not create an order', r.json.length === 2);
    // ── จองคิวเมื่อกด Confirm (hold): quote ข้างบน 3 ชุด → หักโควตาวันนี้ทันที จนกว่าจะส่งสลิปหรือหมดอายุ ──
    check('quote returns a hold expiry', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(r0.json.hold_expires_at) && r0.json.hold_minutes === 15, r0.json.hold_expires_at);
    r = await call('customer', 'GET', '/api/stock'); const heldView = r.json;
    check('hold counted in today quota + stock', heldView.order_window.today_held === 3 && heldView.used.held === 3 && heldView.order_window.today_count >= 3, heldView.order_window);
    const left = heldView.order_window.today_remaining; const chunk = (n) => { const out = []; for (let k = n; k > 0; k -= 99) out.push({ set_id: A, quantity: Math.min(99, k) }); return out; };   // จำกัด 99 ต่อบรรทัด
    r = await call('other', 'POST', '/api/auth/google', { credential: 'bob' }); check('second customer signs in', r.status === 200);
    r = await call('other', 'POST', '/api/quote', { email: 'bob@x.co', store_id: storeId, phone: '0899999999', pickup_time: '13:00-15:00 น.', lines: chunk(left + 1) }); check('another customer cannot reserve beyond what is left', r.status === 409 && /เหลือเพียง/.test(r.json.error), r.json);
    r = await call('other', 'POST', '/api/quote', { email: 'bob@x.co', store_id: storeId, phone: '0899999999', pickup_time: '13:00-15:00 น.', lines: chunk(left) }); check('another customer reserves exactly what is left', r.status === 200, r.json);
    r = await call('customer', 'GET', '/api/stock'); check('day is full while holds are active', r.json.order_window.status === 'full' && r.json.order_window.today_remaining === 0, r.json.order_window);
    r = await call('customer', 'POST', '/api/quote', { email: 'alice@gmail.com', store_id: storeId, phone: '0812345678', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 2 }, { set_id: B, quantity: 1 }] }); check('re-confirming the same cart keeps my own reservation', r.status === 200, r.json);
    r = await call('customer', 'POST', '/api/quote', { email: 'alice@gmail.com', store_id: storeId, phone: '0812345678', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 4 }] }); check('but cannot grow it while the day is full', r.status === 409, r.json);
    await dbx.run("UPDATE holds SET expires_at = '2000-01-01 00:00:00' WHERE sets = ?", left);   // คิวของอีกคนหมดอายุ
    r = await call('customer', 'GET', '/api/stock'); check('expired hold frees the quota', r.json.order_window.today_remaining === left && r.json.order_window.today_held === 3, r.json.order_window);
    // ใส่ตะกร้า = จองคิวทันที (/api/hold) — แทนที่คิวเดิมของลูกค้าคนเดิม, ตะกร้าว่าง = คืนคิว, จองเกินไม่ได้และคิวเดิมยังอยู่
    await dbx.run('DELETE FROM holds');
    r = await call('other', 'POST', '/api/hold', { lines: [{ set_id: A, quantity: 2 }] }); check('cart hold: 2 sets reserved on add-to-cart', r.status === 200 && r.json.held === 2 && r.json.stock.order_window.today_held === 2, r.json);
    r = await call('other', 'POST', '/api/hold', { lines: [{ set_id: A, quantity: 1 }] }); check('cart hold: quantity change replaces the hold', r.status === 200 && r.json.stock.order_window.today_held === 1, r.json);
    const left2 = r.json.stock.order_window.today_remaining;
    r = await call('other', 'POST', '/api/hold', { lines: chunk(left2 + 2) }); check('cart hold: growing beyond what is left is refused', r.status === 409 && /เหลือเพียง/.test(r.json.error), r.json);
    r = await call('customer', 'GET', '/api/stock'); check('cart hold: refused change keeps the previous hold (1 set)', r.json.order_window.today_held === 1, r.json.order_window);
    r = await call('other', 'DELETE', '/api/hold', {}); check('cart hold: emptying the cart releases the hold', r.status === 200 && r.json.stock.order_window.today_held === 0, r.json);
    await dbx.run('DELETE FROM holds');   // เคลียร์คิวทดสอบ ไม่ให้กระทบตัวเลขในส่วนถัดไป
    r = await call('customer', 'POST', '/api/orders', { email: 'alice@gmail.com', store_id: storeId, phone: '0812345678', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('order without slip rejected (no order created)', r.status === 400 && r.json.field === 'slip', r.json);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }, orderSeed); check('order with a slip already used rejected (no order created)', r.status === 400 && /เคยถูกใช้/.test(r.json.error), r.json);
    r = await call('customer', 'GET', '/api/orders'); check('rejected attempts leave no orders behind', r.json.length === 2);
    check('orders are created as slip_uploaded (waiting for finance)', order.status === 'slip_uploaded' && order.has_slip === true, order.status);
    if (!CF) {
      // โอนเข้าบัญชีธนาคารแทน PromptPay: ตั้ง BANK_* → /qr ส่งรายละเอียดบัญชี + ยอด แทน QR
      Object.assign(process.env, { BANK_NAME: 'กสิกรไทย', BANK_ACCOUNT_NAME: 'บริษัท เจียนฉา จำกัด', BANK_ACCOUNT_NO: '123-4-56789-0' });
      r = await call('customer', 'POST', '/api/quote', { email: 'alice@gmail.com', store_id: storeId, phone: '0812345678', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 2 }, { set_id: B, quantity: 1 }] }); check('bank transfer mode: quote returns account details instead of QR', r.status === 200 && r.json.payment.qr_data_url === undefined && r.json.payment.bank.account_no === '123-4-56789-0' && r.json.payment.bank.bank === 'กสิกรไทย' && r.json.amount === 1117, r.json);
      r = await call('customer', 'GET', '/api/config'); check('config reports bank payment mode', r.json.payment_ready === true && r.json.payment_mode === 'bank', r.json);
      for (const k of ['BANK_NAME', 'BANK_ACCOUNT_NAME', 'BANK_ACCOUNT_NO']) delete process.env[k];
      r = await call('customer', 'GET', '/api/config'); check('config back to promptpay mode', r.json.payment_mode === 'promptpay', r.json);
    }

    // ── customer: slips ──
    r = await call('customer', 'POST', `/api/orders/${order.id}/slip`, png(1)); check('re-upload on a waiting order keeps it in the finance queue', r.status === 200 && r.json.status === 'slip_uploaded', r.json);
    r = await call('customer', 'POST', `/api/orders/${order2.id}/slip`, png(1)); check('duplicate slip image rejected on re-upload', r.status === 200 && r.json.ok === false && r.json.status === 'slip_uploaded' && /เคยถูกใช้/.test(r.json.reason), r.json);
    r = await call('customer', 'POST', `/api/orders/${order2.id}/slip`, png(2)); check('second order slip accepted', r.json.status === 'slip_uploaded', r.json);
    r = await call('customer', 'GET', `/api/orders/${order.id}`); check('customer view hides slip url', r.json.has_slip === true && r.json.slip_url === undefined);

    // ── back-office: login & roles ──
    r = await call('it', 'GET', '/api/admin/orders'); check('admin api needs login', r.status === 401);
    r = await login('it', 'it-admin', 'wrong'); check('wrong password rejected', r.status === 401);
    r = await login('it', 'it-admin', 'jiancha2026'); check('it-admin login', r.status === 200 && r.json.user.role === 'it_admin' && r.json.permissions.accounts === true);
    r = await login('mkt', 'admin', 'marketing'); check('admin (marketing) login', r.status === 200 && r.json.user.role === 'admin' && r.json.permissions.slip_review === false);
    r = await login('fin', 'finance', 'jiancha'); check('finance login', r.status === 200 && r.json.user.role === 'finance' && r.json.permissions.slip_review === true && r.json.permissions.accounts === false);
    r = await call('fin', 'GET', '/api/admin/me'); check('me reflects role', r.json.admin && r.json.user.username === 'finance');

    r = await call('mkt', 'GET', '/api/admin/orders'); check('marketing lists orders', r.json.total === 2 && r.json.rows[0].slip_url, r.json);
    r = await call('mkt', 'GET', `/api/admin/orders?q=${order.order_number}`); check('search by number', r.json.total === 1);
    r = await call('mkt', 'GET', '/api/admin/orders?q=Central'); check('search by location', r.json.total === 2);
    r = await call('mkt', 'GET', '/api/admin/orders?date=2000-01-01'); check('date filter', r.json.total === 0);
    r = await call('mkt', 'GET', `/api/admin/orders?store=${storeId}&status=slip_uploaded`); check('store+status filter', r.json.total === 2);
    r = await call('mkt', 'GET', '/api/admin/orders?campaign=jiancha-x-navori'); check('campaign filter', r.json.total === 2);
    r = await call('mkt', 'GET', '/api/admin/orders?campaign=other'); check('unknown campaign empty', r.json.total === 0);
    r = await call('fin', 'GET', (await call('mkt', 'GET', '/api/admin/orders')).json.rows[0].slip_url); check('back-office can open slip image', r.status === 200);
    r = await call('other', 'GET', (await call('mkt', 'GET', '/api/admin/orders')).json.rows[0].slip_url); check('stranger cannot open slip image', r.status === 404);

    // ── permissions on status changes ──
    r = await call('mkt', 'POST', `/api/admin/orders/${order.id}/status`, { status: 'paid' }); check('marketing cannot approve slips', r.status === 403);
    r = await call('mkt', 'POST', `/api/admin/orders/${order.id}/status`, { status: 'cancelled' }); check('marketing cannot cancel', r.status === 403);
    r = await call('fin', 'POST', `/api/admin/orders/${order.id}/status`, { status: 'picked_up' }); check('invalid transition rejected', r.status === 400);
    r = await call('fin', 'POST', `/api/admin/orders/${order2.id}/status`, { status: 'slip_rejected', reason: 'ยอดไม่ตรง' }); check('finance rejects slip', r.json.status === 'slip_rejected' && r.json.slip_reason === 'ยอดไม่ตรง');
    r = await call('fin', 'GET', `/api/admin/orders/${order2.id}`); check('reject notifies marketing (mail_log issue)', r.json.issue_mail && r.json.issue_mail.status === 'sent' && r.json.issue_mail.to === 'marketing@jianchatea.com', r.json.issue_mail);
    r = await call('fin', 'GET', `/api/admin/orders/${order2.id}`); check('reject also emails the customer with the reason (mail_log rejected)', r.json.reject_mail && r.json.reject_mail.status === 'sent' && r.json.reject_mail.to === 'alice@gmail.com', r.json.reject_mail);
    if (CF) { const cm = graphMail.find((m) => m.to.join() === 'alice@gmail.com' && /Slip rejected/.test(m.subject)); check('customer reject mail via Graph: reason + re-upload link + LINE QR', cm && /ยอดไม่ตรง/.test(cm.html) && /\/jianchaxnavori\/orders/.test(cm.html) && /line-oa-qr\.png/.test(cm.html), cm && cm.subject); }
    if (CF) { const gm = graphMail.filter((m) => m.to.join() === 'marketing@jianchatea.com').pop(); check('issue mail sent via Graph to marketing with reason', gm && gm.to.join() === 'marketing@jianchatea.com' && /On Issue/.test(gm.subject) && /ยอดไม่ตรง/.test(gm.html) && gm.html.includes(order2.order_number), gm && { to: gm.to, subject: gm.subject }); }
    r = await call('customer', 'GET', `/api/orders/${order2.id}`); check('customer sees rejection + can re-pay', r.json.status === 'slip_rejected' && r.json.payable === true && r.json.slip_reason === 'ยอดไม่ตรง');
    r = await call('fin', 'POST', `/api/admin/orders/${order2.id}/status`, { status: 'slip_rejected', reason: 'สลิปซ้ำ' }); check('finance can reject again while awaiting a new slip', r.status === 200 && r.json.status === 'slip_rejected' && r.json.slip_reason === 'สลิปซ้ำ', r.json);
    r = await call('customer', 'GET', `/api/orders/${order2.id}/qr`); check('qr available again after rejection', r.status === 200);
    r = await call('customer', 'POST', `/api/orders/${order2.id}/slip`, png(3)); check('re-upload after rejection', r.json.status === 'slip_uploaded');
    r = await call('customer', 'POST', `/api/orders/${order.id}/code`); check('code refused before approval', r.status === 400, r.json);
    r = await call('fin', 'POST', `/api/admin/orders/${order.id}/status`, { status: 'paid' }); check('finance approves slip', r.json.status === 'paid' && r.json.paid_at);
    check('promo code assigned at approval, first in sequence', r.json.promo_code === 'NVR260001', r.json.promo_code);
    check('approval email sent to the email typed on the order', r.json.approval_mail && r.json.approval_mail.status === 'sent' && r.json.approval_mail.to === 'somchai@example.com' && r.json.approval_mail.at, r.json.approval_mail);
    r = await call('it', 'GET', `/api/admin/orders/${order.id}`); check('approval email status visible to back-office', r.json.approval_mail && r.json.approval_mail.status === 'sent');
    if (CF) { const gm = graphMail[graphMail.length - 1]; check('worker sent the mail through Microsoft Graph from the MAIL_FROM mailbox', gm && gm.sender === 'no-reply@jianchatea.com' && gm.to.join() === 'somchai@example.com' && gm.subject && /NVR26/.test(gm.html), gm && { sender: gm.sender, to: gm.to, subject: gm.subject }); }
    r = await call('customer', 'GET', `/api/orders/${order.id}`); check('customer view does not expose mail log', r.json.approval_mail === undefined);
    r = await call('customer', 'POST', `/api/orders/${order.id}/code`);
    check('customer "รับ code" shows the assigned code NVR260001', r.status === 200 && r.json.promo_code === 'NVR260001', r.json);
    const code1 = r.json.promo_code;
    r = await call('customer', 'POST', `/api/orders/${order.id}/code`); check('same code on repeat', r.json.promo_code === code1);
    r = await call('other', 'POST', `/api/orders/${order.id}/code`); check('stranger cannot get code', r.status === 404);
    r = await call('mkt', 'POST', `/api/admin/orders/${order.id}/status`, { status: 'picked_up' }); check('marketing marks picked up', r.json.status === 'picked_up');
    r = await call('customer', 'POST', `/api/orders/${order.id}/slip`, png(4)); check('paid order refuses new slip', r.status === 400);

    // ── accounts (it_admin only) ──
    r = await call('fin', 'GET', '/api/admin/users'); check('finance cannot list accounts', r.status === 403);
    r = await call('it', 'GET', '/api/admin/users'); check('it-admin lists 3 seeded accounts', r.status === 200 && r.json.map((u) => u.username).join() === 'it-admin,admin,finance', r.json);
    const finUser = r.json.find((u) => u.username === 'finance'), itUser = r.json.find((u) => u.username === 'it-admin');
    r = await call('it', 'POST', '/api/admin/users', { username: 'finance', password: 'abcdef', role: 'finance' }); check('duplicate username rejected', r.status === 409);
    r = await call('it', 'POST', '/api/admin/users', { username: 'store1', password: '123', role: 'admin' }); check('short password rejected', r.status === 400);
    r = await call('it', 'POST', '/api/admin/users', { username: 'store1', password: 'store123', role: 'admin', display_name: 'Store 1', department: 'Operations' }); check('account created', r.status === 201 && r.json.role === 'admin');
    const newUser = r.json;
    r = await login('store1', 'store1', 'store123'); check('new account can log in', r.status === 200);
    r = await call('it', 'PATCH', `/api/admin/users/${newUser.id}`, { active: false, password: 'newpass1' }); check('account deactivated', r.json.active === false);
    r = await call('store1', 'GET', '/api/admin/orders'); check('deactivated session stops working', r.status === 401);
    r = await login('store1', 'store1', 'newpass1'); check('deactivated account cannot log in', r.status === 401);
    r = await call('it', 'PATCH', `/api/admin/users/${itUser.id}`, { role: 'finance' }); check('cannot demote the last it-admin', r.status === 400);
    r = await call('it', 'PATCH', `/api/admin/users/${finUser.id}`, { password: 'jiancha2' }); check('password reset', r.status === 200);
    r = await login('fin2', 'finance', 'jiancha2'); check('reset password works', r.status === 200);
    r = await call('fin2', 'POST', '/api/admin/me/password', { current: 'jiancha2', password: 'jiancha' }); check('user changes own password', r.status === 200);
    r = await call('it', 'DELETE', `/api/admin/users/${itUser.id}`); check('cannot delete self', r.status === 400);
    r = await call('it', 'DELETE', `/api/admin/users/${newUser.id}`); check('account deleted', r.status === 200);

    // ── campaigns ──
    r = await call('fin', 'GET', '/api/admin/campaigns'); check('everyone lists campaigns', r.status === 200 && r.json.length === 1 && r.json[0].active && r.json[0].stats.orders === 2, r.json);
    r = await call('fin', 'POST', '/api/admin/campaigns', { name: 'X' }); check('finance cannot create campaigns', r.status === 403);
    r = await call('it', 'POST', '/api/admin/campaigns', { name: 'JIANCHA x SUMMER', stock_total: 500, promo_from: 2026100001, promo_to: 2026100500 }); check('campaign created inactive', r.status === 201 && r.json.id === 'jiancha-x-summer' && r.json.active === false && r.json.stock.total === 500 && r.json.promo_code.first === '2026100001' && r.json.promo_code.prefix === '');
    const camp2 = r.json;
    r = await call('it', 'PATCH', '/api/admin/campaigns/jiancha-x-summer', { promo_prefix: 'sm-26', promo_from: 1, promo_to: 500 }); check('campaign promo prefix + zero-padded range', r.status === 200 && r.json.promo_code.prefix === 'SM-26' && r.json.promo_code.first === 'SM-26001' && r.json.promo_code.last === 'SM-26500' && r.json.promo_code.count === 500, r.json.promo_code);
    r = await call('it', 'GET', '/api/admin/campaigns'); check('navori campaign uses NVR26 range (2000 codes)', r.json.find((c) => c.id === 'jiancha-x-navori').promo_code.first === 'NVR260001' && r.json.find((c) => c.id === 'jiancha-x-navori').promo_code.last === 'NVR262000', r.json.map((c) => c.promo_code));
    r = await call('it', 'POST', '/api/admin/campaigns', { name: 'JIANCHA x SUMMER', promo_from: 5, promo_to: 1 }); check('bad promo range rejected', r.status === 400);
    r = await call('it', 'PATCH', `/api/admin/campaigns/${camp2.id}`, { active: true }); check('campaign activated', r.json.active === true);
    r = await call('customer', 'GET', '/api/menu'); check('customer site follows active campaign', r.json.campaign.id === camp2.id && r.json.stock.limits.total === 500 && r.json.stock.used.total === 0);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('order lands in new campaign', r.json.campaign_id === camp2.id);
    r = await call('it', 'PATCH', '/api/admin/campaigns/jiancha-x-navori', { active: true }); check('switch back', r.json.active === true);
    r = await call('it', 'GET', '/api/admin/campaigns'); check('exactly one active', r.json.filter((c) => c.active).length === 1);

    // ── design (IT-Admin): promote images + sets per campaign ──
    r = await call('fin', 'GET', '/api/admin/campaigns/jiancha-x-navori/design'); check('finance cannot open design', r.status === 403);
    r = await call('it', 'GET', '/api/admin/campaigns/jiancha-x-navori/design'); check('design defaults to menu.json', r.status === 200 && r.json.design.sets.length === 2 && r.json.design.promote_images.length === TEMPLATE_BANNERS && r.json.campaign.has_design === false, r.json);
    const imgForm = new FormData(); imgForm.append('image', new Blob([tinyPng(9)], { type: 'image/png' }), 'banner.png');
    r = await call('it', 'POST', '/api/admin/design/upload', imgForm); check('design image uploaded', r.status === 201 && /^\/uploads\/design\/\d+-[a-f0-9]+\.png$/.test(r.json.url), r.json);
    const bannerUrl = r.json.url;
    r = await call('other', 'GET', bannerUrl); check('design image is public', r.status === 200);
    r = await call('mkt', 'POST', '/api/admin/design/upload', imgForm); check('marketing cannot upload design images', r.status === 403);
    const svgForm = new FormData(); svgForm.append('image', new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'], { type: 'image/svg+xml' }), 'set.svg');
    r = await call('it', 'POST', '/api/admin/design/upload', svgForm); check('svg accepted', r.status === 201 && /\.svg$/.test(r.json.url), r.json);
    { const sr = await fetch(base + r.json.url); check('svg served sandboxed', sr.status === 200 && /image\/svg/.test(sr.headers.get('content-type')) && /default-src 'none'/.test(sr.headers.get('content-security-policy') || '')); }
    const dz = (await call('it', 'GET', '/api/admin/campaigns/jiancha-x-navori/design')).json.design;
    dz.promote_images = [bannerUrl, 'javascript:alert(1)']; dz.sets[0].price = 300; dz.sets[0].image = bannerUrl;
    dz.sets.push({ id: 'C', label: 'SET C', name_en: 'Third', name_th: 'สาม', price: 99, items: [{ name_en: 'Tea', kind: 'drink' }], pieces: 2 });
    r = await call('it', 'PUT', '/api/admin/campaigns/jiancha-x-navori/design', dz); check('design saved + sanitized', r.status === 200 && r.json.design.promote_images.length === 1 && r.json.design.sets.length === 3 && r.json.design.sets[2].drink_pieces === 1 && r.json.campaign.cover === bannerUrl && r.json.campaign.set_count === 3, r.json);
    r = await call('customer', 'GET', '/api/menu'); check('homepage follows the design', r.json.banners.length === 1 && r.json.banner === bannerUrl && r.json.sets.length === 3 && r.json.sets[0].price === 300 && r.json.sets[0].image === bannerUrl, r.json);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: 'C', quantity: 1 }] }); check('order a designed set (2 pieces)', r.status === 201 && r.json.total === 99 && r.json.lines[0].pieces === 2 && r.json.lines[0].name === 'SET C · Third', r.json);
    const orderC = r.json;
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: 'Z', quantity: 1 }] }); check('unknown set rejected', r.status === 400);
    dz.sets = dz.sets.filter((x) => x.id !== 'C'); r = await call('it', 'PUT', '/api/admin/campaigns/jiancha-x-navori/design', dz);
    r = await call('customer', 'GET', `/api/orders/${orderC.id}`); check('old order keeps its set snapshot', r.json.lines[0].name === 'SET C · Third');
    r = await call('fin', 'POST', `/api/admin/orders/${orderC.id}/status`, { status: 'cancelled' }); check('cleanup: cancel designed-set order', r.json.status === 'cancelled');
    r = await call('it', 'GET', '/api/admin/campaigns/jiancha-x-summer/design'); check('other campaign still on template', r.json.design.sets.length === 2 && r.json.design.promote_images.length === TEMPLATE_BANNERS);

    // ── campaign URLs: /<slug>/ shows that campaign; orders can name the campaign ──
    r = await call('mkt', 'GET', '/api/admin/customers'); check('admin customer list has the google customer', r.status === 200 && r.json.total === 1 && r.json.rows[0].email === 'alice@gmail.com' && r.json.rows[0].orders >= 1, r.json);
    r = await call('mkt', 'GET', '/api/admin/customers?q=nobody'); check('customer search filters', r.json.total === 0);
    r = await call('mkt', 'GET', '/api/admin/customers?campaign=jiancha-x-navori'); check('customer listed under the campaign she signed in from', r.json.total === 1 && r.json.campaign.slug === 'jianchaxnavori' && r.json.rows[0].joined_at, r.json);
    const navoriOrders = r.json.rows[0].orders;
    r = await call('mkt', 'GET', '/api/admin/customers?campaign=jiancha-x-summer'); check('summer lists alice only via her summer order, counted per campaign', r.json.total === 1 && r.json.rows[0].email === 'alice@gmail.com' && r.json.rows[0].orders >= 1 && r.json.rows[0].orders < navoriOrders, r.json.rows.map((c) => [c.email, c.orders]));
    r = await call('mkt', 'GET', '/api/admin/customers?campaign=all'); check('all campaigns lists her once (plus bob from the hold test)', r.json.total === 2 && r.json.rows.filter((x) => x.email === 'alice@gmail.com').length === 1 && r.json.campaign === null, r.json);
    r = await call('customer2', 'POST', '/api/auth/google', { credential: 'bob', campaign: 'jianchaxsummer' }); check('bob signs in from the summer campaign page', r.json.logged_in === true && r.json.email === 'bob@gmail.com');
    r = await call('mkt', 'GET', '/api/admin/customers?campaign=jiancha-x-summer'); check('bob listed under summer with 0 orders (signed in from that page)', r.json.total === 2 && r.json.rows.some((c) => c.email === 'bob@gmail.com' && c.orders === 0), r.json.rows.map((c) => [c.email, c.orders]));
    r = await call('mkt', 'GET', '/api/admin/customers?campaign=jiancha-x-navori'); check('navori still only alice', r.json.total === 1 && r.json.rows[0].email === 'alice@gmail.com');
    r = await call('customer', 'GET', '/api/admin/customers'); check('customer list needs admin', r.status === 401);
    r = await call('it', 'GET', '/api/admin/campaigns'); check('campaign slug + url', r.json.find((c) => c.id === 'jiancha-x-navori').slug === 'jianchaxnavori' && r.json.find((c) => c.id === 'jiancha-x-summer').slug === 'jianchaxsummer' && r.json[0].url === `/${r.json[0].slug}/`, r.json.map((c) => c.slug));
    r = await fetch(base + '/jianchaxnavori/'); check('campaign page served', r.status === 200 && /Match Sets|id="sets"/.test(await r.text()));
    r = await fetch(base + '/jianchaxnavori', { redirect: 'manual' }); check('campaign page redirects to trailing slash', r.status === 301 && r.headers.get('location') === '/jianchaxnavori/');
    r = await fetch(base + '/jianchaxsummer/cart'); check('campaign sub-page served', r.status === 200);
    r = await fetch(base + '/no-such-campaign/'); check('unknown campaign 404', r.status === 404);
    r = await call('customer', 'GET', '/api/menu?campaign=jianchaxsummer'); check('menu for a campaign by slug', r.json.campaign.id === 'jiancha-x-summer' && r.json.campaign.url === '/jianchaxsummer/' && r.json.stock.limits.total === 500, r.json.campaign);
    r = await call('customer', 'GET', '/api/menu'); check('root menu is the active campaign', r.json.campaign.id === 'jiancha-x-navori');
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', campaign: 'jianchaxsummer', lines: [{ set_id: A, quantity: 1 }] }); check('order into a campaign by slug', r.status === 201 && r.json.campaign_id === 'jiancha-x-summer', r.json);
    r = await call('fin', 'POST', `/api/admin/orders/${r.json.id}/status`, { status: 'cancelled' });
    r = await call('it', 'PATCH', '/api/admin/campaigns/jiancha-x-summer', { slug: 'jianchaxnavori' }); check('duplicate slug rejected', r.status === 409);
    r = await call('it', 'PATCH', '/api/admin/campaigns/jiancha-x-summer', { slug: 'Summer 2026!', orders_open: false }); check('slug normalized + orders closed', r.status === 200 && r.json.slug === 'summer2026' && r.json.orders_open === false, r.json);
    r = await fetch(base + '/summer2026/'); check('renamed campaign page served', r.status === 200);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', campaign: 'summer2026', lines: [{ set_id: A, quantity: 1 }] }); check('closed campaign refuses orders', r.status === 400 && /ปิดรับ/.test(r.json.error));
    r = await call('customer', 'GET', '/api/menu?campaign=summer2026'); check('closed flag visible to customers', r.json.campaign.orders_open === false);
    r = await call('it', 'POST', '/api/admin/campaigns', { name: 'JIANCHA x SUMMER', slug: 'x' }); check('too-short slug rejected', r.status === 400);

    await dbx.run('DELETE FROM holds');   // quote ทดสอบก่อนหน้าจองคิวไว้ → เคลียร์ก่อนตรวจสต๊อกรวม
    // ── stock (campaign jiancha-x-navori: 1000 sets; 4 used above: A×2 + B×1 + B×1) ──
    // ยกโควตาชุด/วันชั่วคราว (ทดสอบสต๊อกรวมด้วยออเดอร์ใหญ่กว่า 200 ชุด) แล้วคืนค่าหลังจบส่วนนี้
    const dz0 = (await call('it', 'GET', '/api/admin/campaigns/jiancha-x-navori/design')).json.design;
    r = await call('it', 'PUT', '/api/admin/campaigns/jiancha-x-navori/design', { ...dz0, orders_per_day: 5000 }); check('temporarily lift per-day set quota for stock tests', r.status === 200 && r.json.design.orders_per_day === 5000, r.json);
    r = await call('customer', 'GET', '/api/stock'); check('stock view', r.json.limits.total === 1000 && r.json.used.total === 4 && r.json.remaining.total === 996 && r.json.used.drink === 4 && r.json.used.dessert === 8, r.json);
    const big = (n) => Array.from({ length: n }, () => ({ set_id: A, quantity: 99 }));
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: big(11) }); check('order above stock rejected', r.status === 409 && /เหลือเพียง 996/.test(r.json.error), r.json);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: big(10) }); check('order within stock accepted', r.status === 201, r.json);
    const bigOrder = r.json;
    r = await call('customer', 'GET', '/api/stock'); check('stock reserved by an order waiting for slip review', r.json.remaining.total === 6, r.json);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: B, quantity: 7 }] }); check('7 sets vs 6 left rejected', r.status === 409, r.json);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: B, quantity: 6 }] }); check('last 6 sets accepted', r.status === 201, r.json);
    r = await call('customer', 'GET', '/api/menu'); check('menu reports sold out', r.json.stock.sold_out === true && r.json.stock.remaining.total === 0, r.json.stock);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('sold out rejected', r.status === 409 && /หมดแล้ว/.test(r.json.error), r.json);
    r = await call('it', 'POST', `/api/admin/orders/${bigOrder.id}/status`, { status: 'paid' });
    r = await call('it', 'POST', `/api/orders/${bigOrder.id}/code`); check('next approved order gets the next number (NVR260002), never reused after cancel', r.status === 200 && r.json.promo_code === 'NVR260002' && r.json.promo_code !== code1, r.json);
    r = await call('fin', 'POST', `/api/admin/orders/${bigOrder.id}/status`, { status: 'cancelled' }); check('finance cancels big order', r.json.status === 'cancelled');
    r = await call('customer', 'GET', '/api/stock'); check('cancelled order frees stock', r.json.remaining.total === 990, r.json);
    r = await call('it', 'PUT', '/api/admin/campaigns/jiancha-x-navori/design', { ...dz0, orders_per_day: null }); check('per-day set quota restored to template (200)', r.status === 200 && (await call('customer', 'GET', '/api/stock')).json.order_window.per_day === 200);
    r = await call('it', 'GET', '/api/admin/summary?campaign=jiancha-x-navori'); check('summary per campaign', r.status === 200 && r.json.stock.remaining.total === 990);

    // ── ช่วงเปิดรับออเดอร์ 18–22 ก.ย. 2026 + โควตา 200 ชุด/วัน (นับ quantity × pieces ไม่ใช่จำนวนออเดอร์) ──
    { // เปิดรับล่วงหน้า N ชั่วโมงก่อนวันแรก (lib/window.effectiveOrderDay)
      const { effectiveOrderDay } = require('../lib/window'); const days = ['2026-09-18', '2026-09-19'];
      const at = (s) => new Date(s + '+07:00');
      check('early open: 12h before -> first order day', effectiveOrderDay(days, { earlyHours: 12, now: at('2026-09-17T12:00:00') }) === '2026-09-18');
      check('early open: 12h01 before -> still closed (actual day)', effectiveOrderDay(days, { earlyHours: 12, now: at('2026-09-17T11:59:00') }) === '2026-09-17');
      check('early open: not set -> actual day', effectiveOrderDay(days, { earlyHours: 0, now: at('2026-09-17T23:00:00') }) === '2026-09-17');
      check('early open: override wins', effectiveOrderDay(days, { override: '2026-09-20', earlyHours: 12, now: at('2026-09-17T12:00:00') }) === '2026-09-20');
    }
    r = await call('customer', 'GET', '/api/stock'); const ow = r.json.order_window;
    check('order window: open today (18 Sep), 5 days x 200 = 1000, counts today', ow.open === true && ow.status === 'open' && ow.days.length === 5 && ow.per_day === 200 && ow.total_max === 1000 && ow.today === '2026-09-18' && ow.today_count > 0 && ow.today_remaining === 200 - ow.today_count && ow.range.th === '18–22 กันยายน 2569', ow);
    setDay('2026-09-17');
    r = await call('customer', 'GET', '/api/stock'); check('before the window: status before + message', r.json.order_window.status === 'before' && /ยังไม่เปิดรับ/.test(r.json.order_window.message), r.json.order_window);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('order before the window rejected (409)', r.status === 409 && /ยังไม่เปิดรับ/.test(r.json.error), r.json);
    setDay('2026-09-23');
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-25', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('order after the window rejected (409)', r.status === 409 && /ปิดรับ/.test(r.json.error), r.json);
    setDay('2026-09-19');
    r = await call('customer', 'GET', '/api/stock'); check('next window day starts at 0 orders', r.json.order_window.open === true && r.json.order_window.today_count === 0);
    const dzw = (await call('it', 'GET', '/api/admin/campaigns/jiancha-x-navori/design')).json.design;
    r = await call('it', 'PUT', '/api/admin/campaigns/jiancha-x-navori/design', { ...dzw, orders_per_day: 2 }); check('campaign design can set its own per-day quota', r.status === 200 && r.json.design.orders_per_day === 2, r.json.design);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-26', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 3 }] }); check('quota counts sets: 3 sets in one order exceed 2/day (409)', r.status === 409 && /เหลือเพียง 2 ชุด/.test(r.json.error), r.json);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-26', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('quota: order 1 of 2 accepted', r.status === 201 && r.json.order_day === undefined, r.json.error);
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-26', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('quota: order 2 of 2 accepted', r.status === 201, r.json.error);
    const quotaOrder = r.json;
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-26', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('quota: order 3 rejected, told to come back 20 Sep', r.status === 409 && /ครบ 2 ชุด/.test(r.json.error) && /20 กันยายน 2569/.test(r.json.error), r.json);
    r = await call('customer', 'GET', '/api/stock'); check('stock view reports today full', r.json.order_window.status === 'full' && r.json.order_window.today_remaining === 0);
    r = await call('fin', 'POST', `/api/admin/orders/${quotaOrder.id}/status`, { status: 'cancelled' }); check('cancel frees a quota slot', r.json.status === 'cancelled');
    r = await placeOrder('customer', { store_id: storeId, phone: '0812345678', pickup_date: '2026-09-26', pickup_time: '13:00-15:00 น.', lines: [{ set_id: A, quantity: 1 }] }); check('quota: slot reused after cancel', r.status === 201, r.json.error);
    r = await call('it', 'PUT', '/api/admin/campaigns/jiancha-x-navori/design', { ...dzw, orders_per_day: null }); check('design without per-day quota falls back to template (200)', r.status === 200 && (await call('customer', 'GET', '/api/stock')).json.order_window.per_day === 200);
    r = await call('it', 'GET', '/api/admin/summary?campaign=jiancha-x-navori'); check('admin summary carries the order window', r.json.stock.order_window && r.json.stock.order_window.per_day === 200 && r.json.stock.order_window.total_count >= 3);
    setDay('2026-09-18');

    // ── ออเดอร์แยกตามบัญชี Google + หลังบ้านเห็นอีเมล/เบอร์ + บัญชีที่เตรียมไว้ล่วงหน้าด้วยอีเมล ──
    {
      const placeholderId = 'pre-' + Date.now();
      await dbx.run('INSERT INTO customers(id, email, name) VALUES (?, ?, ?)', placeholderId, 'wendy@gmail.com', 'wendy');
      await dbx.run('UPDATE orders SET customer_id = ? WHERE id = ?', placeholderId, order2.id);
      r = await call('customer', 'GET', '/api/orders'); check('order moved to the pre-assigned account leaves alice history', !r.json.some((o) => o.id === order2.id));
      r = await call('it', 'GET', `/api/admin/orders/${order2.id}`); check('back-office shows google account email + contact number for the order', r.json.customer_email === 'wendy@gmail.com' && r.json.phone === '0812345678', r.json);
      check('back-office order carries pdpa consent time', r.json.pdpa_accepted_at === pdpaAt, r.json.pdpa_accepted_at);
      r = await call('it', 'GET', '/api/admin/orders?q=wendy@gmail'); check('back-office search by google email', r.json.rows.some((o) => o.id === order2.id) && r.json.rows.every((o) => o.customer_email === 'wendy@gmail.com'), r.json.total);
      r = await call('it', 'GET', '/api/admin/orders?q=0812345678'); check('back-office search by contact number', r.json.rows.some((o) => o.id === order2.id));
      r = await call('wendy', 'GET', '/api/orders'); check('not signed in = no order history', r.json.length === 0);
      r = await call('wendy', 'POST', '/api/auth/google', { credential: 'wendy' }); check('pre-assigned email claims its account on first google login', r.json.logged_in === true && r.json.email === 'wendy@gmail.com');
      r = await call('wendy', 'GET', '/api/orders'); check('claimed account sees the pre-assigned order', r.json.length === 1 && r.json[0].id === order2.id, r.json.map((o) => o.id));
      check('placeholder row became the google account (no duplicate customer)', (await dbx.get('SELECT COUNT(*) AS n FROM customers WHERE email = ?', 'wendy@gmail.com')).n === 1 && (await dbx.get('SELECT google_sub FROM customers WHERE id = ?', placeholderId)).google_sub === 'sub-wendy');
      if (!CF) {
      // db.js migration: ออเดอร์เดิมที่ไม่ผูกบัญชี Google → บัญชีเจ้าของ (LEGACY_ORDERS_OWNER) ทำครั้งเดียว
      const { execFileSync } = require('child_process'); const mdb = process.env.DB_PATH + '-legacy.db';
      const runDb = (js) => execFileSync(process.execPath, ['-e', `const { db } = require(${JSON.stringify(path.join(__dirname, '..', 'db.js'))}); ${js}`], { env: { ...process.env, DB_PATH: mdb, LEGACY_ORDERS_OWNER: 'owner@gmail.com' }, encoding: 'utf8' }).trim();
      runDb(`db.exec("DELETE FROM meta WHERE key = 'legacy_orders_owner'; INSERT INTO customers(id) VALUES ('anon1'),('anon2'); INSERT INTO customers(id, google_sub, email) VALUES ('g1','sub-g1','g1@gmail.com'); INSERT INTO orders(id, order_number, customer_id, campaign_id, store_id, store_name, total) VALUES ('o1','1',  'anon1','jiancha-x-navori','s','S',1),('o2','2','anon2','jiancha-x-navori','s','S',1),('o3','3','g1','jiancha-x-navori','s','S',1)")`);
      const out = runDb(`const o = db.prepare("SELECT id FROM customers WHERE email = 'owner@gmail.com' AND google_sub IS NULL").get(); console.log(JSON.stringify({ owner: Boolean(o), moved: o ? db.prepare('SELECT group_concat(id) AS ids FROM (SELECT id FROM orders WHERE customer_id = ? ORDER BY id)').get(o.id).ids : '', g1: db.prepare("SELECT customer_id FROM orders WHERE id = 'o3'").get().customer_id, flag: db.prepare("SELECT value FROM meta WHERE key = 'legacy_orders_owner'").get().value, camp: o ? db.prepare('SELECT COUNT(*) AS n FROM customer_campaigns WHERE customer_id = ?').get(o.id).n : 0 }))`);
      const mig = JSON.parse(out);
      check('legacy migration: orders without google account move to the owner email (once), google-owned orders stay', mig.owner && mig.moved === 'o1,o2' && mig.g1 === 'g1' && mig.flag === 'owner@gmail.com' && mig.camp === 1, mig);
      for (const suf of ['', '-wal', '-shm']) { try { fs.unlinkSync(mdb + suf); } catch (e) { /* ignore */ } }
      }
    }

    // หน้าแรกแบบ Membership: ตั้งใน Design → /<slug>/ เป็นฟอร์มสมัครสมาชิก, POST /api/members, หลังบ้าน Members
    {
      const sm = { campaign: 'jianchaxsummer', first_name: ' Somchai ', last_name: 'Jaidee', phone: '081-234-5678', email: 'somchai@example.com', pickup_date: '2026-12-25', store_id: 'JF001' };
      r = await call('guest', 'POST', '/api/members', sm); check('membership sign-up refused while homepage is the order menu', r.status === 400, r.json);
      let dz = (await call('it', 'GET', '/api/admin/campaigns/jiancha-x-summer/design')).json.design;
      check('design defaults to order homepage', dz.home === 'order', dz.home);
      r = await call('it', 'PUT', '/api/admin/campaigns/jiancha-x-summer/design', { ...dz, home: 'membership' }); check('design saves membership homepage', r.status === 200 && r.json.design.home === 'membership', r.json);
      r = await fetch(base + '/jianchaxsummer/'); check('membership campaign home serves the sign-up form', r.status === 200 && /id="mb-form"/.test(await r.text()));
      r = await fetch(base + '/JianchaXSummer/'); check('membership home works with mixed-case link', r.status === 200 && /id="mb-form"/.test(await r.text()));
      r = await fetch(base + '/jianchaxnavori/'); check('other campaigns keep the order menu', r.status === 200 && /id="sets"/.test(await r.text()));
      r = await call('guest', 'GET', '/api/member-stores'); check('membership locations = 35 pick-up branches (A-Z)', r.status === 200 && r.json.length === 35 && !r.json.some((x) => x.id === 'JC003') && r.json.some((x) => x.id === 'JF001' && x.name === 'Fashion Island') && r.json[0].name.localeCompare(r.json[1].name) <= 0, r.json && r.json.length);
      r = await call('guest', 'POST', '/api/members', { ...sm, store_id: 'JC003' }); check('branch not in the 35 pick-up branches rejected', r.status === 400 && r.json.field === 'store_id', r.json);
      r = await call('guest', 'GET', '/api/menu?campaign=jianchaxsummer'); check('menu exposes home + pickup times', r.json.home === 'membership' && r.json.pickup_times.includes('13:00-15:00 น.'), r.json.home);
      r = await call('guest', 'POST', '/api/members', { ...sm, phone: '12' }); check('bad phone rejected', r.status === 400 && r.json.field === 'phone', r.json);
      r = await call('guest', 'POST', '/api/members', { ...sm, last_name: '' }); check('missing last name rejected', r.status === 400 && r.json.field === 'last_name', r.json);
      r = await call('guest', 'POST', '/api/members', { ...sm, pickup_date: '2026-12-24' }); check('pick-up date before 25 Dec 2026 rejected', r.status === 400 && r.json.field === 'pickup_date', r.json);
      r = await call('guest', 'POST', '/api/members', { ...sm, pickup_date: '2027-02-01' }); check('pick-up date after 31 Jan 2027 rejected', r.status === 400 && r.json.field === 'pickup_date', r.json);
      r = await call('guest', 'GET', '/api/member-dates'); check('member pick-up dates = 25 Dec 2026 - 31 Jan 2027', r.json.length === 38 && r.json[0] === '2026-12-25' && r.json[37] === '2027-01-31', r.json && r.json.length);
      r = await call('guest', 'POST', '/api/members', { ...sm, store_id: 'nope' }); check('unknown store rejected', r.status === 400 && r.json.field === 'store_id', r.json);
      r = await call('guest', 'POST', '/api/members', sm); check('member signs up', r.status === 201 && r.json.member.pickup_date === '2026-12-25' && r.json.member.first_name === 'Somchai' && r.json.member.phone === '0812345678' && /Fashion Island/.test(r.json.member.store_name), r.json);
      r = await call('guest', 'POST', '/api/members', { ...sm, store_id: 'JC010' }); check('same phone again updates the member', r.status === 201 && /Central world Groove/.test(r.json.member.store_name), r.json);
      r = await call('guest', 'POST', '/api/members', { ...sm, campaign: 'nope' }); check('unknown campaign rejected', r.status === 404);
      r = await call('guest', 'GET', '/api/admin/members'); check('members list needs back-office login', r.status === 401);
      r = await call('mkt', 'GET', '/api/admin/members?campaign=jiancha-x-summer'); check('back-office lists members (one per phone)', r.status === 200 && r.json.total === 1 && r.json.rows[0].last_name === 'Jaidee' && /Central world Groove/.test(r.json.rows[0].store_name), r.json);
      r = await call('mkt', 'GET', '/api/admin/members?campaign=jiancha-x-summer&q=jaid'); check('members search', r.json.total === 1);
      r = await call('mkt', 'GET', '/api/admin/members?campaign=jiancha-x-navori'); check('members are per campaign', r.json.total === 0);
      r = await call('mkt', 'GET', '/api/admin/members?campaign=all&export=1'); check('members export all', r.json.total === 1 && r.json.rows[0].campaign_name === 'JIANCHA x SUMMER', r.json);
      r = await fetch(base + '/jianchaxsummer/cart', { redirect: 'manual' }); check('membership campaign has no cart page', r.status === 302 && r.headers.get('location') === '/jianchaxsummer/', r.status);
      r = await fetch(base + '/jianchaxsummer/orders', { redirect: 'manual' }); check('membership campaign has no order history page', r.status === 302);
      r = await call('guest', 'POST', '/api/hold', { campaign: 'jianchaxsummer', lines: [{ set_id: 'A', quantity: 1 }] }); check('membership campaign refuses cart holds', r.status === 400 && /สมัครสมาชิก/.test(r.json.error), r.json);
      r = await call('guest', 'POST', '/api/quote', { campaign: 'jianchaxsummer', store_id: 'siam-paragon', phone: '0812345678', email: 'a@gmail.com', lines: [{ set_id: 'A', quantity: 1 }] }); check('membership campaign refuses orders', r.status === 400 || r.status === 401, r.json);
      { const M = require('../lib/menu'); const j = JSON.parse(M.membershipDesignJson(JSON.stringify({ sets: [{ id: 'A' }], home: 'order' }))); check('membership migration keeps design, sets home', j.home === 'membership' && j.sets.length === 1 && JSON.parse(M.membershipDesignJson(null)).home === 'membership' && M.MEMBERSHIP_HOME_SLUGS.includes('celebrateeverymomentwithjiancha')); }
      r = await call('it', 'POST', '/api/admin/campaigns', { name: 'JIANCHA MEMBERSHIP', slug: 'celebrateeverymomentwithjiancha', promo_prefix: 'JCMB', promo_from: 1, promo_to: 2000 }); const memId = r.json.id;
      // รายชื่อ ELITE: ลิงก์ celebrate รับเฉพาะเบอร์ในรายชื่อ (ยังไม่อัปโหลด = ไม่มีใครสมัครได้)
      const cm = { ...sm, campaign: 'celebrateeverymomentwithjiancha' };
      r = await call('guest', 'POST', '/api/members/check', { campaign: cm.campaign, phone: '0899999999' }); check('celebrate: no ELITE list yet = not eligible', r.status === 200 && r.json.eligible === false && /ยังไม่เป็นสมาชิกระดับ elite/.test(r.json.message), r.json);
      r = await call('guest', 'POST', '/api/members', cm); check('celebrate: sign-up refused without ELITE list', r.status === 403 && r.json.not_elite === true && r.json.field === 'phone', r.json);
      const eliteRows = [{ phone: '(66) 812345678', name: 'สุดา ทดสอบ', tier: 'ELITE', email: 'suda@example.com', data: { 'ยอดสะสมระดับ': '12000', 'สาขาที่สมัคร': 'JF001' } }, { phone: '(66) 898765432', name: 'B', tier: 'ELITE' }, { phone: 'n/a', name: 'bad' }, { phone: '0812345678', name: 'dup' }];
      r = await call('fin', 'PUT', '/api/admin/member-list', { rows: eliteRows }); check('finance cannot upload ELITE list', r.status === 403);
      r = await call('mkt', 'PUT', '/api/admin/member-list', { rows: [{ phone: 'x' }] }); check('ELITE upload with no phones rejected', r.status === 400);
      r = await call('mkt', 'PUT', '/api/admin/member-list', { rows: eliteRows }); check('marketing uploads ELITE list (phones normalized, dupes merged)', r.status === 200 && r.json.imported === 2 && r.json.skipped === 1, r.json);
      r = await call('fin', 'GET', '/api/admin/member-list?q=0812'); check('ELITE list searchable in Customer (+3 test accounts)', r.status === 200 && r.json.all === 5 && r.json.total === 1 && r.json.rows[0].phone === '0812345678' && r.json.rows[0].name === 'dup' && r.json.rows[0].data, r.json);
      r = await call('mkt', 'GET', '/api/admin/member-list?q=suda'); check('ELITE list search by email', r.json.total === 0 || r.json.rows.every((x) => /suda/.test(x.email)), r.json);
      r = await call('guest', 'GET', '/api/admin/member-list'); check('ELITE list needs back-office login', r.status === 401);
      r = await call('guest', 'POST', '/api/members/check', { campaign: cm.campaign, phone: '+66 89-876-5432' }); check('ELITE phone eligible (any format)', r.json.eligible === true, r.json);
      r = await call('guest', 'POST', '/api/members/check', { campaign: cm.campaign, phone: '0899999999' }); check('non-ELITE phone gets the red message', r.json.eligible === false && r.json.message.includes('Line OA @jiancha'), r.json);
      r = await call('guest', 'POST', '/api/members', { ...cm, phone: '0899999999' }); check('non-ELITE sign-up refused', r.status === 403 && r.json.not_elite === true);
      r = await call('guest', 'POST', '/api/members', { ...cm, phone: '0898765432' }); check('ELITE member signs up with a random JCMB0001-JCMB2000 code + email', r.status === 201 && r.json.member.phone === '0898765432' && /^JCMB\d{4}$/.test(r.json.member.pickup_code) && Number(r.json.member.pickup_code.slice(4)) >= 1 && Number(r.json.member.pickup_code.slice(4)) <= 2000 && r.json.mail && r.json.mail.status === 'sent' && r.json.member.date_changes_left === 1, r.json);
      const code1 = r.json.member.pickup_code;
      r = await call('guest', 'POST', '/api/members', { ...sm, phone: '0811111111' }); check('other membership campaigns also check the list once uploaded', r.status === 403);
      r = await call('mkt', 'PUT', '/api/admin/member-list', { rows: [{ phone: '0811111111', name: 'C' }] }); r = await call('mkt', 'GET', '/api/admin/member-list'); check('re-upload replaces the whole list but keeps the 3 test accounts', r.json.all === 4 && r.json.rows.some((x) => x.phone === '0811111111') && ['0991119999', '0991110000', '0991115555'].every((p) => r.json.rows.some((x) => x.phone === p && x.tier === 'TEST')), r.json);
      r = await call('guest', 'POST', '/api/members/check', { campaign: cm.campaign, phone: '099-111-0000' }); check('test account eligible with its email for auto-fill', r.json.eligible === true && r.json.email === 'it.team@jianchatea.com', r.json);
      // อีเมล: เบอร์ในรายชื่อ ELITE ที่มีอีเมล → เติมให้แบบปิดบางส่วน; ไม่แก้ = ใช้อีเมลจากรายชื่อ, แก้ได้
      r = await call('mkt', 'PUT', '/api/admin/member-list', { rows: [{ phone: '0811111111', name: 'C', email: 'Lek.Lek@Hotmail.com' }, { phone: '0822222222', name: 'D' }] });
      r = await call('guest', 'POST', '/api/members/check', { campaign: cm.campaign, phone: '0811111111' }); check('check returns the ELITE email for auto-fill', r.json.eligible === true && r.json.email === 'lek.lek@hotmail.com' && r.json.email_masked === 'le***@hotmail.com', r.json);
      r = await call('guest', 'POST', '/api/members/check', { campaign: cm.campaign, phone: '0822222222' }); check('no email in list = nothing to fill', r.json.eligible === true && r.json.email === '' && r.json.email_masked === '', r.json);
      r = await call('guest', 'POST', '/api/members/check', { campaign: cm.campaign, phone: '0899999999' }); check('non-ELITE check returns no email', !r.json.email && !r.json.email_masked, r.json);
      r = await call('guest', 'POST', '/api/members', { ...cm, phone: '0811111111', use_list_email: true }); check('unchanged auto-filled email saves the email from the list', r.status === 201 && r.json.member.email === 'lek.lek@hotmail.com', r.json);
      r = await call('guest', 'POST', '/api/members', { ...cm, phone: '0811111111', email: 'New@Mail.com' }); check('edited email is saved instead', r.status === 201 && r.json.member.email === 'new@mail.com', r.json);
      r = await call('guest', 'POST', '/api/members', { ...cm, phone: '0822222222', email: 'not-an-email' }); check('invalid email rejected', r.status === 400 && r.json.field === 'email', r.json);
      r = await call('guest', 'POST', '/api/members', { ...cm, phone: '0822222222', email: '' }); check('email is required (code is sent there)', r.status === 400 && r.json.field === 'email', r.json);
      r = await call('guest', 'POST', '/api/members', { ...cm, phone: '0822222222', use_list_email: true }); check('use_list_email without an email in the list is rejected', r.status === 400 && r.json.field === 'email', r.json);
      // เปลี่ยนวันที่รับของได้ 1 ครั้ง + อีเมลรหัสทุกครั้งที่เลือกวัน
      r = await call('guest', 'POST', '/api/members', { ...cm, phone: '0822222222', email: 'd@example.com' }); const code2 = r.json.member.pickup_code; check('new member: code mailed', r.status === 201 && /^JCMB\d{4}$/.test(code2) && r.json.mail.status === 'sent', r.json);
      r = await call('guest', 'POST', '/api/members', { ...cm, phone: '0822222222', email: 'd@example.com', store_id: 'JC010' }); check('editing other fields (same date) sends no email', r.status === 201 && r.json.mail === null && r.json.member.date_changes_left === 1, r.json);
      r = await call('guest', 'POST', '/api/members/check', { campaign: cm.campaign, phone: '0822222222' }); check('check tells the saved date + changes left', r.json.member && r.json.member.pickup_date === '2026-12-25' && r.json.member.date_changes_left === 1, r.json);
      r = await call('guest', 'POST', '/api/members', { ...cm, phone: '0822222222', email: 'd@example.com', pickup_date: '2027-01-05' }); check('first date change allowed: same code, email sent again', r.status === 201 && r.json.member.pickup_date === '2027-01-05' && r.json.member.pickup_code === code2 && r.json.member.first_pickup_date === '2026-12-25' && r.json.member.date_changes_left === 0 && r.json.mail.status === 'sent', r.json);
      r = await call('guest', 'POST', '/api/members', { ...cm, phone: '0822222222', email: 'd@example.com', pickup_date: '2027-01-10' }); check('second date change refused', r.status === 409 && r.json.date_locked === true && r.json.pickup_date === '2027-01-05', r.json);
      r = await call('guest', 'POST', '/api/members', { ...cm, phone: '0822222222', email: 'e@example.com', pickup_date: '2027-01-05' }); check('after the change, other edits still allowed', r.status === 201 && r.json.member.email === 'e@example.com' && r.json.mail === null, r.json);
      r = await call('guest', 'POST', '/api/members/check', { campaign: cm.campaign, phone: '0822222222' }); check('check shows no changes left', r.json.member.date_changes_left === 0, r.json);
      { const ml = await dbx.get("SELECT COUNT(*) AS n FROM mail_log WHERE kind IN ('member_code', 'member_date_changed') AND to_email = 'd@example.com'"); check('code emails logged (sign-up + date change)', ml && ml.n === 2, ml); }
      if (CF) { const gm = graphMail.filter((m) => m.to.join() === 'd@example.com'); check('code email via Graph has the code + date', gm.length === 2 && gm.every((m) => m.html.includes(code2)) && /5 January 2027/.test(gm[1].html), gm.map((m) => m.subject)); }
      r = await call('mkt', 'GET', `/api/admin/members?campaign=${memId}&q=${code2.toLowerCase()}`); check('back-office Members: code search + change info', r.json.total === 1 && r.json.rows[0].pickup_code === code2 && r.json.rows[0].date_changes === 1 && r.json.rows[0].mail_status === 'sent', r.json);
      check('codes are unique', code1 !== code2);
      // หลังบ้านจัดการสมาชิก: แก้ไข / คืนสิทธิ์เปลี่ยนวัน / ส่งอีเมลซ้ำ / ลบ (IT-Admin, Admin; Finance ดูอย่างเดียว)
      { const rows = (await call('mkt', 'GET', `/api/admin/members?campaign=${memId}&export=1`)).json.rows; const d = rows.find((x) => x.phone === '0822222222'); const other = rows.find((x) => x.phone !== '0822222222');
        const edit = { first_name: 'D2', last_name: 'X', phone: '0822222222', email: 'd2@example.com', pickup_date: '2027-01-20', store_id: 'JF001', date_changes: 0, send_email: true };
        r = await call('fin', 'PATCH', `/api/admin/members/${d.id}`, edit); check('finance cannot edit members', r.status === 403);
        r = await call('mkt', 'PATCH', `/api/admin/members/${d.id}`, edit); check('admin edits member (date beyond customer limit, reset right, email sent, same code)', r.status === 200 && r.json.member.pickup_date === '2027-01-20' && r.json.member.date_changes === 0 && r.json.member.first_name === 'D2' && r.json.member.pickup_code === code2 && r.json.mail && r.json.mail.status === 'sent', r.json);
        r = await call('guest', 'POST', '/api/members/check', { campaign: cm.campaign, phone: '0822222222' }); check('customer can change the date again after reset', r.json.member && r.json.member.date_changes_left === 1, r.json);
        r = await call('mkt', 'PATCH', `/api/admin/members/${d.id}`, { ...edit, phone: other.phone }); check('admin edit: phone already used in campaign rejected', r.status === 409 && r.json.field === 'phone', r.json);
        r = await call('mkt', 'PATCH', `/api/admin/members/${d.id}`, { ...edit, pickup_date: '2027-03-01' }); check('admin edit: date outside range rejected', r.status === 400 && r.json.field === 'pickup_date', r.json);
        r = await call('mkt', 'POST', `/api/admin/members/${d.id}/resend`); check('admin re-sends the code email', r.status === 200 && r.json.mail.status === 'sent' && r.json.mail.to === 'd2@example.com', r.json);
        r = await call('fin', 'DELETE', `/api/admin/members/${d.id}`); check('finance cannot delete members', r.status === 403);
        r = await call('mkt', 'DELETE', `/api/admin/members/${d.id}`); check('admin deletes member', r.status === 200);
        r = await call('mkt', 'GET', `/api/admin/members?campaign=${memId}&q=0822222222`); check('deleted member gone', r.json.total === 0, r.json);
        r = await call('guest', 'POST', '/api/members/check', { campaign: cm.campaign, phone: '0822222222' }); check('deleted member can sign up again', r.json.eligible === true && r.json.member === null, r.json);
        r = await call('mkt', 'DELETE', `/api/admin/members/${d.id}`); check('delete unknown member = 404', r.status === 404); }
      r = await call('mkt', 'GET', `/api/admin/members?campaign=${memId}&q=new@mail`); check('back-office Members shows + searches email', r.json.total === 1 && r.json.rows[0].email === 'new@mail.com', r.json);
      r = await call('it', 'PUT', `/api/admin/campaigns/${memId}/design`, { home: 'order' }); check('celebrate link stays membership even if saved as order', r.status === 200 && r.json.design.home === 'membership', r.json && r.json.design);
      r = await fetch(base + '/celebrateeverymomentwithjiancha/'); check('celebrate link serves the sign-up form', r.status === 200 && /id="mb-form"/.test(await r.text()));
      r = await fetch(base + '/celebrateeverymomentwithjiancha/cart', { redirect: 'manual' }); check('celebrate link has no cart', r.status === 302);
      r = await call('it', 'PUT', '/api/admin/campaigns/jiancha-x-summer/design', { ...dz, home: 'order' }); r = await fetch(base + '/jianchaxsummer/'); check('switching back restores the order menu', r.status === 200 && /id="sets"/.test(await r.text()));
    }

    // ล้างออเดอร์ทั้งหมด (IT-Admin): ออเดอร์/สลิปหาย บัญชีลูกค้าและหลังบ้านคงอยู่
    r = await call('mkt', 'POST', '/api/admin/reset', { confirm: 'RESET' }); check('marketing cannot reset', r.status === 403);
    r = await call('it', 'POST', '/api/admin/reset', { confirm: 'nope' }); check('reset needs RESET confirmation', r.status === 400);
    r = await call('it', 'POST', '/api/admin/reset', { confirm: 'RESET' }); check('it-admin resets all orders', r.status === 200 && r.json.orders > 0 && r.json.slips > 0, r.json);
    r = await call('it', 'GET', '/api/admin/orders'); check('no orders after reset', r.json.total === 0);
    r = await call('customer', 'GET', '/api/stock'); check('quota + stock back to full after reset', r.json.remaining.total === 1000 && r.json.order_window.today_count === 0 && r.json.order_window.today_held === 0, r.json);
    r = await call('mkt', 'GET', '/api/admin/customers?campaign=all'); check('customers kept after reset', r.json.total >= 2, r.json.total);
    r = await call('it', 'GET', '/api/admin/users'); check('accounts kept after reset', r.json.length >= 3);
    if (CF) { const m = await dbx.get("SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'reset:%'"); check('scheduled reset (RESET_ORDERS_AT in the past) ran once on first request', m && m.n === 1, m); }
    r = await call('it', 'POST', '/api/admin/logout'); r = await call('it', 'GET', '/api/admin/orders'); check('logout works', r.status === 401);
    r = await fetch(base + '/backend'); check('back-office served at /backend', r.status === 200 && /JIANCHA Page/.test(await r.text()));
    r = await fetch(base + '/backend/'); check('back-office served at /backend/', r.status === 200 && /JIANCHA Page/.test(await r.text()));
    r = await fetch(base + '/admin-page?view=orders', { redirect: 'manual' }); check('old /admin-page redirects to /backend', r.status === 301 && r.headers.get('location') === '/backend?view=orders');
    r = await fetch(base + '/cart'); check('extensionless page served', r.status === 200);
    r = await fetch(base + '/'); check('root is the Membership Gift landing', r.status === 200 && /Membership Gift/.test(await r.text()));
    r = await fetch(base + '/index'); check('/index is the active campaign home', r.status === 200 && /id="sets"/.test(await r.text()));
  } finally {
    tokeninfo.close();
    if (server) server.close();
    if (!CF) for (const dir of ['uploads', 'uploads/design']) for (const f of fs.readdirSync(path.join(__dirname, '..', dir))) if (/^\d{13}-/.test(f) && Date.now() - Number(f.slice(0, 13)) < 60000) fs.unlinkSync(path.join(__dirname, '..', dir, f));
    if (!CF) try { fs.unlinkSync(process.env.DB_PATH); fs.unlinkSync(process.env.DB_PATH + '-wal'); fs.unlinkSync(process.env.DB_PATH + '-shm'); } catch (e) { /* ignore */ }
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
