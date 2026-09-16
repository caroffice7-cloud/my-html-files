'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'mall.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const SCHEMA = `
-- 공급처(농가·소상공인)
CREATE TABLE IF NOT EXISTS suppliers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  ceo           TEXT,
  biz_no        TEXT,
  tax_type      TEXT,
  address       TEXT,
  phone         TEXT,
  email         TEXT,
  login_id      TEXT UNIQUE,
  password_hash TEXT,
  password_salt TEXT,
  intro         TEXT,
  status        TEXT NOT NULL DEFAULT '계약중',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 위탁판매 계약 조건 (공급처마다 수수료·정산주기가 다르므로 데이터로 관리)
CREATE TABLE IF NOT EXISTS supplier_contracts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id         INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  commission_rate     REAL,
  commission_note     TEXT,
  settlement_cycle    TEXT NOT NULL DEFAULT '익월 15일',
  shipping_method     TEXT NOT NULL DEFAULT '위탁배송(공급처 직발송)',
  ship_days           INTEGER,
  discount_limit_rate REAL,
  channel_fee_bearer  TEXT DEFAULT '수탁자(히스메이커스) 부담',
  contract_start      TEXT,
  contract_period     TEXT DEFAULT '1년(자동연장)',
  note                TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 상품: 자사몰이 상품 데이터의 단일 원천(Single Source of Truth)
CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id     INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  category        TEXT,
  spec            TEXT,
  grade           TEXT,
  origin          TEXT,
  shelf_life      TEXT,
  storage         TEXT,
  ingredients     TEXT,
  notice_items    TEXT,
  description     TEXT,
  supply_price    INTEGER NOT NULL DEFAULT 0,
  suggested_price INTEGER NOT NULL DEFAULT 0,
  stock           INTEGER NOT NULL DEFAULT 0,
  shipping_fee    INTEGER NOT NULL DEFAULT 0,
  free_ship_over  INTEGER NOT NULL DEFAULT 0,
  commission_rate REAL,
  status          TEXT NOT NULL DEFAULT '승인대기',
  reject_reason   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

CREATE TABLE IF NOT EXISTS product_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 채널 연동: 같은 상품을 자사몰/쿠팡/쿠팡파트너스/토스쇼핑에 어떻게 내보낼지
CREATE TABLE IF NOT EXISTS channel_listings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  listed       INTEGER NOT NULL DEFAULT 0,
  channel_price INTEGER,
  channel_url  TEXT,
  channel_note TEXT,
  synced_at    TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(product_id, channel)
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no       TEXT NOT NULL UNIQUE,
  channel        TEXT NOT NULL DEFAULT '자사몰',
  customer_name  TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  zipcode        TEXT,
  address        TEXT,
  address_detail TEXT,
  memo           TEXT,
  status         TEXT NOT NULL DEFAULT '주문접수',
  goods_amount   INTEGER NOT NULL DEFAULT 0,
  shipping_fee   INTEGER NOT NULL DEFAULT 0,
  total_amount   INTEGER NOT NULL DEFAULT 0,
  pay_method     TEXT NOT NULL DEFAULT '무통장입금',
  payer_name     TEXT,
  paid           INTEGER NOT NULL DEFAULT 0,
  external_no    TEXT,
  refund_reason  TEXT,
  refund_bearer  TEXT,
  refund_cost    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      INTEGER REFERENCES products(id),
  supplier_id     INTEGER REFERENCES suppliers(id),
  name            TEXT NOT NULL,
  spec            TEXT,
  qty             INTEGER NOT NULL DEFAULT 1,
  unit_price      INTEGER NOT NULL DEFAULT 0,
  subtotal        INTEGER NOT NULL DEFAULT 0,
  commission_rate REAL NOT NULL DEFAULT 0,
  commission_amt  INTEGER NOT NULL DEFAULT 0,
  settle_amt      INTEGER NOT NULL DEFAULT 0,
  refunded        INTEGER NOT NULL DEFAULT 0,
  settlement_id   INTEGER REFERENCES settlements(id),
  tracking_no     TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_items_supplier ON order_items(supplier_id);

CREATE TABLE IF NOT EXISTS settlements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id    INTEGER NOT NULL REFERENCES suppliers(id),
  period_from    TEXT NOT NULL,
  period_to      TEXT NOT NULL,
  sales_amount   INTEGER NOT NULL DEFAULT 0,
  commission_amt INTEGER NOT NULL DEFAULT 0,
  refund_amount  INTEGER NOT NULL DEFAULT 0,
  supplier_cost  INTEGER NOT NULL DEFAULT 0,
  payout_amount  INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT '정산예정',
  pay_due        TEXT,
  paid_at        TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS order_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT,
  memo        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

db.exec(SCHEMA);

/** 이미 만들어진 데이터베이스에 컬럼을 더한다(있으면 건너뜀). */
function ensureColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// 반품·환불 비용 부담 주체(계약서 제7조) 기록
ensureColumn('orders', 'refund_reason', 'TEXT');
ensureColumn('orders', 'refund_bearer', 'TEXT');
ensureColumn('orders', 'refund_cost', 'INTEGER NOT NULL DEFAULT 0');
// 공급처 부담 반품비용 공제액(계약서 제8조 정산)
ensureColumn('settlements', 'supplier_cost', 'INTEGER NOT NULL DEFAULT 0');
// 상품별 개별 수수료율 — 비우면 공급처 계약 기본율을 따른다
ensureColumn('products', 'commission_rate', 'REAL');

// 수수료율 협의 이력 (누가 언제 몇 %로 정했는지 남긴다)
db.exec(`
CREATE TABLE IF NOT EXISTS commission_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL,
  old_rate    REAL,
  new_rate    REAL,
  memo        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_commission_logs_supplier ON commission_logs(supplier_id);
`);

const get = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
function setting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  run('INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

module.exports = { db, get, all, run, tx, setting, setSetting, DB_PATH };
