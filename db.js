const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'orders.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  last_seen_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,      -- YYYYMMDD + running 5 digits, e.g. 2026090600001
  customer_id TEXT NOT NULL REFERENCES customers(id),
  store_id TEXT NOT NULL,
  store_name TEXT NOT NULL,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | slip_uploaded | paid | picked_up | cancelled
  note TEXT DEFAULT '',
  slip_path TEXT DEFAULT '',
  slip_hash TEXT DEFAULT '',
  slip_ref TEXT DEFAULT '',
  slip_amount REAL,
  slip_reason TEXT DEFAULT '',
  slip_verified INTEGER DEFAULT 0,        -- 1 = SlipOK passed, 0 = manual / not verified
  created_at TEXT DEFAULT (datetime('now','localtime')),
  paid_at TEXT,
  picked_up_at TEXT,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  drink_id TEXT DEFAULT '',
  drink_name TEXT DEFAULT '',
  dessert_id TEXT DEFAULT '',
  dessert_name TEXT DEFAULT '',
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS order_counters (
  day TEXT PRIMARY KEY,                   -- YYYYMMDD
  seq INTEGER NOT NULL DEFAULT 0
);

-- Back-office accounts. role: it_admin (everything) | admin (marketing, view orders) | finance (approve slips)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('it_admin', 'admin', 'finance')),
  display_name TEXT DEFAULT '',
  department TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

-- A campaign is what the customer site sells. Exactly one is active at a time.
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  stock_total INTEGER,                    -- NULL = unlimited
  stock_drink INTEGER,
  stock_dessert INTEGER,
  promo_from INTEGER NOT NULL DEFAULT 2026090001,
  promo_to INTEGER NOT NULL DEFAULT 2026092000,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

// orders.phone: เบอร์ติดต่อของผู้รับขนม (กรอกที่หน้า Cart)
if (!db.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name = 'phone'").get()) db.exec("ALTER TABLE orders ADD COLUMN phone TEXT DEFAULT ''");

// customers: Google account (migration for databases created before Google login)
for (const [col, ddl] of [['google_sub', 'TEXT'], ['email', 'TEXT'], ['name', 'TEXT'], ['picture', 'TEXT'], ['last_login_at', 'TEXT']]) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('customers') WHERE name = ?").get(col)) db.exec(`ALTER TABLE customers ADD COLUMN ${col} ${ddl}`);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_google ON customers(google_sub) WHERE google_sub IS NOT NULL');
// ลูกค้าคนหนึ่งผูกกับแคมเปญที่เคยล็อกอิน/สั่งซื้อ (เช่น /jianchaxnavori/) ใช้แยกรายชื่อลูกค้าตามแคมเปญในหลังบ้าน
// meta: one-off migration flags
db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
db.exec(`CREATE TABLE IF NOT EXISTS customer_campaigns (
  customer_id TEXT NOT NULL REFERENCES customers(id),
  campaign_id TEXT NOT NULL,
  first_seen_at TEXT DEFAULT (datetime('now','localtime')),
  last_seen_at TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (customer_id, campaign_id)
)`);

// ออเดอร์เดิมที่สั่งไว้ก่อนมี Google login (ไม่ผูกกับบัญชี Google) → ย้ายไปอยู่กับบัญชีเจ้าของ (LEGACY_ORDERS_OWNER, ค่าเริ่มต้น whenwendy.yake@gmail.com)
// ทำครั้งเดียว: สร้างแถวลูกค้าแบบรอยืนยัน (email ตั้งไว้, google_sub ว่าง) แล้วเมื่อเจ้าของล็อกอินด้วย Google อีเมลนี้ server.js จะผูกบัญชีให้อัตโนมัติ
const LEGACY_ORDERS_OWNER = (process.env.LEGACY_ORDERS_OWNER || 'whenwendy.yake@gmail.com').trim().toLowerCase();
if (LEGACY_ORDERS_OWNER && !db.prepare("SELECT 1 FROM meta WHERE key = 'legacy_orders_owner'").get()) {
  db.transaction(() => {
    let owner = db.prepare('SELECT id FROM customers WHERE lower(email) = ? ORDER BY google_sub IS NULL LIMIT 1').get(LEGACY_ORDERS_OWNER);
    const orphan = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE google_sub IS NULL) OR customer_id NOT IN (SELECT id FROM customers)').get().n;
    if (orphan > 0) {
      if (!owner) { owner = { id: require('crypto').randomUUID() }; db.prepare('INSERT INTO customers(id, email, name) VALUES (?, ?, ?)').run(owner.id, LEGACY_ORDERS_OWNER, LEGACY_ORDERS_OWNER.split('@')[0]); }
      db.prepare('UPDATE orders SET customer_id = ? WHERE customer_id IN (SELECT id FROM customers WHERE google_sub IS NULL AND id <> ?) OR customer_id NOT IN (SELECT id FROM customers)').run(owner.id, owner.id);
      for (const r of db.prepare('SELECT DISTINCT campaign_id FROM orders WHERE customer_id = ? AND campaign_id IS NOT NULL').all(owner.id)) db.prepare('INSERT OR IGNORE INTO customer_campaigns(customer_id, campaign_id) VALUES (?, ?)').run(owner.id, r.campaign_id);
    }
    db.prepare("INSERT INTO meta(key, value) VALUES ('legacy_orders_owner', ?)").run(LEGACY_ORDERS_OWNER);
  })();
}

