const express = require('express');
const db = require('../db');
const { encryptField, decryptField, maskPhone, maskName } = require('../crypto');
const { validateApplication } = require('../validators/application');
const { requireAdminAuth } = require('../middleware/auth');
const { applicationLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const VALID_STATUSES = ['접수대기', '접수완료', '반려'];

function logAccess(adminUsername, applicationId, action) {
  db.prepare(
    'INSERT INTO access_log (admin_username, application_id, action, at) VALUES (?, ?, ?, ?)'
  ).run(adminUsername, applicationId, action, new Date().toISOString());
}

// 신청서 접수 (일반 사용자, 인증 불필요) — 문서 1페이지 "신청 내용 확인" 동의 항목을 그대로 반영
router.post('/', applicationLimiter, (req, res) => {
  const body = req.body || {};
  const errors = validateApplication(body);
  if (errors.length > 0) {
    return res.status(400).json({ error: '입력값을 확인해 주세요.', details: errors });
  }

  const now = new Date().toISOString();
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = (typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : null) || req.socket.remoteAddress || '';

  const stmt = db.prepare(`
    INSERT INTO applications (
      created_at, name_enc, birthdate_enc, phone_enc, emergency_phone_enc, address_enc,
      naturelove_member, monthly_currency_amount, desired_payment_amount,
      desired_start_year, desired_start_month, proxy_writer_enc, signature_enc,
      privacy_agreed, terms_agreed, consent_ip, consent_user_agent, consent_at, status
    ) VALUES (
      @created_at, @name_enc, @birthdate_enc, @phone_enc, @emergency_phone_enc, @address_enc,
      @naturelove_member, @monthly_currency_amount, @desired_payment_amount,
      @desired_start_year, @desired_start_month, @proxy_writer_enc, @signature_enc,
      @privacy_agreed, @terms_agreed, @consent_ip, @consent_user_agent, @consent_at, @status
    )
  `);

  const info = stmt.run({
    created_at: now,
    name_enc: encryptField(body.name.trim()),
    birthdate_enc: encryptField(body.birthdate.trim()),
    phone_enc: encryptField(body.phone.trim()),
    emergency_phone_enc: body.emergencyPhone ? encryptField(String(body.emergencyPhone).trim()) : null,
    address_enc: encryptField(body.address.trim()),
    naturelove_member: body.naturelinkMember ? 1 : 0,
    monthly_currency_amount: body.monthlyCurrencyAmount ? Number(body.monthlyCurrencyAmount) : null,
    desired_payment_amount: Number(body.desiredPaymentAmount),
    desired_start_year: Number(body.desiredStartYear),
    desired_start_month: Number(body.desiredStartMonth),
    proxy_writer_enc: body.proxyWriter ? encryptField(String(body.proxyWriter).trim()) : null,
    signature_enc: encryptField(body.signature),
    privacy_agreed: 1,
    terms_agreed: 1,
    consent_ip: ip,
    consent_user_agent: req.headers['user-agent'] || '',
    consent_at: now,
    status: '접수대기',
  });

  res.status(201).json({ id: info.lastInsertRowid, status: '접수대기', message: '신청이 접수되었습니다.' });
});

function toListItem(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    name: maskName(decryptField(row.name_enc)),
    phone: maskPhone(decryptField(row.phone_enc)),
    naturelinkMember: !!row.naturelove_member,
    desiredPaymentAmount: row.desired_payment_amount,
    desiredStart: `${row.desired_start_year}-${String(row.desired_start_month).padStart(2, '0')}`,
    status: row.status,
  };
}

function toDetail(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    name: decryptField(row.name_enc),
    birthdate: decryptField(row.birthdate_enc),
    phone: decryptField(row.phone_enc),
    emergencyPhone: decryptField(row.emergency_phone_enc),
    address: decryptField(row.address_enc),
    naturelinkMember: !!row.naturelove_member,
    monthlyCurrencyAmount: row.monthly_currency_amount,
    desiredPaymentAmount: row.desired_payment_amount,
    desiredStartYear: row.desired_start_year,
    desiredStartMonth: row.desired_start_month,
    proxyWriter: decryptField(row.proxy_writer_enc),
    signature: decryptField(row.signature_enc),
    privacyAgreed: !!row.privacy_agreed,
    termsAgreed: !!row.terms_agreed,
    consentIp: row.consent_ip,
    consentUserAgent: row.consent_user_agent,
    consentAt: row.consent_at,
    status: row.status,
    memo: row.memo,
  };
}

// 이하 관리자(접수 담당) 전용: 목록은 마스킹된 값만 반환, 상세는 열람 로그를 남긴다.
router.get('/', requireAdminAuth, (req, res) => {
  const { status } = req.query;
  let rows;
  if (status && VALID_STATUSES.includes(status)) {
    rows = db.prepare('SELECT * FROM applications WHERE status = ? ORDER BY id DESC').all(status);
  } else {
    rows = db.prepare('SELECT * FROM applications ORDER BY id DESC').all();
  }
  logAccess(req.admin.username, null, 'LIST');
  res.json(rows.map(toListItem));
});

router.get('/:id', requireAdminAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '신청 내역을 찾을 수 없습니다.' });
  logAccess(req.admin.username, row.id, 'VIEW_DETAIL');
  res.json(toDetail(row));
});

router.patch('/:id/status', requireAdminAuth, (req, res) => {
  const { status, memo } = req.body || {};
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `상태값은 ${VALID_STATUSES.join(', ')} 중 하나여야 합니다.` });
  }
  const result = db
    .prepare('UPDATE applications SET status = ?, memo = COALESCE(?, memo) WHERE id = ?')
    .run(status, memo ?? null, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: '신청 내역을 찾을 수 없습니다.' });
  logAccess(req.admin.username, req.params.id, `STATUS_CHANGE:${status}`);
  res.json({ ok: true });
});

// 제7조 2항(목적 달성 후 파기)에 따른 개인정보 파기
router.delete('/:id', requireAdminAuth, (req, res) => {
  const result = db.prepare('DELETE FROM applications WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: '신청 내역을 찾을 수 없습니다.' });
  logAccess(req.admin.username, req.params.id, 'PURGE');
  res.json({ ok: true });
});

module.exports = router;
