/* D1 schema (same tables as db.js) + first-run seed. Runs once per worker isolate; every statement is idempotent.
   Timestamps are Thai time (UTC+7) as text 'YYYY-MM-DD HH:MM:SS' — the same format the Node server stored. */
import { sql, uuid, hashPassword } from './util.js';
import { MENU } from './data.js';
import * as M from '../lib/menu.js';

const NOW = "strftime('%Y-%m-%d %H:%M:%S', 'now', '+7 hours')";
const DDL = [
  `CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, google_sub TEXT, email TEXT, name TEXT, picture TEXT, last_login_at TEXT, pdpa_accepted_at TEXT,
    created_at TEXT DEFAULT (${NOW}), last_seen_at TEXT DEFAULT (${NOW}))`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_google ON customers(google_sub) WHERE google_sub IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email)',
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    campaign_id TEXT,
    store_id TEXT NOT NULL, store_name TEXT NOT NULL,
    total REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', pickup_date TEXT DEFAULT '', pickup_time TEXT DEFAULT '', order_day TEXT DEFAULT '', pdpa_accepted_at TEXT DEFAULT '',
    slip_path TEXT DEFAULT '', slip_hash TEXT DEFAULT '', slip_ref TEXT DEFAULT '', slip_amount REAL, slip_reason TEXT DEFAULT '', slip_verified INTEGER DEFAULT 0,
    promo_code TEXT,
    created_at TEXT DEFAULT (${NOW}), paid_at TEXT, picked_up_at TEXT, cancelled_at TEXT)`,
  'CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_orders_campaign ON orders(campaign_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_orders_day ON orders(campaign_id, order_day)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_promo_code ON orders(promo_code) WHERE promo_code IS NOT NULL',
  `CREATE TABLE IF NOT EXISTS order_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    set_id TEXT DEFAULT '', set_label TEXT DEFAULT '', set_name TEXT DEFAULT '', items_json TEXT DEFAULT '', pieces INTEGER, drink_pieces INTEGER, dessert_pieces INTEGER,
    drink_id TEXT DEFAULT '', drink_name TEXT DEFAULT '', dessert_id TEXT DEFAULT '', dessert_name TEXT DEFAULT '',
    quantity INTEGER NOT NULL, unit_price REAL NOT NULL, line_total REAL NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_lines_order ON order_lines(order_id)',
  'CREATE TABLE IF NOT EXISTS order_counters (day TEXT PRIMARY KEY, seq INTEGER NOT NULL DEFAULT 0)',
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('it_admin', 'admin', 'finance')), display_name TEXT DEFAULT '', department TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (${NOW}), updated_at TEXT DEFAULT (${NOW}))`,
  `CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY, slug TEXT, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0, orders_open INTEGER NOT NULL DEFAULT 1,
    stock_total INTEGER, stock_drink INTEGER, stock_dessert INTEGER,
    promo_from INTEGER NOT NULL DEFAULT 2026090001, promo_to INTEGER NOT NULL DEFAULT 2026092000, promo_prefix TEXT DEFAULT '',
    design_json TEXT, created_at TEXT DEFAULT (${NOW}), updated_at TEXT DEFAULT (${NOW}))`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_slug ON campaigns(slug)',
  `CREATE TABLE IF NOT EXISTS customer_campaigns (
    customer_id TEXT NOT NULL REFERENCES customers(id), campaign_id TEXT NOT NULL,
    first_seen_at TEXT DEFAULT (${NOW}), last_seen_at TEXT DEFAULT (${NOW}), PRIMARY KEY (customer_id, campaign_id))`,
  `CREATE TABLE IF NOT EXISTS mail_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, kind TEXT NOT NULL, to_email TEXT NOT NULL, subject TEXT NOT NULL,
    status TEXT NOT NULL, error TEXT DEFAULT '', created_at TEXT DEFAULT (${NOW}))`,
  'CREATE INDEX IF NOT EXISTS idx_mail_log_order ON mail_log(order_id, id DESC)',
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)',
  // รูปสลิป/รูป Design เมื่อไม่ได้ผูก R2 (worker/files.js)
  `CREATE TABLE IF NOT EXISTS files (key TEXT PRIMARY KEY, type TEXT DEFAULT '', size INTEGER DEFAULT 0, data BLOB, created_at TEXT DEFAULT (${NOW}))`,
];

let ready = null;
export function ensureSchema(env) {
  if (!ready) ready = migrate(env).catch((e) => { ready = null; throw e; });
  return ready;
}
async function migrate(env) {
  const db = sql(env);
  await db.batch(DDL.map((q) => db.stmt(q)));
  // ฐานข้อมูลที่สร้างก่อนมี promo_prefix
  try { await db.run("ALTER TABLE campaigns ADD COLUMN promo_prefix TEXT DEFAULT ''"); } catch (e) { /* มีอยู่แล้ว */ }
  try { await db.run("ALTER TABLE orders ADD COLUMN email TEXT DEFAULT ''"); } catch (e) { /* มีอยู่แล้ว */ }   // อีเมลผู้สั่ง (กรอกที่หน้า Order Summary)
  // First run: the three back-office accounts (change the passwords in the Account page before going live)
  if ((await db.get('SELECT COUNT(*) AS n FROM users')).n === 0) {
    const seed = [['it-admin', 'jiancha2026', 'it_admin', 'IT - Admin', 'IT'], ['admin', 'marketing', 'admin', 'Admin', 'Marketing'], ['finance', 'jiancha', 'finance', 'Finance', 'Finance']];
    const stmts = [];
    for (const [u, p, role, dn, dep] of seed) stmts.push(db.stmt('INSERT OR IGNORE INTO users(id, username, password_hash, role, display_name, department) VALUES (?, ?, ?, ?, ?, ?)', uuid(), u, await hashPassword(p), role, dn, dep));
    await db.batch(stmts);
  }
  // First campaign: stock / promo range from data/menu.json
  if ((await db.get('SELECT COUNT(*) AS n FROM campaigns')).n === 0) {
    await db.run('INSERT OR IGNORE INTO campaigns(id, slug, name, active, stock_total, stock_drink, stock_dessert, promo_from, promo_to, promo_prefix) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)',
      'jiancha-x-navori', 'jianchaxnavori', 'JIANCHA x NAVORI', MENU.stock.total ?? 1000, MENU.stock.drink ?? null, MENU.stock.dessert ?? null, MENU.promo_code.from || 2026090001, MENU.promo_code.to || 2026092000, MENU.promo_code.prefix || '');
  }
  // แคมเปญแรกที่ยังใช้ช่วงรหัสเริ่มต้นเดิม (2026090001–2026092000) และยังไม่เคยออกรหัส → เปลี่ยนเป็นช่วงของแม่แบบ (NVR260001–NVR262000) ครั้งเดียว
  if (MENU.promo_code.prefix && !(await db.get("SELECT 1 AS x FROM meta WHERE key = 'promo_range_v2'"))) {
    await db.run("UPDATE campaigns SET promo_prefix = ?, promo_from = ?, promo_to = ? WHERE id = 'jiancha-x-navori' AND (promo_prefix IS NULL OR promo_prefix = '') AND promo_from = 2026090001 AND promo_to = 2026092000 AND NOT EXISTS (SELECT 1 FROM orders WHERE campaign_id = 'jiancha-x-navori' AND promo_code IS NOT NULL)", MENU.promo_code.prefix, MENU.promo_code.from || 1, MENU.promo_code.to || 2000);
    await db.run("INSERT OR IGNORE INTO meta(key, value) VALUES ('promo_range_v2', ?)", MENU.promo_code.prefix);
  }
  // ชื่อขนมในเซ็ตเปลี่ยน (Golden Mung Snow Mooncake / Taro Mochi Mooncake) → แก้ใน design ที่บันทึกไว้ครั้งเดียว
  if (!(await db.get("SELECT 1 AS x FROM meta WHERE key = 'item_names_v2'"))) {
    for (const row of await db.all("SELECT id, design_json FROM campaigns WHERE design_json IS NOT NULL AND design_json <> ''")) {
      const next = M.renameDesignItems(row.design_json); if (next) await db.run('UPDATE campaigns SET design_json = ? WHERE id = ?', next, row.id);
    }
    await db.run("INSERT OR IGNORE INTO meta(key, value) VALUES ('item_names_v2', '1')");
  }
}
