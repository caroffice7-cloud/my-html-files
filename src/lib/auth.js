'use strict';

/**
 * 인증
 *  - 관리자(히스메이커스): 단일 비밀번호 + 서버 세션
 *  - 공급처: 계약 공급처마다 발급한 아이디 + 비밀번호(scrypt 해시)
 */

const crypto = require('node:crypto');
const { get } = require('../db');
const { HttpError, parseCookies, setCookie, randomToken } = require('./http');

const ADMIN_COOKIE = 'mall_admin';
const SUPPLIER_COOKIE = 'mall_supplier';
const TTL_MS = 1000 * 60 * 60 * 8;

const adminSessions = new Map();
const supplierSessions = new Map();

function adminPassword() {
  return process.env.ADMIN_PASSWORD || 'bmctvda2026';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * 로그인 시도 제한 — 관리자와 공급처 모두에 적용한다.
 * 같은 IP 에서 10분 안에 5회 실패하면 10분간 잠근다.
 */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map();

function throttleKey(req, scope) {
  const fwd = req.headers['x-forwarded-for'];
  const ip = (typeof fwd === 'string' && fwd.length) ? fwd.split(',')[0].trim() : (req.socket.remoteAddress || 'unknown');
  return `${scope}:${ip}`;
}

function checkThrottle(req, scope) {
  const rec = attempts.get(throttleKey(req, scope));
  if (!rec) return;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(throttleKey(req, scope)); return; }
  if (rec.count >= MAX_ATTEMPTS) {
    const wait = Math.ceil((WINDOW_MS - (Date.now() - rec.first)) / 60000);
    throw new HttpError(429, `로그인 시도가 너무 많습니다. ${wait}분 후에 다시 시도해 주세요.`);
  }
}

function recordFailure(req, scope) {
  const key = throttleKey(req, scope);
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else rec.count += 1;
}

function clearThrottle(req, scope) {
  attempts.delete(throttleKey(req, scope));
}

function prune(map) {
  for (const [token, sess] of map) {
    if (Date.now() - sess.createdAt > TTL_MS) map.delete(token);
  }
}

// ── 관리자 ──
function adminLogin(res, password, req) {
  if (req) checkThrottle(req, 'admin');
  if (!safeEqual(password || '', adminPassword())) {
    if (req) recordFailure(req, 'admin');
    throw new HttpError(401, '비밀번호가 일치하지 않습니다.');
  }
  if (req) clearThrottle(req, 'admin');
  const token = randomToken();
  adminSessions.set(token, { createdAt: Date.now() });
  setCookie(res, ADMIN_COOKIE, token, { maxAge: Math.floor(TTL_MS / 1000), secure: process.env.SECURE_COOKIE === '1' });
}

function adminLogout(req, res) {
  const token = parseCookies(req)[ADMIN_COOKIE];
  if (token) adminSessions.delete(token);
  setCookie(res, ADMIN_COOKIE, '', { maxAge: 0 });
}

function currentAdmin(req) {
  prune(adminSessions);
  const token = parseCookies(req)[ADMIN_COOKIE];
  return token ? adminSessions.get(token) || null : null;
}

function requireAdmin(req) {
  if (!currentAdmin(req)) throw new HttpError(401, '관리자 로그인이 필요합니다.');
}

// ── 공급처 ──
function supplierLogin(res, loginId, password, req) {
  if (req) checkThrottle(req, 'supplier');
  const supplier = get('SELECT * FROM suppliers WHERE login_id = ?', String(loginId || '').trim());
  if (!supplier || !verifyPassword(password, supplier.password_hash, supplier.password_salt)) {
    if (req) recordFailure(req, 'supplier');
    throw new HttpError(401, '아이디 또는 비밀번호가 올바르지 않습니다.');
  }
  if (req) clearThrottle(req, 'supplier');
  if (supplier.status === '계약종료') throw new HttpError(403, '계약이 종료된 공급처입니다. 담당자에게 문의해 주세요.');
  const token = randomToken();
  supplierSessions.set(token, { supplierId: supplier.id, createdAt: Date.now() });
  setCookie(res, SUPPLIER_COOKIE, token, { maxAge: Math.floor(TTL_MS / 1000), secure: process.env.SECURE_COOKIE === '1' });
  return supplier;
}

function supplierLogout(req, res) {
  const token = parseCookies(req)[SUPPLIER_COOKIE];
  if (token) supplierSessions.delete(token);
  setCookie(res, SUPPLIER_COOKIE, '', { maxAge: 0 });
}

function currentSupplier(req) {
  prune(supplierSessions);
  const token = parseCookies(req)[SUPPLIER_COOKIE];
  const sess = token ? supplierSessions.get(token) : null;
  if (!sess) return null;
  return get('SELECT * FROM suppliers WHERE id = ?', sess.supplierId) || null;
}

function requireSupplier(req) {
  const supplier = currentSupplier(req);
  if (!supplier) throw new HttpError(401, '공급처 로그인이 필요합니다.');
  return supplier;
}

module.exports = {
  hashPassword, verifyPassword,
  adminLogin, adminLogout, currentAdmin, requireAdmin,
  supplierLogin, supplierLogout, currentSupplier, requireSupplier,
};
