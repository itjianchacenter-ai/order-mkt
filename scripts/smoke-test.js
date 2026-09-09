/* End-to-end API smoke test against a temp database. Run: npm test */
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `jc-order-test-${Date.now()}.db`);
process.env.PROMPTPAY_ID = '0812345678';
process.env.JWT_SECRET = 'test'; process.env.NODE_ENV = 'test'; process.env.SLIPOK_API_KEY = '';
process.env.GOOGLE_CLIENT_ID = 'test-client-id'; // เปิดบังคับล็อกอิน; token ตรวจกับ stub ด้านล่างแทน Google
const fs = require('fs'); const path = require('path');
const app = require('../server');
// แม่แบบ data/menu.json มีแบนเนอร์หรือไม่ (แคมเปญที่ยังไม่ตั้งค่า Design ต้องได้ค่าตามแม่แบบ)
const TEMPLATE_BANNERS = require('../data/menu.json').banner ? 1 : 0;

let base; const jars = {};
function cookieHeader(who) { return jars[who] ? { cookie: jars[who] } : {}; }
async function call(who, method, p, body, extraHeaders = {}) {
  const init = { method, headers: { ...cookieHeader(who), ...extraHeaders } };
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

(async () => {
  const server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
  // stub ของ oauth2.googleapis.com/tokeninfo: id_token = ชื่อผู้ใช้จำลอง ('bad' = ไม่ผ่าน)
  const http = require('http');
  const tokeninfo = http.createServer((req, res) => {
    const t = new URL(req.url, 'http://x').searchParams.get('id_token');
    if (!t || t === 'bad') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":"invalid_token"}'); }
    const wrongAud = t.endsWith('@wrong');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ iss: 'https://accounts.google.com', aud: wrongAud ? 'other-client' : 'test-client-id', sub: 'sub-' + t, email: t + '@gmail.com', email_verified: 'true', name: 'Test ' + t, picture: '', exp: String(Math.floor(Date.now() / 1000) + 3600) }));
  }).listen(0);
  process.env.GOOGLE_TOKENINFO_URL = `http://127.0.0.1:${tokeninfo.address().port}/tokeninfo`;
  try {
    let r = await call('customer', 'GET', '/api/menu');
    check('menu loads with sets + campaign + stock', r.status === 200 && r.json.sets.length === 2 && r.json.sets[0].label === 'SET A' && r.json.sets[0].items.length === 3 && r.json.campaign.name === 'JIANCHA x NAVORI' && r.json.stock.limits.total === 1000, r.json.sets);
    const menu = r.json; const A = menu.sets[0].id, B = menu.sets[1].id; // SET A 215 · SET B 245, each set = 1 unit of stock
    r = await call('customer', 'GET', '/api/stores'); check('stores load (6 branches incl. Emsphere)', r.status === 200 && r.json.length === 6 && r.json.some((x) => x.name === 'Emsphere'));
    const storeId = r.json[2].id;

    // ── customer: Google login required before ordering ──
    r = await call('customer', 'GET', '/api/me'); check('me: not logged in, login required', r.json.logged_in === false && r.json.login_required === true && r.json.google_client_id === 'test-client-id');
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', lines: [{ set_id: A, quantity: 1 }] }); check('order without login rejected (401)', r.status === 401 && r.json.login_required === true, r.json);
    r = await call('customer', 'POST', '/api/auth/google', { credential: 'bad' }); check('bad google token rejected', r.status === 401);
    r = await call('customer', 'POST', '/api/auth/google', { credential: 'alice@wrong' }); check('token for another client id rejected', r.status === 401);
    r = await call('customer', 'POST', '/api/auth/google', { credential: 'alice', campaign: 'jianchaxnavori' }); check('google login ok', r.status === 200 && r.json.logged_in === true && r.json.email === 'alice@gmail.com' && r.json.name === 'Test alice', r.json);
    r = await call('customer', 'GET', '/api/me'); check('me: logged in', r.json.logged_in === true && r.json.email === 'alice@gmail.com');

    // ── customer: ordering ──
    r = await call('customer', 'POST', '/api/orders', { store_id: '', phone: '0812345678', lines: [{ set_id: A, quantity: 1 }] }); check('order without store rejected', r.status === 400);
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', lines: [] }); check('order without lines rejected', r.status === 400);
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', lines: [{ set_id: 'nope', quantity: 1 }] }); check('unknown set rejected', r.status === 400);
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, lines: [{ set_id: A, quantity: 1 }] }); check('order without contact number rejected', r.status === 400 && r.json.field === 'phone', r.json);
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '12345', lines: [{ set_id: A, quantity: 1 }] }); check('order with bad contact number rejected', r.status === 400 && r.json.field === 'phone');
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, note: 'no sugar', phone: '081-234-5678', lines: [{ set_id: A, quantity: 2 }, { set_id: B, quantity: 1 }] });
    check('order created', r.status === 201 && /^\d{13}$/.test(r.json.order_number) && r.json.campaign_id === 'jiancha-x-navori', r.json);
    const order = r.json;
    check('phone kept (digits only)', r.json.phone === '0812345678', r.json.phone);
    // ล็อกอินบัญชีเดิมจากเบราว์เซอร์ใหม่ → เห็นออเดอร์เดิม; ออเดอร์ที่สั่งแบบไม่ล็อกอินก่อนหน้าย้ายมาด้วย (ทดสอบผ่านสถานะ login เพราะยังสั่งไม่ได้ก่อนล็อกอิน)
    r = await call('customer2', 'GET', '/api/orders'); check('new browser sees no orders', r.status === 200 && r.json.length === 0);
    r = await call('customer2', 'POST', '/api/auth/google', { credential: 'alice' }); check('same google account on new browser', r.json.logged_in === true);
    r = await call('customer2', 'GET', '/api/orders'); check('order history follows the google account', r.json.some((o) => o.id === order.id), r.json.map((o) => o.id));
    r = await call('customer2', 'POST', '/api/auth/logout'); check('logout', r.json.logged_in === false);
    r = await call('customer2', 'GET', '/api/orders'); check('after logout the browser has no orders', r.json.length === 0);
    r = await call('customer2', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', lines: [{ set_id: A, quantity: 1 }] }); check('after logout ordering needs login again', r.status === 401);
    check('order lines + total', order.lines.length === 2 && order.total === 2 * 215 + 245 && order.lines[0].name === 'SET A · Menu Name' && order.lines[0].items.length === 3 && order.store_name === 'JIANCHA - Central World', order);
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', lines: [{ set_id: B, quantity: 1 }] });
    check('order numbers increment', r.json.order_number === String(BigInt(order.order_number) + 1n), r.json.order_number);
    const order2 = r.json;
    r = await call('customer', 'GET', '/api/orders'); check('history lists own orders', r.status === 200 && r.json.length === 2);
    r = await call('other', 'GET', '/api/orders'); check('other browser sees nothing', r.json.length === 0);
    r = await call('other', 'GET', `/api/orders/${order.id}`); check('other browser cannot read order', r.status === 404);
    r = await call('customer', 'GET', `/api/orders/${order.id}/qr`); check('qr generated for order', r.status === 200 && /^data:image\/png/.test(r.json.qr_data_url) && r.json.amount === 675, r.json);

    // ── customer: slips ──
    r = await call('customer', 'POST', `/api/orders/${order.id}/slip`, png(1)); check('slip -> finance review queue', r.status === 200 && r.json.status === 'slip_uploaded', r.json);
    r = await call('customer', 'POST', `/api/orders/${order2.id}/slip`, png(1)); check('duplicate slip image rejected', r.status === 200 && r.json.status === 'pending' && /เคยถูกใช้/.test(r.json.reason), r.json);
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
    r = await call('customer', 'GET', `/api/orders/${order2.id}`); check('customer sees rejection + can re-pay', r.json.status === 'slip_rejected' && r.json.payable === true && r.json.slip_reason === 'ยอดไม่ตรง');
    r = await call('customer', 'GET', `/api/orders/${order2.id}/qr`); check('qr available again after rejection', r.status === 200);
    r = await call('customer', 'POST', `/api/orders/${order2.id}/slip`, png(3)); check('re-upload after rejection', r.json.status === 'slip_uploaded');
    r = await call('customer', 'POST', `/api/orders/${order.id}/code`); check('code refused before approval', r.status === 400, r.json);
    r = await call('fin', 'POST', `/api/admin/orders/${order.id}/status`, { status: 'paid' }); check('finance approves slip', r.json.status === 'paid' && r.json.paid_at);
    r = await call('customer', 'POST', `/api/orders/${order.id}/code`);
    check('promo code issued in range', r.status === 200 && /^\d{10}$/.test(r.json.promo_code) && Number(r.json.promo_code) >= 2026090001 && Number(r.json.promo_code) <= 2026092000, r.json);
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
    r = await call('it', 'POST', '/api/admin/campaigns', { name: 'JIANCHA x SUMMER', stock_total: 500, promo_from: 2026100001, promo_to: 2026100500 }); check('campaign created inactive', r.status === 201 && r.json.id === 'jiancha-x-summer' && r.json.active === false && r.json.stock.total === 500);
    const camp2 = r.json;
    r = await call('it', 'POST', '/api/admin/campaigns', { name: 'JIANCHA x SUMMER', promo_from: 5, promo_to: 1 }); check('bad promo range rejected', r.status === 400);
    r = await call('it', 'PATCH', `/api/admin/campaigns/${camp2.id}`, { active: true }); check('campaign activated', r.json.active === true);
    r = await call('customer', 'GET', '/api/menu'); check('customer site follows active campaign', r.json.campaign.id === camp2.id && r.json.stock.limits.total === 500 && r.json.stock.used.total === 0);
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', lines: [{ set_id: A, quantity: 1 }] }); check('order lands in new campaign', r.json.campaign_id === camp2.id);
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
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', lines: [{ set_id: 'C', quantity: 1 }] }); check('order a designed set (2 pieces)', r.status === 201 && r.json.total === 99 && r.json.lines[0].pieces === 2 && r.json.lines[0].name === 'SET C · Third', r.json);
    const orderC = r.json;
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', lines: [{ set_id: 'Z', quantity: 1 }] }); check('unknown set rejected', r.status === 400);
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
    r = await call('mkt', 'GET', '/api/admin/customers?campaign=all'); check('all campaigns lists her once', r.json.total === 1 && r.json.campaign === null);
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
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', campaign: 'jianchaxsummer', lines: [{ set_id: A, quantity: 1 }] }); check('order into a campaign by slug', r.status === 201 && r.json.campaign_id === 'jiancha-x-summer', r.json);
    r = await call('fin', 'POST', `/api/admin/orders/${r.json.id}/status`, { status: 'cancelled' });
    r = await call('it', 'PATCH', '/api/admin/campaigns/jiancha-x-summer', { slug: 'jianchaxnavori' }); check('duplicate slug rejected', r.status === 409);
    r = await call('it', 'PATCH', '/api/admin/campaigns/jiancha-x-summer', { slug: 'Summer 2026!', orders_open: false }); check('slug normalized + orders closed', r.status === 200 && r.json.slug === 'summer2026' && r.json.orders_open === false, r.json);
    r = await fetch(base + '/summer2026/'); check('renamed campaign page served', r.status === 200);
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', campaign: 'summer2026', lines: [{ set_id: A, quantity: 1 }] }); check('closed campaign refuses orders', r.status === 400 && /ปิดรับ/.test(r.json.error));
    r = await call('customer', 'GET', '/api/menu?campaign=summer2026'); check('closed flag visible to customers', r.json.campaign.orders_open === false);
    r = await call('it', 'POST', '/api/admin/campaigns', { name: 'JIANCHA x SUMMER', slug: 'x' }); check('too-short slug rejected', r.status === 400);

    // ── stock (campaign jiancha-x-navori: 1000 sets; 4 used above: A×2 + B×1 + B×1) ──
    r = await call('customer', 'GET', '/api/stock'); check('stock view', r.json.limits.total === 1000 && r.json.used.total === 4 && r.json.remaining.total === 996 && r.json.used.drink === 4 && r.json.used.dessert === 8, r.json);
    const big = (n) => Array.from({ length: n }, () => ({ set_id: A, quantity: 99 }));
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', lines: big(11) }); check('order above stock rejected', r.status === 409 && /เหลือเพียง 996/.test(r.json.error), r.json);
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', lines: big(10) }); check('order within stock accepted', r.status === 201, r.json);
    const bigOrder = r.json;
    r = await call('customer', 'GET', '/api/stock'); check('stock reserved by pending order', r.json.remaining.total === 6, r.json);
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', lines: [{ set_id: B, quantity: 7 }] }); check('7 sets vs 6 left rejected', r.status === 409, r.json);
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', lines: [{ set_id: B, quantity: 6 }] }); check('last 6 sets accepted', r.status === 201, r.json);
    r = await call('customer', 'GET', '/api/menu'); check('menu reports sold out', r.json.stock.sold_out === true && r.json.stock.remaining.total === 0, r.json.stock);
    r = await call('customer', 'POST', '/api/orders', { store_id: storeId, phone: '0812345678', lines: [{ set_id: A, quantity: 1 }] }); check('sold out rejected', r.status === 409 && /หมดแล้ว/.test(r.json.error), r.json);
    r = await call('it', 'POST', `/api/admin/orders/${bigOrder.id}/status`, { status: 'paid' });
    r = await call('it', 'POST', `/api/orders/${bigOrder.id}/code`); check('it-admin can issue code, unique', r.status === 200 && r.json.promo_code !== code1, r.json);
    r = await call('fin', 'POST', `/api/admin/orders/${bigOrder.id}/status`, { status: 'cancelled' }); check('finance cancels big order', r.json.status === 'cancelled');
    r = await call('customer', 'GET', '/api/stock'); check('cancelled order frees stock', r.json.remaining.total === 990, r.json);
    r = await call('it', 'GET', '/api/admin/summary?campaign=jiancha-x-navori'); check('summary per campaign', r.status === 200 && r.json.stock.remaining.total === 990);

    // ── ออเดอร์แยกตามบัญชี Google + หลังบ้านเห็นอีเมล/เบอร์ + บัญชีที่เตรียมไว้ล่วงหน้าด้วยอีเมล ──
    {
      const { db } = require('../db');
      const placeholderId = 'pre-' + Date.now();
      db.prepare('INSERT INTO customers(id, email, name) VALUES (?, ?, ?)').run(placeholderId, 'wendy@gmail.com', 'wendy');
      db.prepare('UPDATE orders SET customer_id = ? WHERE id = ?').run(placeholderId, order2.id);
      r = await call('customer', 'GET', '/api/orders'); check('order moved to the pre-assigned account leaves alice history', !r.json.some((o) => o.id === order2.id));
      r = await call('it', 'GET', `/api/admin/orders/${order2.id}`); check('back-office shows google account email + contact number for the order', r.json.customer_email === 'wendy@gmail.com' && r.json.phone === '0812345678', r.json);
      r = await call('it', 'GET', '/api/admin/orders?q=wendy@gmail'); check('back-office search by google email', r.json.rows.some((o) => o.id === order2.id) && r.json.rows.every((o) => o.customer_email === 'wendy@gmail.com'), r.json.total);
      r = await call('it', 'GET', '/api/admin/orders?q=0812345678'); check('back-office search by contact number', r.json.rows.some((o) => o.id === order2.id));
      r = await call('wendy', 'GET', '/api/orders'); check('not signed in = no order history', r.json.length === 0);
      r = await call('wendy', 'POST', '/api/auth/google', { credential: 'wendy' }); check('pre-assigned email claims its account on first google login', r.json.logged_in === true && r.json.email === 'wendy@gmail.com');
      r = await call('wendy', 'GET', '/api/orders'); check('claimed account sees the pre-assigned order', r.json.length === 1 && r.json[0].id === order2.id, r.json.map((o) => o.id));
      check('placeholder row became the google account (no duplicate customer)', db.prepare('SELECT COUNT(*) AS n FROM customers WHERE email = ?').get('wendy@gmail.com').n === 1 && db.prepare('SELECT google_sub FROM customers WHERE id = ?').get(placeholderId).google_sub === 'sub-wendy');
      // db.js migration: ออเดอร์เดิมที่ไม่ผูกบัญชี Google → บัญชีเจ้าของ (LEGACY_ORDERS_OWNER) ทำครั้งเดียว
      const { execFileSync } = require('child_process'); const mdb = process.env.DB_PATH + '-legacy.db';
      const runDb = (js) => execFileSync(process.execPath, ['-e', `const { db } = require(${JSON.stringify(path.join(__dirname, '..', 'db.js'))}); ${js}`], { env: { ...process.env, DB_PATH: mdb, LEGACY_ORDERS_OWNER: 'owner@gmail.com' }, encoding: 'utf8' }).trim();
      runDb(`db.exec("DELETE FROM meta WHERE key = 'legacy_orders_owner'; INSERT INTO customers(id) VALUES ('anon1'),('anon2'); INSERT INTO customers(id, google_sub, email) VALUES ('g1','sub-g1','g1@gmail.com'); INSERT INTO orders(id, order_number, customer_id, campaign_id, store_id, store_name, total) VALUES ('o1','1',  'anon1','jiancha-x-navori','s','S',1),('o2','2','anon2','jiancha-x-navori','s','S',1),('o3','3','g1','jiancha-x-navori','s','S',1)")`);
      const out = runDb(`const o = db.prepare("SELECT id FROM customers WHERE email = 'owner@gmail.com' AND google_sub IS NULL").get(); console.log(JSON.stringify({ owner: Boolean(o), moved: o ? db.prepare('SELECT group_concat(id) AS ids FROM (SELECT id FROM orders WHERE customer_id = ? ORDER BY id)').get(o.id).ids : '', g1: db.prepare("SELECT customer_id FROM orders WHERE id = 'o3'").get().customer_id, flag: db.prepare("SELECT value FROM meta WHERE key = 'legacy_orders_owner'").get().value, camp: o ? db.prepare('SELECT COUNT(*) AS n FROM customer_campaigns WHERE customer_id = ?').get(o.id).n : 0 }))`);
      const mig = JSON.parse(out);
      check('legacy migration: orders without google account move to the owner email (once), google-owned orders stay', mig.owner && mig.moved === 'o1,o2' && mig.g1 === 'g1' && mig.flag === 'owner@gmail.com' && mig.camp === 1, mig);
      for (const suf of ['', '-wal', '-shm']) { try { fs.unlinkSync(mdb + suf); } catch (e) { /* ignore */ } }
    }

    r = await call('it', 'POST', '/api/admin/logout'); r = await call('it', 'GET', '/api/admin/orders'); check('logout works', r.status === 401);
    r = await fetch(base + '/backend'); check('back-office served at /backend', r.status === 200 && /JIANCHA Page/.test(await r.text()));
    r = await fetch(base + '/backend/'); check('back-office served at /backend/', r.status === 200 && /JIANCHA Page/.test(await r.text()));
    r = await fetch(base + '/admin-page?view=orders', { redirect: 'manual' }); check('old /admin-page redirects to /backend', r.status === 301 && r.headers.get('location') === '/backend?view=orders');
    r = await fetch(base + '/cart'); check('extensionless page served', r.status === 200);
    r = await fetch(base + '/'); check('root is the Order with us landing', r.status === 200 && /Order with us/.test(await r.text()));
    r = await fetch(base + '/index'); check('/index is the active campaign home', r.status === 200 && /id="sets"/.test(await r.text()));
  } finally {
    server.close();
    for (const dir of ['uploads', 'uploads/design']) for (const f of fs.readdirSync(path.join(__dirname, '..', dir))) if (/^\d{13}-/.test(f) && Date.now() - Number(f.slice(0, 13)) < 60000) fs.unlinkSync(path.join(__dirname, '..', dir, f));
    try { fs.unlinkSync(process.env.DB_PATH); fs.unlinkSync(process.env.DB_PATH + '-wal'); fs.unlinkSync(process.env.DB_PATH + '-shm'); } catch (e) { /* ignore */ }
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
