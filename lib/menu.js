/* Pure helpers shared by server.js (Node) and worker/ (Cloudflare): menu template, campaign design, stores.
   No I/O here: callers pass the parsed data/menu.json and data/stores.json. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const normItem = (x) => ({ id: String(x.id), name_en: x.name_en || '', name_th: x.name_th || '', price: Number(x.price) || 0, image: x.image || '', active: x.active !== false });
// A Match Set is what the customer orders: one card with a price, up to 3 thumbnails and the items inside it.
function normSet(x) {
  const items = (x.items || []).map((i) => ({ name_en: i.name_en || '', name_th: i.name_th || '', kind: i.kind === 'drink' ? 'drink' : (i.kind === 'dessert' ? 'dessert' : '') }));
  const pieces = Number.isInteger(Number(x.pieces)) && Number(x.pieces) > 0 ? Number(x.pieces) : 1;
  return { ...normItem(x), label: x.label || `SET ${String(x.id)}`, images: Array.isArray(x.images) ? x.images.slice(0, 3).map((u) => u || '') : [], items, pieces,
    drink_pieces: items.filter((i) => i.kind === 'drink').length, dessert_pieces: items.filter((i) => i.kind === 'dessert').length };
}
/** รอบสั่ง → รอบรับ: { 'YYYY-MM-DD (วันสั่ง)': 'YYYY-MM-DD (วันรับ)' } วันสั่งไหนไม่อยู่ในตาราง = เลือกวันรับได้ตามรายการปกติ */
function normPickupMap(src) {
  const out = {}; if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  for (const [k, v] of Object.entries(src).slice(0, 62)) { const a = String(k || '').trim(), b = String(v || '').trim(); if (ISO_DAY.test(a) && ISO_DAY.test(b)) out[a] = b; }
  return out;
}
/** data/menu.json → normalized template (sets, drinks, desserts, pick-up dates/times, order window) */
function normalizeMenu(m) {
  m = m && typeof m === 'object' ? m : {};
  const pickup_dates = (Array.isArray(m.pickup_dates) ? m.pickup_dates : []).map((x) => String(x || '').trim()).filter((x) => ISO_DAY.test(x));
  const pickup_times = (Array.isArray(m.pickup_times) ? m.pickup_times : []).map((x) => String(x || '').trim().slice(0, 40)).filter(Boolean);
  // ช่วงวันที่เปิดรับออเดอร์ + โควตาออเดอร์ต่อวัน (ว่าง/null = ไม่จำกัด)
  const order_days = (Array.isArray(m.order_days) ? m.order_days : []).map((x) => String(x || '').trim()).filter((x) => ISO_DAY.test(x)).sort();
  const orders_per_day = Number.isInteger(Number(m.orders_per_day)) && Number(m.orders_per_day) > 0 ? Number(m.orders_per_day) : null;
  return { banner: m.banner || '', sets: (m.sets || []).map(normSet).filter((x) => x.active), drinks: (m.drinks || []).map(normItem).filter((x) => x.active), desserts: (m.desserts || []).map(normItem).filter((x) => x.active),
    pickup_dates, pickup_times, order_days, orders_per_day, pickup_map: normPickupMap(m.pickup_map),
    stock: { total: (m.stock || {}).total ?? 1000, drink: (m.stock || {}).drink ?? null, dessert: (m.stock || {}).dessert ?? null }, promo_code: { prefix: promoPrefix((m.promo_code || {}).prefix), from: (m.promo_code || {}).from, to: (m.promo_code || {}).to } };
}
function normalizeStores(list) {
  return (Array.isArray(list) ? list : []).filter((s) => s.active !== false).map((s) => ({ id: String(s.id), brand: s.brand || 'JIANCHA', name: s.name || '', map_url: s.map_url || '' }));
}

