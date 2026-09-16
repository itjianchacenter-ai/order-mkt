/* ล้างออเดอร์ (ข้อมูลทดสอบ): ออเดอร์ + รายการ + สลิป + mail_log + ตัวนับเลขออเดอร์ — เก็บบัญชีหลังบ้าน แคมเปญ/Design และบัญชีลูกค้าไว้
   - POST /api/admin/reset (IT-Admin) ล้างทั้งหมดทันที
   - RESET_ORDERS_AT="YYYY-MM-DD HH:MM" (เวลาไทย): ล้างออเดอร์ที่สร้างก่อนเวลานี้ให้อัตโนมัติครั้งเดียว เมื่อมีคนเปิดเว็บหลังเวลานั้น (Pages ไม่มี cron) */
import { sql } from './util.js';
import { bangkokNow } from '../lib/window.js';

/** @param before 'YYYY-MM-DD HH:MM:SS' (เวลาไทย) ล้างเฉพาะที่สร้างก่อนเวลานี้; ไม่ส่ง = ล้างทั้งหมด */
export async function wipeOrders(env, { before = '' } = {}) {
  const db = sql(env);
  const counts = await db.get(`SELECT COUNT(*) AS orders, COUNT(promo_code) AS codes, (SELECT COUNT(*) FROM files WHERE key LIKE 'slips/%'${before ? ' AND created_at < ?1' : ''}) AS slips FROM orders${before ? ' WHERE created_at < ?1' : ''}`, ...(before ? [before] : []));
  const w = before ? ' WHERE created_at < ?' : ''; const a = before ? [before] : [];
  const dayKey = before ? before.slice(0, 10).replace(/-/g, '') : '';
  const stmts = [
    db.stmt(`DELETE FROM order_lines WHERE order_id IN (SELECT id FROM orders${w})`, ...a),
    db.stmt(`DELETE FROM mail_log${w}`, ...a),
    db.stmt(`DELETE FROM files WHERE key LIKE 'slips/%'${before ? ' AND created_at < ?' : ''}`, ...a),
    db.stmt(`DELETE FROM orders${w}`, ...a),
    // เลขออเดอร์ของวันที่ล้างไปแล้วเริ่มนับใหม่ (วันที่ยังมีออเดอร์ค้างอยู่ไม่แตะ กันเลขซ้ำ)
    before ? db.stmt('DELETE FROM order_counters WHERE day < ?', dayKey) : db.stmt('DELETE FROM order_counters'),
  ];
  await db.batch(stmts);
  if (env.FILES) { try { const l = await env.FILES.list({ prefix: 'slips/', limit: 1000 }); for (const o of l.objects) if (!before || (o.uploaded && bangkokNow(o.uploaded) < before)) await env.FILES.delete(o.key); } catch (e) { /* best effort */ } }
  return { orders: counts.orders, promo_codes: counts.codes, slips: counts.slips, before: before || null };
}

let checked = '';
/** ล้างอัตโนมัติตาม RESET_ORDERS_AT (ทำครั้งเดียวต่อค่าที่ตั้ง; หลายเครื่องพร้อมกันได้คนเดียวผ่าน meta) */
export async function maybeScheduledReset(env) {
  const at = String(env.RESET_ORDERS_AT || '').trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at) || checked === at) return;
  const before = at + ':00';
  if (bangkokNow() < before) return;              // ยังไม่ถึงเวลา (เช็คใหม่ทุกครั้ง แต่ถูกมาก)
  checked = at;
  const db = sql(env);
  const r = await db.run('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)', 'reset:' + at, bangkokNow());
  if (!r.meta || r.meta.changes !== 1) return;     // มีเครื่องอื่นทำไปแล้ว
  try { const res = await wipeOrders(env, { before }); console.log('[reset] scheduled reset done', JSON.stringify(res)); }
  catch (e) { await db.run('DELETE FROM meta WHERE key = ?', 'reset:' + at); throw e; }
}
