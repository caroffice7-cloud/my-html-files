const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'applications.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    name_enc TEXT NOT NULL,
    birthdate_enc TEXT NOT NULL,
    phone_enc TEXT NOT NULL,
    emergency_phone_enc TEXT,
    address_enc TEXT NOT NULL,
    naturelove_member INTEGER NOT NULL DEFAULT 0,
    monthly_currency_amount INTEGER,
    desired_payment_amount INTEGER NOT NULL,
    desired_start_year INTEGER NOT NULL,
    desired_start_month INTEGER NOT NULL,
    proxy_writer_enc TEXT,
    signature_enc TEXT NOT NULL,
    privacy_agreed INTEGER NOT NULL DEFAULT 0,
    terms_agreed INTEGER NOT NULL DEFAULT 0,
    consent_ip TEXT,
    consent_user_agent TEXT,
    consent_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '접수대기',
    memo TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_username TEXT NOT NULL,
    application_id INTEGER,
    action TEXT NOT NULL,
    at TEXT NOT NULL
  );
`);

module.exports = db;
