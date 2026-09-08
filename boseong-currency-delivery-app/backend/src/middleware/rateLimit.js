const rateLimit = require('express-rate-limit');

// 신청서 제출 폭주(장난/봇) 방지: 동일 IP 15분당 10건
const applicationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '신청 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' },
});

// 관리자 로그인 무차별 대입 방지: 동일 IP 15분당 5회
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '로그인 시도가 너무 잦습니다. 잠시 후 다시 시도해 주세요.' },
});

module.exports = { applicationLimiter, loginLimiter };