// order_lines: Match Set columns (migration for databases created before sets existed)
for (const [col, ddl] of [['set_id', "TEXT DEFAULT ''"], ['set_label', "TEXT DEFAULT ''"], ['set_name', "TEXT DEFAULT ''"], ['items_json', "TEXT DEFAULT ''"], ['pieces', 'INTEGER'], ['drink_pieces', 'INTEGER'], ['dessert_pieces', 'INTEGER']]) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('order_lines') WHERE name = ?").get(col)) db.exec(`ALTER TABLE order_lines ADD COLUMN ${col} ${ddl}`);
}
db.exec("UPDATE order_lines SET pieces = (drink_id <> '') + (dessert_id <> ''), drink_pieces = (drink_id <> ''), dessert_pieces = (dessert_id <> '') WHERE pieces IS NULL");

// campaigns.slug: the campaign's own customer URL (order.jianchatea.com/<slug>/), letters+digits from the name, e.g. jianchaxnavori
if (!db.prepare("SELECT 1 FROM pragma_table_info('campaigns') WHERE name = 'slug'").get()) {
  db.exec('ALTER TABLE campaigns ADD COLUMN slug TEXT');
  db.exec("UPDATE campaigns SET slug = lower(replace(id, '-', '')) WHERE slug IS NULL OR slug = ''");
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_slug ON campaigns(slug)');
// campaigns.orders_open: 0 = the campaign page is visible but no longer takes orders
if (!db.prepare("SELECT 1 FROM pragma_table_info('campaigns') WHERE name = 'orders_open'").get()) {
  db.exec('ALTER TABLE campaigns ADD COLUMN orders_open INTEGER NOT NULL DEFAULT 1');
}

// campaigns.design_json: what the customer homepage shows for this campaign (promote images + Match Sets), edited on the IT-Admin Design page
if (!db.prepare("SELECT 1 FROM pragma_table_info('campaigns') WHERE name = 'design_json'").get()) {
  db.exec('ALTER TABLE campaigns ADD COLUMN design_json TEXT');
}

// orders.campaign_id (migration for databases created before campaigns existed)
if (!db.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name = 'campaign_id'").get()) {
  db.exec('ALTER TABLE orders ADD COLUMN campaign_id TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_campaign ON orders(campaign_id, created_at DESC)');

// promo_code: 10-digit POS promotion code handed to the customer once the order is paid
if (!db.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name = 'promo_code'").get()) {
  db.exec('ALTER TABLE orders ADD COLUMN promo_code TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_promo_code ON orders(promo_code) WHERE promo_code IS NOT NULL');

const ROLES = ['it_admin', 'admin', 'finance'];
const hashPassword = (p) => bcrypt.hashSync(String(p), 10);
const checkPassword = (p, hash) => { try { return bcrypt.compareSync(String(p), hash); } catch (e) { return false; } };

/** First-run seed: the three back-office accounts and the first campaign. */
function seedDefaults({ campaign } = {}) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    const ins = db.prepare('INSERT INTO users(id, username, password_hash, role, display_name, department) VALUES (?, ?, ?, ?, ?, ?)');
    ins.run(crypto.randomUUID(), 'it-admin', hashPassword('jiancha2026'), 'it_admin', 'IT - Admin', 'IT');
    ins.run(crypto.randomUUID(), 'admin', hashPassword('marketing'), 'admin', 'Admin', 'Marketing');
    ins.run(crypto.randomUUID(), 'finance', hashPassword('jiancha'), 'finance', 'Finance', 'Finance');
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n === 0) {
    const c = campaign || {};
    db.prepare('INSERT INTO campaigns(id, slug, name, active, stock_total, stock_drink, stock_dessert, promo_from, promo_to) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)')
      .run(c.id || 'jiancha-x-navori', c.slug || 'jianchaxnavori', c.name || 'JIANCHA x NAVORI', c.stock_total ?? 1000, c.stock_drink ?? null, c.stock_dessert ?? null, c.promo_from || 2026090001, c.promo_to || 2026092000);
  }
  // orders created before campaigns existed belong to the active campaign
  const active = db.prepare('SELECT id FROM campaigns WHERE active = 1 ORDER BY created_at LIMIT 1').get();
  if (active) db.prepare('UPDATE orders SET campaign_id = ? WHERE campaign_id IS NULL').run(active.id);
}

/** Next order number for today (YYYYMMDD + 5 digits), atomic. */
const nextOrderNumber = db.transaction(() => {
  const d = new Date();
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  db.prepare('INSERT INTO order_counters(day, seq) VALUES (?, 0) ON CONFLICT(day) DO NOTHING').run(day);
  db.prepare('UPDATE order_counters SET seq = seq + 1 WHERE day = ?').run(day);
  const { seq } = db.prepare('SELECT seq FROM order_counters WHERE day = ?').get(day);
  return `${day}${String(seq).padStart(5, '0')}`;
});

module.exports = { db, nextOrderNumber, DB_PATH, ROLES, hashPassword, checkPassword, seedDefaults };
