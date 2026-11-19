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
  if (c && c.design_json) { try { return normalizeDesign(JSON.parse(c.design_json)); } catch (e) { /* fall through */ } }
  return defaultDesign(menu);
}
/** What the customer site sells for a campaign: its design's active sets and promote images (template fills the gaps). */
function menuFor(c, m) {
  const d = campaignDesign(c, m);
  return { banner: d.promote_images[0] || '', banners: d.promote_images, sets: d.sets.filter((x) => x.active), drinks: m.drinks, desserts: m.desserts,
    pickup_dates: d.pickup_dates.length ? d.pickup_dates : (Array.isArray(m.pickup_dates) ? m.pickup_dates : []), pickup_times: d.pickup_times.length ? d.pickup_times : (Array.isArray(m.pickup_times) ? m.pickup_times : []),
    order_days: d.order_days.length ? d.order_days : m.order_days, orders_per_day: d.orders_per_day || m.orders_per_day, pickup_map: Object.keys(d.pickup_map).length ? d.pickup_map : m.pickup_map, home: d.home };
}
/** ฟอร์มสมัครสมาชิก (หน้าแรกแบบ membership): ตรวจข้อมูล → { first_name, last_name, phone, pickup_time, store } หรือ { error, field }
 *  menu = menuFor(campaign) (ช่วงเวลา = pickup_times ของแคมเปญ), stores = normalizeStores(...) */
/** แคมเปญที่ต้องเป็นหน้าสมัครสมาชิกตั้งแต่ deploy (migration ครั้งเดียว meta 'membership_home_v1'; เปลี่ยนกลับได้ที่หน้า Design) */
const MEMBERSHIP_HOME_SLUGS = ['celebrateeverymomentwithjiancha'];
/** design_json (string|null) → design_json ใหม่ที่ home = 'membership' (คงรูป/เซ็ตเดิมไว้ ถ้าเปลี่ยนกลับเป็น Order ได้ของเดิม) */
function membershipDesignJson(designJson) {
  let d = {}; try { d = designJson ? JSON.parse(designJson) : {}; } catch (e) { d = {}; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
  return JSON.stringify({ ...d, home: 'membership' });
}
const MEMBERSHIP_NO_ORDER = 'ลิงก์นี้เป็นหน้าสมัครสมาชิก ไม่เปิดสั่งซื้อ / This page is for membership sign-up only';
function readMemberBody(b, menu, stores) {
  b = b && typeof b === 'object' ? b : {};
  const clean = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const first_name = clean(b.first_name, 80), last_name = clean(b.last_name, 80);
  if (!first_name) return { error: 'กรุณาใส่ชื่อ / Please enter your first name', field: 'first_name' };
  if (!last_name) return { error: 'กรุณาใส่นามสกุล / Please enter your last name', field: 'last_name' };
  const phone = String(b.phone || '').replace(/[^\d+]/g, '').slice(0, 20);
  if (!/^(\+66|0)\d{8,9}$/.test(phone)) return { error: 'กรุณาใส่เบอร์โทรศัพท์มือถือ 10 หลัก / Please enter a valid phone number', field: 'phone' };
  const times = (menu && Array.isArray(menu.pickup_times)) ? menu.pickup_times : [];
  const pickup_time = clean(b.pickup_time, 40);
  if (times.length ? !times.includes(pickup_time) : !pickup_time) return { error: 'กรุณาเลือกเวลา / Please choose a time', field: 'pickup_time' };
  const store = (stores || []).find((s) => s.id === String(b.store_id || ''));
  if (!store) return { error: 'กรุณาเลือกสถานที่ / Please choose a location', field: 'store_id' };
  return { first_name, last_name, phone, pickup_time, store };
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
module.exports = { MEMBERSHIP_HOME_SLUGS, membershipDesignJson, MEMBERSHIP_NO_ORDER, readMemberBody, dayShortfall, renameDesignItems, promoPrefix, formatPromoCode, nextPromoNumber, promoRangeView, normalizeMenu, normalizeStores, normPickupMap, isImageUrl, normalizeDesign, defaultDesign, campaignDesign, menuFor, slugOf, slugify, lim, readCampaignBody, buildOrderRows, stockShortfall };
