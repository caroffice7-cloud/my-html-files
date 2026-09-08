const MAX_MONTHLY_AMOUNT = 200000;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPhone(v) {
  return typeof v === 'string' && /^[0-9-]{9,14}$/.test(v.trim());
}

function isBirthdate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

// 신청서 1페이지 각 항목 및 동의 여부(제3항)를 검증한다.
function validateApplication(body) {
  const errors = [];

  if (!isNonEmptyString(body.name)) errors.push('성명을 입력해 주세요.');
  if (!isBirthdate(body.birthdate)) errors.push('생년월일 형식이 올바르지 않습니다 (YYYY-MM-DD).');
  if (!isPhone(body.phone)) errors.push('연락처(본인) 형식이 올바르지 않습니다.');
  if (body.emergencyPhone && !isPhone(body.emergencyPhone)) {
    errors.push('비상연락처 형식이 올바르지 않습니다.');
  }
  if (!isNonEmptyString(body.address)) errors.push('배송지 주소를 입력해 주세요.');

  if (typeof body.naturelinkMember !== 'boolean') {
    errors.push('자연사랑 모임 소속 여부를 선택해 주세요.');
  }

  const desiredAmount = Number(body.desiredPaymentAmount);
  if (!Number.isFinite(desiredAmount) || desiredAmount <= 0) {
    errors.push('참여 희망 결제 금액을 입력해 주세요.');
  } else if (desiredAmount > MAX_MONTHLY_AMOUNT) {
    errors.push(`참여 희망 결제 금액은 월 ${MAX_MONTHLY_AMOUNT.toLocaleString()}원 이내여야 합니다.`);
  }

  if (body.monthlyCurrencyAmount !== undefined && body.monthlyCurrencyAmount !== null && body.monthlyCurrencyAmount !== '') {
    const monthly = Number(body.monthlyCurrencyAmount);
    if (!Number.isFinite(monthly) || monthly < 0) errors.push('월 지역화폐 수령액이 올바르지 않습니다.');
  }

  const year = Number(body.desiredStartYear);
  const month = Number(body.desiredStartMonth);
  if (!Number.isInteger(year) || year < 2024 || year > 2100) errors.push('참여 희망 시작 연도가 올바르지 않습니다.');
  if (!Number.isInteger(month) || month < 1 || month > 12) errors.push('참여 희망 시작 월이 올바르지 않습니다.');

  if (!isNonEmptyString(body.signature)) errors.push('전자서명을 입력해 주세요.');

  if (body.privacyAgreed !== true) errors.push('개인정보 수집·이용에 동의해야 신청할 수 있습니다.');
  if (body.termsAgreed !== true) errors.push('이용약관에 동의해야 신청할 수 있습니다.');

  return errors;
}

module.exports = { validateApplication, MAX_MONTHLY_AMOUNT };
