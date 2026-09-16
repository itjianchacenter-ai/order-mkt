/* ช่วงเปิดรับออเดอร์ + โควตาต่อวัน (นับตามวันเวลาไทย) — pure: callers count orders themselves */
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDayTH(iso) { const [y, mo, d] = iso.split('-').map(Number); return `${d} ${TH_MONTHS[mo - 1]} ${y + 543}`; }
function fmtDayEN(iso) { const [y, mo, d] = iso.split('-').map(Number); return `${d} ${EN_MONTHS[mo - 1]} ${y}`; }
function fmtDayRange(days) {
  if (!days.length) return { th: '', en: '' };
  const a = days[0], b = days[days.length - 1];
  if (a === b) return { th: fmtDayTH(a), en: fmtDayEN(a) };
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  return { th: sameMonth ? `${Number(a.slice(8))}–${fmtDayTH(b)}` : `${fmtDayTH(a)} – ${fmtDayTH(b)}`, en: sameMonth ? `${Number(a.slice(8))}–${fmtDayEN(b)}` : `${fmtDayEN(a)} – ${fmtDayEN(b)}` };
}
/** จัดกลุ่มตาราง รอบสั่ง → รอบรับ เป็นแถว เช่น สั่ง 21–22 ก.ย. → รับ 28 ก.ย. */
function pickupPairs(map) {
  const byPickup = new Map();
  for (const [o, p] of Object.entries(map).sort()) { if (!byPickup.has(p)) byPickup.set(p, []); byPickup.get(p).push(o); }
  return [...byPickup.entries()].map(([pickup, orderDays]) => ({ order_days: orderDays, pickup, order_range: fmtDayRange(orderDays), pickup_th: fmtDayTH(pickup), pickup_en: fmtDayEN(pickup) }));
}
/** วันนี้ตามเวลาไทย (YYYY-MM-DD); override ใช้ตอนทดสอบ */
const bangkokToday = (override, now = new Date()) => (override || '').trim() || now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
/** วันของรอบสั่งที่ใช้ตอนนี้: ปกติ = วันนี้ (เวลาไทย) แต่ถ้าตั้ง earlyHours และตอนนี้อยู่ในช่วง N ชั่วโมงก่อนวันเปิดรับวันแรก (00:00 เวลาไทย)
 *  ให้ถือเป็นรอบของวันแรกเลย (ออเดอร์นับโควตาและรอบรับของของวันแรก) — ใช้เปิดให้ทดสอบ/สั่งล่วงหน้าก่อนเปิดจริง
 *  override (ORDER_DAY_OVERRIDE) ชนะทุกอย่าง */
function effectiveOrderDay(orderDays, { override = '', earlyHours = 0, now = new Date() } = {}) {
  const today = bangkokToday(override, now);
  if (override || !(earlyHours > 0) || !orderDays || !orderDays.length) return today;
  const first = orderDays[0];
  if (today >= first) return today;
  const opensAt = new Date(first + 'T00:00:00+07:00').getTime() - earlyHours * 3600 * 1000;
  return now.getTime() >= opensAt ? first : today;
}
/** เวลาไทยตอนนี้ 'YYYY-MM-DD HH:MM:SS' (รูปแบบเดียวกับ datetime('now','localtime') ของ SQLite) */
function bangkokNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}
/** สถานะการรับออเดอร์ของแคมเปญวันนี้: open | before | closed | full (+ ข้อความแจ้งลูกค้า)
 *  menu = menuFor(campaign); today_count / total_count = non-cancelled orders today / across all order days */
function computeOrderWindow(menu, today, { today_count = 0, total_count = 0 } = {}) {
  const days = menu.order_days || []; const per_day = menu.orders_per_day || null;
  const range = fmtDayRange(days);
  let status = 'open', message = '';
  if (days.length && !days.includes(today)) {
    status = today < days[0] ? 'before' : 'closed';
    message = status === 'before' ? `ยังไม่เปิดรับคำสั่งซื้อ เปิดรับวันที่ ${range.th}${per_day ? ` (วันละ ${per_day} ออเดอร์)` : ''} / Orders open ${range.en}` : `ปิดรับคำสั่งซื้อแล้ว (รับเฉพาะวันที่ ${range.th}) / Ordering has closed`;
  } else if (per_day && today_count >= per_day) {
    const idx = days.indexOf(today); const next = idx >= 0 ? days[idx + 1] : null;
    status = 'full';
    message = next ? `วันนี้รับครบ ${per_day} ออเดอร์แล้ว กรุณาสั่งใหม่วันที่ ${fmtDayTH(next)} / Today's ${per_day} orders are full, please order again on ${fmtDayEN(next)}` : `รับออเดอร์ครบ ${per_day} ออเดอร์ของวันสุดท้ายแล้ว ปิดรับคำสั่งซื้อ / All orders are full, ordering has closed`;
  }
  // รอบสั่งวันนี้รับของได้วันไหน (ตาราง pickup_map) + ตารางคู่ทั้งหมดไว้แสดงให้ลูกค้า
  const pickup_map = menu.pickup_map || {}; const pickup_date = pickup_map[today] || null;
  return { days, per_day, today, today_count, today_remaining: per_day ? Math.max(0, per_day - today_count) : null, total_max: days.length && per_day ? days.length * per_day : null,
    total_count: days.length ? total_count : today_count, range, status, open: status === 'open', message, pickup_date, pickup_map, pickup_pairs: pickupPairs(pickup_map) };
}
module.exports = { TH_MONTHS, EN_MONTHS, fmtDayTH, fmtDayEN, fmtDayRange, pickupPairs, bangkokToday, bangkokNow, effectiveOrderDay, computeOrderWindow };