// ─── Campaign design: promote images + Match Sets shown on the customer homepage ───
// Stored per campaign (campaigns.design_json). A campaign without a saved design uses data/menu.json as its template.
const isImageUrl = (u) => typeof u === 'string' && u.length <= 2000 && (/^\/uploads\/design\/[A-Za-z0-9._-]+$/.test(u) || /^\/img\//.test(u) || /^https?:\/\//.test(u) || /^data:image\//.test(u));
const imgOr = (u) => (isImageUrl(u) ? u : '');
function normalizeDesign(d) {
  const src = d && typeof d === 'object' ? d : {};
  const promote_images = (Array.isArray(src.promote_images) ? src.promote_images : []).filter(isImageUrl).slice(0, 10);
  const seen = new Set(); const sets = [];
  for (const x of (Array.isArray(src.sets) ? src.sets : []).slice(0, 12)) {
    if (!x || typeof x !== 'object') continue;
    let id = String(x.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
    if (!id || seen.has(id)) { let n = 1; do { id = 'S' + n++; } while (seen.has(id)); }
    seen.add(id);
    const items = (Array.isArray(x.items) ? x.items : []).slice(0, 8).map((i) => ({ name_en: String((i && i.name_en) || '').slice(0, 80), name_th: String((i && i.name_th) || '').slice(0, 80), kind: i && i.kind === 'drink' ? 'drink' : (i && i.kind === 'dessert' ? 'dessert' : '') })).filter((i) => i.name_en || i.name_th);
    const pieces = Number.isInteger(Number(x.pieces)) && Number(x.pieces) > 0 ? Number(x.pieces) : 1;
    const price = Number.isFinite(Number(x.price)) && Number(x.price) >= 0 ? Math.round(Number(x.price) * 100) / 100 : 0;
    sets.push({ id, label: String(x.label || `SET ${id}`).slice(0, 20), name_en: String(x.name_en || '').slice(0, 80), name_th: String(x.name_th || '').slice(0, 80), price, image: imgOr(x.image),
      images: [0, 1, 2].map((k) => imgOr((x.images || [])[k])), items, pieces, active: x.active !== false,
      drink_pieces: items.filter((i) => i.kind === 'drink').length, dessert_pieces: items.filter((i) => i.kind === 'dessert').length });
  }
  // pickup_dates: วันที่รับของให้ลูกค้าเลือก (YYYY-MM-DD) ว่าง = ใช้ของ template (data/menu.json)
  const pickup_dates = [...new Set((Array.isArray(src.pickup_dates) ? src.pickup_dates : []).map((x) => String(x || '').trim()).filter((x) => ISO_DAY.test(x)))].sort().slice(0, 31);
  // pickup_times: ช่วงเวลารับของ (ข้อความ) ว่าง = ใช้ของ template
  const pickup_times = [...new Set((Array.isArray(src.pickup_times) ? src.pickup_times : []).map((x) => String(x || '').trim().slice(0, 40)).filter(Boolean))].slice(0, 24);
  // order_days / orders_per_day: วันที่เปิดรับออเดอร์และโควตาต่อวันของแคมเปญ (ว่าง = ใช้ของ template)
  const order_days = [...new Set((Array.isArray(src.order_days) ? src.order_days : []).map((x) => String(x || '').trim()).filter((x) => ISO_DAY.test(x)))].sort().slice(0, 62);
  const orders_per_day = Number.isInteger(Number(src.orders_per_day)) && Number(src.orders_per_day) > 0 ? Number(src.orders_per_day) : null;
  // pickup_map: รอบสั่ง → รอบรับ ของแคมเปญ (ว่าง = ใช้ของ template)
  const pickup_map = normPickupMap(src.pickup_map);
  // home: หน้าแรกของแคมเปญ (/<slug>/) — 'order' = เมนูสั่งซื้อ (ค่าเริ่มต้น), 'membership' = ฟอร์มสมัครสมาชิก (ชื่อ/เบอร์/เวลา/สาขา)
  const home = src.home === 'membership' ? 'membership' : 'order';
  return { promote_images, sets, pickup_dates, pickup_times, order_days, orders_per_day, pickup_map, home };
}
/** Design of a campaign that has none saved: the menu.json template. */
function defaultDesign(menu) { return normalizeDesign({ promote_images: menu.banner ? [menu.banner] : [], sets: menu.sets, pickup_dates: menu.pickup_dates, pickup_times: menu.pickup_times, order_days: menu.order_days, orders_per_day: menu.orders_per_day, pickup_map: menu.pickup_map }); }
function campaignDesign(c, menu) {
  let d = null;
  if (c && c.design_json) { try { d = normalizeDesign(JSON.parse(c.design_json)); } catch (e) { /* fall through */ } }
  if (!d) d = defaultDesign(menu);
  // ลิงก์ที่เป็นเว็บกรอกสมาชิกเสมอ (ไม่มีการสั่งซื้อ) ไม่ว่าจะบันทึก Design แบบไหน
  if (c && MEMBERSHIP_HOME_SLUGS.includes(c.slug)) d.home = 'membership';
  return d;
}
/** What the customer site sells for a campaign: its design's active sets and promote images (template fills the gaps). */
function menuFor(c, m) {
  const d = campaignDesign(c, m);
  return { banner: d.promote_images[0] || '', banners: d.promote_images, sets: d.sets.filter((x) => x.active), drinks: m.drinks, desserts: m.desserts,
    pickup_dates: d.pickup_dates.length ? d.pickup_dates : (Array.isArray(m.pickup_dates) ? m.pickup_dates : []), pickup_times: d.pickup_times.length ? d.pickup_times : (Array.isArray(m.pickup_times) ? m.pickup_times : []),
    order_days: d.order_days.length ? d.order_days : m.order_days, orders_per_day: d.orders_per_day || m.orders_per_day, pickup_map: Object.keys(d.pickup_map).length ? d.pickup_map : m.pickup_map, home: d.home };
}
/** ฟอร์มสมัครสมาชิก (หน้าแรกแบบ membership): ตรวจข้อมูล → { first_name, last_name, phone, email, pickup_date, store } หรือ { error, field }
 *  วันที่รับของ = memberPickupDates(), stores = normalizeStores(member-stores) */
/** แคมเปญที่เป็นหน้าสมัครสมาชิกเสมอ (campaignDesign บังคับ home = 'membership'; หน้า Design เปลี่ยนเป็น Order ไม่ได้) */
const MEMBERSHIP_HOME_SLUGS = ['celebrateeverymomentwithjiancha'];
/** design_json (string|null) → design_json ใหม่ที่ home = 'membership' (คงรูป/เซ็ตเดิมไว้ ถ้าเปลี่ยนกลับเป็น Order ได้ของเดิม) */
function membershipDesignJson(designJson) {
  let d = {}; try { d = designJson ? JSON.parse(designJson) : {}; } catch (e) { d = {}; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
  return JSON.stringify({ ...d, home: 'membership' });
}
const MEMBERSHIP_NO_ORDER = 'ลิงก์นี้เป็นหน้าสมัครสมาชิก ไม่เปิดสั่งซื้อ / This page is for membership sign-up only';
/* ─── รายชื่อสมาชิก ELITE (อัปโหลดจากไฟล์ member-ELITE-*.xlsx ที่หลังบ้าน → Customer → ELITE list) ───
   หน้าสมัครสมาชิกรับเฉพาะเบอร์ที่อยู่ในรายชื่อนี้ (แคมเปญใน MEMBERSHIP_HOME_SLUGS บังคับเสมอ; แคมเปญ Membership อื่นบังคับเมื่อมีรายชื่อ) */
const NOT_ELITE_MESSAGE = 'ขออภัยค่ะ คุณลูกค้ายังไม่เป็นสมาชิกระดับ elite กรุณาสะสมยอดเพิ่มเพื่อเลื่อนระดับ หรือติดต่อเจ้าหน้าที่ได้ที่ Line OA @jiancha';
/** เบอร์มือถือไทยทุกรูปแบบ ('(66) 812345678', '+66 81-234-5678', '081 234 5678', '812345678') → '0812345678'; ไม่ใช่เบอร์ = '' */
function normPhoneTH(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.startsWith('66') && d.length === 11) d = '0' + d.slice(2);
  else if (d.length === 9 && /^[689]/.test(d)) d = '0' + d;
  return /^0\d{9}$/.test(d) ? d : '';
}
/** แถวที่อัปโหลด [{ phone, name, tier, email, data }] → แถวที่บันทึกได้ (เบอร์ไม่ซ้ำ) + จำนวนแถวที่ข้ามเพราะเบอร์ไม่ถูกต้อง */
function readMemberListRows(rows) {
  if (!Array.isArray(rows)) return { error: 'ไม่มีรายชื่อ / No rows' };
  if (rows.length > 50000) return { error: 'รายชื่อเกิน 50,000 แถว / Too many rows' };
  const seen = new Map(); let skipped = 0;
  for (const r of rows) {
    const phone = normPhoneTH(r && r.phone); if (!phone) { skipped++; continue; }
    const s = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
    const data = {}; if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) for (const [k, v] of Object.entries(r.data).slice(0, 40)) { const kk = s(k, 60); if (kk) data[kk] = s(v, 200); }
    seen.set(phone, { phone, name: s(r.name, 120), tier: s(r.tier, 40), email: s(r.email, 160).toLowerCase(), data_json: JSON.stringify(data) });
  }
  return { rows: [...seen.values()], skipped };
}
/** วันที่รับของให้เลือกที่หน้าสมัครสมาชิก (Pick-up Date): 25 ธ.ค. 2026 – 31 ม.ค. 2027 ทุกวัน */
const MEMBER_PICKUP_FROM = '2026-12-25', MEMBER_PICKUP_TO = '2027-01-31';
function memberPickupDates(from = MEMBER_PICKUP_FROM, to = MEMBER_PICKUP_TO) {
  const out = []; const d = new Date(from + 'T00:00:00Z'); const end = new Date(to + 'T00:00:00Z');
  while (d <= end && out.length < 400) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
/** รหัสรับของของสมาชิก: จากช่วงรหัสโปรโมชันของแคมเปญ (prefix + เลข เช่น JCMB0001–JCMB2000) แบบสุ่มเลขที่ยังไม่ถูกใช้
 *  used = Set ของรหัสที่ออกแล้วในแคมเปญ, randInt(n) = สุ่ม 0..n-1 (แหล่งสุ่มที่ปลอดภัยของแต่ละ platform) → รหัส หรือ null เมื่อครบช่วง */
function memberPickupCode(camp, used, randInt) {
  const from = Number(camp.promo_from), to = Number(camp.promo_to); const size = to - from + 1;
  if (!(size > 0) || used.size >= size) return null;
  for (let i = 0; i < 50; i++) { const c = formatPromoCode(camp, from + randInt(size)); if (!used.has(c)) return c; }
  const start = randInt(size);   // เหลือน้อย: ไล่หาเลขว่างจากจุดสุ่ม
  for (let k = 0; k < size; k++) { const c = formatPromoCode(camp, from + ((start + k) % size)); if (!used.has(c)) return c; }
  return null;
}
const CODES_FULL_MESSAGE = 'ขออภัยค่ะ สิทธิ์สมาชิกเต็มแล้ว กรุณาติดต่อ Line OA @jiancha / All membership codes have been given out';
/** สมาชิกเปลี่ยนวันที่รับของได้กี่ครั้งหลังสมัคร */
const MEMBER_DATE_CHANGES = 1;
const DATE_LOCKED_MESSAGE = 'เปลี่ยนวันที่รับของได้ 1 ครั้งเท่านั้น และคุณใช้สิทธิ์ไปแล้ว / The pick-up date can only be changed once';
/** แถว members เดิม (หรือ null) + วันที่ใหม่ → { error } หรือ { date_changes, first_pickup_date } ที่จะบันทึก */
function memberDateChange(prev, pickup_date) {
  const used = (prev && Number(prev.date_changes)) || 0;
  const first = (prev && (prev.first_pickup_date || prev.pickup_date)) || pickup_date;
  if (prev && prev.pickup_date && prev.pickup_date !== pickup_date) {
    if (used >= MEMBER_DATE_CHANGES) return { error: DATE_LOCKED_MESSAGE, field: 'pickup_date', date_locked: true, pickup_date: prev.pickup_date };
    return { date_changes: used + 1, first_pickup_date: first };
  }
  return { date_changes: used, first_pickup_date: first };
}
const dateChangesLeft = (m) => Math.max(0, MEMBER_DATE_CHANGES - ((m && Number(m.date_changes)) || 0));
/** อีเมลจากรายชื่อ ELITE แบบปิดบางส่วน (le***@hotmail.com) — เติมให้ลูกค้าอัตโนมัติโดยไม่เปิดเผยอีเมลเต็มให้คนที่ลองสุ่มเบอร์ */
function maskEmail(e) {
  const m = String(e || '').trim().toLowerCase().match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/); if (!m) return '';
  return `${m[1].slice(0, m[1].length > 2 ? 2 : 1)}***@${m[2]}`;
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** หลังบ้านแก้ข้อมูลสมาชิก: ช่องเดียวกับหน้าสมัคร (ไม่ตรวจรายชื่อ ELITE / ไม่จำกัดการเปลี่ยนวัน) + date_changes (สิทธิ์เปลี่ยนวันที่ใช้ไปแล้ว 0..1) */
function readAdminMemberBody(b, stores) {
  b = b && typeof b === 'object' ? b : {};
  const v = readMemberBody({ ...b, use_list_email: false }, null, stores); if (v.error) return v;
  const dcRaw = b.date_changes; const date_changes = dcRaw === undefined || dcRaw === null || dcRaw === '' ? null : Number(dcRaw);
  if (date_changes !== null && !(Number.isInteger(date_changes) && date_changes >= 0 && date_changes <= MEMBER_DATE_CHANGES)) return { error: 'สิทธิ์เปลี่ยนวันไม่ถูกต้อง', field: 'date_changes' };
  return { ...v, date_changes, send_email: b.send_email === true };
}
/** แคมเปญนี้ต้องตรวจเบอร์กับรายชื่อ ELITE ไหม (listCount = จำนวนเบอร์ในรายชื่อตอนนี้) */
const memberListRequired = (camp, listCount) => Boolean(camp && (MEMBERSHIP_HOME_SLUGS.includes(camp.slug) || listCount > 0));
function readMemberBody(b, menu, stores) {
  b = b && typeof b === 'object' ? b : {};
  const clean = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const first_name = clean(b.first_name, 80), last_name = clean(b.last_name, 80);
  if (!first_name) return { error: 'กรุณาใส่ชื่อ / Please enter your first name', field: 'first_name' };
  if (!last_name) return { error: 'กรุณาใส่นามสกุล / Please enter your last name', field: 'last_name' };
  const phone = normPhoneTH(b.phone);
  if (!phone) return { error: 'กรุณาใส่เบอร์โทรศัพท์มือถือ 10 หลัก / Please enter a valid phone number', field: 'phone' };
  const pickup_date = clean(b.pickup_date, 10);
  if (!memberPickupDates().includes(pickup_date)) return { error: 'กรุณาเลือกวันที่รับของ / Please choose a pick-up date', field: 'pickup_date' };
  const store = (stores || []).find((s) => s.id === String(b.store_id || ''));
  if (!store) return { error: 'กรุณาเลือกสถานที่ / Please choose a location', field: 'store_id' };
  // อีเมล (ไม่บังคับ): use_list_email = ลูกค้าใช้อีเมลที่ระบบเติมให้จากรายชื่อ ELITE (ไม่ได้แก้)
  const use_list_email = b.use_list_email === true;
  const email = use_list_email ? '' : String(b.email || '').trim().toLowerCase().slice(0, 160);
  // อีเมลจำเป็น: ใช้ส่งรหัสรับของ (use_list_email = ใช้อีเมลจากรายชื่อ ELITE; ผู้เรียกตรวจว่ามีอีเมลในรายชื่อ)
  if (!use_list_email && !email) return { error: 'กรุณาใส่อีเมล เพื่อรับรหัสรับของ / Please enter your email to receive your pick-up code', field: 'email' };
  if (email && !EMAIL_RE.test(email)) return { error: 'กรุณาใส่อีเมลให้ถูกต้อง / Please enter a valid email', field: 'email' };
  return { first_name, last_name, phone, email, use_list_email, pickup_date, store };
}
/** เปลี่ยนชื่อรายการในเซ็ตของ design ที่บันทึกไว้ (migration ครั้งเดียว): คืน design ใหม่ หรือ null ถ้าไม่มีอะไรเปลี่ยน */
const ITEM_RENAMES = [
  [{ name_en: 'Mooncake', name_th: 'เผือกโมจิ' }, { name_en: 'Taro Mochi Mooncake', name_th: 'ขนมไหว้พระจันทร์ ไส้เผือกโมจิ' }],
  [{ name_en: 'Snowy Mooncake', name_th: 'ถั่วทองล้วน' }, { name_en: 'Golden Mung Snow Mooncake', name_th: 'ขนมบัวหิมะไส้ถั่วทอง' }],
];
const SET_RENAMES = [['Mooncake Set with Pomegranate Iced Tea', 'MOONLIT RUBY FRESH SET'], ['Mooncake Set with Pomegranate Tea Smoothie', 'MOONLIT RUBY SMOOTHIE SET']];
function renameDesignItems(designJson) {
  let d; try { d = JSON.parse(designJson); } catch (e) { return null; }
  if (!d || !Array.isArray(d.sets)) return null;
  let changed = false;
  for (const set of d.sets) {
    if (!set || !Array.isArray(set.items)) continue;
    for (const [from, to] of SET_RENAMES) { if (set.name_en === from) { set.name_en = to; changed = true; } }
    for (const it of set.items) { for (const [from, to] of ITEM_RENAMES) { if (it && it.name_en === from.name_en && it.name_th === from.name_th) { Object.assign(it, to); changed = true; } } }
    // ลำดับใหม่: ขนมบัวหิมะ → เผือกโมจิ → เครื่องดื่ม (ตามแบบ)
    const idx = set.items.findIndex((it) => it && it.name_en === 'Golden Mung Snow Mooncake'); const taro = set.items.findIndex((it) => it && it.name_en === 'Taro Mochi Mooncake');
    if (idx > taro && taro >= 0) { const [g] = set.items.splice(idx, 1); set.items.splice(taro, 0, g); changed = true; }
  }
  return changed ? JSON.stringify(d) : null;
}
const slugOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'campaign';
/** รหัสโปรโมชัน POS: prefix (ตัวอักษร/ตัวเลข ไม่เกิน 12) + เลขลำดับเติมศูนย์ให้ยาวเท่ากับเลขสุดท้ายของช่วง เช่น NVR26 + 1..2000 → NVR260001..NVR262000; ไม่มี prefix = เลขล้วน (แบบเดิม) */
const promoPrefix = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
function formatPromoCode(camp, n) { const prefix = promoPrefix(camp.promo_prefix); return prefix ? prefix + String(n).padStart(String(camp.promo_to).length, '0') : String(n); }
/** รหัสถัดไปแบบเรียงลำดับ: เลขสูงสุดที่เคยออกในแคมเปญ + 1 (เลขที่ออกแล้วไม่ถูกใช้ซ้ำแม้ออเดอร์ถูกยกเลิก) → null เมื่อครบช่วง */
function nextPromoNumber(usedCodes, camp) {
  const prefix = promoPrefix(camp.promo_prefix); let max = camp.promo_from - 1;
  for (const code of usedCodes) {
    const s = String(code || ''); if (prefix && !s.startsWith(prefix)) continue;
    const n = parseInt(prefix ? s.slice(prefix.length) : s, 10); if (Number.isInteger(n) && n > max) max = n;
  }
  const next = Math.max(camp.promo_from, max + 1);
  return next <= camp.promo_to ? next : null;
}
function promoRangeView(camp) { return { prefix: promoPrefix(camp.promo_prefix), from: camp.promo_from, to: camp.promo_to, first: formatPromoCode(camp, camp.promo_from), last: formatPromoCode(camp, camp.promo_to), count: camp.promo_to - camp.promo_from + 1 }; }
const lim = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : null));
/** Campaign create/update body → validated fields (or { error }) */
function readCampaignBody(b, base = {}) {
  const promo_from = b.promo_from == null ? base.promo_from : parseInt(b.promo_from, 10);
  const promo_to = b.promo_to == null ? base.promo_to : parseInt(b.promo_to, 10);
  if (!Number.isInteger(promo_from) || !Number.isInteger(promo_to) || promo_from > promo_to || promo_from < 0) return { error: 'ช่วงรหัสโปรโมชันไม่ถูกต้อง' };
  return {
    name: String(b.name ?? base.name ?? '').trim().slice(0, 80),
    slug: slugOf('slug' in b && b.slug !== '' ? b.slug : (b.name != null && !base.slug ? b.name : base.slug)),
    orders_open: 'orders_open' in b ? (b.orders_open ? 1 : 0) : (base.orders_open == null ? 1 : base.orders_open),
    stock_total: 'stock_total' in b ? lim(b.stock_total) : base.stock_total ?? null,
    stock_drink: 'stock_drink' in b ? lim(b.stock_drink) : base.stock_drink ?? null,
    stock_dessert: 'stock_dessert' in b ? lim(b.stock_dessert) : base.stock_dessert ?? null,
    promo_from, promo_to, promo_prefix: promoPrefix('promo_prefix' in b ? b.promo_prefix : base.promo_prefix),
  };
}
/** Validate an order body's lines against a campaign menu → { rows, want, total } or { error } */
function buildOrderRows(lines, menu) {
  const money = (n) => Math.round(Number(n) * 100) / 100;
  const drinks = Object.fromEntries(menu.drinks.map((d) => [d.id, d]));
  const desserts = Object.fromEntries(menu.desserts.map((d) => [d.id, d]));
  const sets = Object.fromEntries(menu.sets.map((s) => [s.id, s]));
  const rows = [];
  for (const l of lines) {
    const qty0 = parseInt(l.quantity, 10);
    if (l.set_id) {
      const set = sets[String(l.set_id)];
      if (!set) return { error: 'มีเซ็ตที่ไม่มีให้บริการแล้ว กรุณาเลือกใหม่' };
      if (!Number.isInteger(qty0) || qty0 < 1 || qty0 > 99) return { error: 'รายการสินค้าไม่ถูกต้อง' };
      rows.push({ set_id: set.id, set_label: set.label, set_name: set.name_en, items_json: JSON.stringify(set.items), pieces: set.pieces, drink_pieces: set.drink_pieces, dessert_pieces: set.dessert_pieces,
        drink_id: '', drink_name: '', dessert_id: '', dessert_name: '', quantity: qty0, unit_price: money(set.price), line_total: money(set.price * qty0) });
      continue;
    }
    const drink = l.drink_id ? drinks[String(l.drink_id)] : null;
    const dessert = l.dessert_id ? desserts[String(l.dessert_id)] : null;
    const qty = parseInt(l.quantity, 10);
    if ((!drink && !dessert) || !Number.isInteger(qty) || qty < 1 || qty > 99) return { error: 'รายการสินค้าไม่ถูกต้อง' };
    if ((l.drink_id && !drink) || (l.dessert_id && !dessert)) return { error: 'มีเมนูที่ไม่มีให้บริการแล้ว กรุณาเลือกใหม่' };
    const unit = money((drink ? drink.price : 0) + (dessert ? dessert.price : 0));
    rows.push({
      set_id: '', set_label: '', set_name: '', items_json: '', pieces: (drink ? 1 : 0) + (dessert ? 1 : 0), drink_pieces: drink ? 1 : 0, dessert_pieces: dessert ? 1 : 0,
      drink_id: drink ? drink.id : '', drink_name: drink ? drink.name_en : '',
      dessert_id: dessert ? dessert.id : '', dessert_name: dessert ? dessert.name_en : '',
      quantity: qty, unit_price: unit, line_total: money(unit * qty),
    });
  }
  const total = money(rows.reduce((s, r) => s + r.line_total, 0));
  const want = rows.reduce((w, r) => { w.total += r.quantity * r.pieces; w.drink += r.quantity * r.drink_pieces; w.dessert += r.quantity * r.dessert_pieces; return w; }, { drink: 0, dessert: 0, total: 0 });
  return { rows, want, total };
}
/** Stock message when an order wants more than what is left ('' = fine) */
/** โควตาชุดต่อวัน: ออเดอร์นี้ (want.total ชุด) เกินที่เหลือของวันนี้หรือไม่ → ข้อความแจ้งลูกค้า ('' = พอ) */
function dayShortfall(want, ow) {
  if (!ow || ow.per_day == null || ow.today_remaining == null) return '';
  if (want.total <= ow.today_remaining) return '';
  return ow.today_remaining === 0 ? (ow.message || `วันนี้ขายครบ ${ow.per_day} ชุดแล้ว / Today's sets are sold out`) : `วันนี้เหลือเพียง ${ow.today_remaining} ชุด (สั่ง ${want.total} ชุด) กรุณาลดจำนวนหรือสั่งใหม่วันถัดไป / Only ${ow.today_remaining} sets left today`;
}
function stockShortfall(want, remaining) {
  const label = { total: 'สินค้า', drink: 'เครื่องดื่ม', dessert: 'ของหวาน' };
  for (const k of ['total', 'drink', 'dessert']) {
    if (remaining[k] != null && want[k] > remaining[k]) {
      return remaining[k] === 0 ? `${label[k]}หมดแล้ว / Sold out` : `${label[k]}เหลือเพียง ${remaining[k]} ชุด (สั่ง ${want[k]} ชุด) / Only ${remaining[k]} left`;
    }
  }
  return '';
}
module.exports = { readAdminMemberBody, CODES_FULL_MESSAGE, memberPickupCode, MEMBER_DATE_CHANGES, DATE_LOCKED_MESSAGE, memberDateChange, dateChangesLeft, MEMBER_PICKUP_FROM, MEMBER_PICKUP_TO, memberPickupDates, maskEmail, NOT_ELITE_MESSAGE, normPhoneTH, readMemberListRows, memberListRequired, MEMBERSHIP_HOME_SLUGS, membershipDesignJson, MEMBERSHIP_NO_ORDER, readMemberBody, dayShortfall, renameDesignItems, promoPrefix, formatPromoCode, nextPromoNumber, promoRangeView, normalizeMenu, normalizeStores, normPickupMap, isImageUrl, normalizeDesign, defaultDesign, campaignDesign, menuFor, slugOf, slugify, lim, readCampaignBody, buildOrderRows, stockShortfall };
