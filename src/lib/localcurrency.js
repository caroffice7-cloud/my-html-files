'use strict';

/**
 * 보성군 지역화폐 결제 결합.
 *
 * 카드형 지역화폐는 가맹점 단말기 결제가 원칙이라 1단계에서는 온라인 즉시승인 대신
 * "지역화폐 결제요청 접수 → 담당자 결제 진행 → 승인번호 입력으로 결제확인" 흐름을 쓴다.
 * PG 연동이 열리면 confirm() 앞단만 교체하면 되도록 판정 로직을 이 파일에 모아 둔다.
 */

const { get, setting } = require('../db');

const BANK = '무통장입금';
const LOCAL = '보성 지역화폐';
const PAY_METHODS = [BANK, LOCAL];

/** 결제 진행 방식 — 어르신·관내 주민은 대면 결제가 현실적이다 */
const CHARGE_TYPES = ['방문 카드단말기', '매장 방문 결제', '모바일 결제요청'];

function flag(key, fallback) {
  return setting(key, fallback) === '1';
}

/** 운영자 설정에 저장된 지역화폐 운영 조건 */
function config() {
  return {
    enabled: flag('local_currency_enabled', '1'),
    name: setting('local_currency_name', '보성사랑상품권(카드형)'),
    merchantNo: setting('local_currency_merchant_no', ''),
    coversShipping: flag('local_currency_covers_shipping', '1'),
    maxPerOrder: Number(setting('local_currency_max_per_order', '0')) || 0,
    notice: setting(
      'local_currency_notice',
      '주문을 접수하면 담당자가 연락드려 지역화폐 카드로 결제를 도와드립니다. 결제가 확인되면 공급처로 전달되어 발송됩니다.'
    ),
    chargeTypes: CHARGE_TYPES,
  };
}

/**
 * 상품 한 건의 지역화폐 사용 가능 여부.
 * 상품 개별 설정 → 공급처 설정 순으로 판정한다(수수료율과 같은 2단계 구조).
 */
function eligibilityOf(product) {
  if (!product) return { usable: false, source: '상품 없음' };
  if (product.local_currency != null) {
    return { usable: !!product.local_currency, source: '상품 개별 설정' };
  }
  const supplier = get('SELECT name, local_currency FROM suppliers WHERE id = ?', product.supplier_id);
  if (!supplier) return { usable: false, source: '공급처 없음' };
  // 컬럼이 없던 시절의 데이터는 NULL 이 올 수 있어 기본값을 사용 가능으로 본다.
  const usable = supplier.local_currency == null ? true : !!supplier.local_currency;
  return { usable, source: '공급처 가맹 설정', supplierName: supplier.name };
}

/**
 * 장바구니 전체가 지역화폐로 결제 가능한지 판정한다.
 * 지역화폐는 한 건을 쪼개 결제하기 어려우므로 담긴 상품이 모두 사용 가능할 때만 허용한다.
 */
function checkCart(lines, amounts) {
  const cfg = config();
  if (!cfg.enabled) {
    return { eligible: false, reason: '현재 지역화폐 결제를 받지 않고 있습니다.', blocked: [], payable: 0, config: cfg };
  }

  const blocked = [];
  for (const line of lines || []) {
    const product = get('SELECT id, supplier_id, local_currency FROM products WHERE id = ?', line.productId);
    const verdict = eligibilityOf(product);
    if (!verdict.usable) blocked.push({ name: line.name, reason: verdict.source });
  }

  const goods = Number(amounts?.goods || 0);
  const shipping = Number(amounts?.shipping || 0);
  const payable = cfg.coversShipping ? goods + shipping : goods;

  if (blocked.length) {
    const names = blocked.map((b) => b.name).join(', ');
    return {
      eligible: false,
      reason: `${names} 은(는) 지역화폐로 결제할 수 없는 상품입니다. 따로 주문해 주세요.`,
      blocked, payable, config: cfg,
    };
  }
  if (cfg.maxPerOrder > 0 && payable > cfg.maxPerOrder) {
    return {
      eligible: false,
      reason: `지역화폐는 1회 ${cfg.maxPerOrder.toLocaleString('ko-KR')}원까지 결제할 수 있습니다.`,
      blocked, payable, config: cfg,
    };
  }
  return { eligible: true, reason: '', blocked: [], payable, config: cfg };
}

/** 클라이언트가 보낸 결제수단을 허용된 값으로만 좁힌다 */
function normalizePayMethod(value) {
  const v = String(value || '').trim();
  return PAY_METHODS.includes(v) ? v : BANK;
}

function isLocal(payMethod) {
  return payMethod === LOCAL;
}

/** 주문 완료 화면에 띄울 결제 안내문 */
function guidanceFor(payMethod, amounts) {
  const cfg = config();
  if (!isLocal(payMethod)) {
    return {
      title: BANK,
      detail: setting('bank_account', '') || '입금 계좌는 주문 후 문자로 안내드립니다.',
      message: '주문이 접수되었습니다. 입금이 확인되면 공급처로 전달되어 발송됩니다.',
    };
  }
  const payable = cfg.coversShipping
    ? Number(amounts?.total || 0)
    : Number(amounts?.goods || 0);
  const shippingNote = cfg.coversShipping
    ? '배송비를 포함한 전액을 지역화폐로 결제합니다.'
    : '배송비는 지역화폐 결제 대상이 아니어서 따로 받습니다.';
  return {
    title: `${cfg.name} 결제`,
    detail: `결제 예정 금액 ${payable.toLocaleString('ko-KR')}원 · ${shippingNote}`,
    message: cfg.notice,
  };
}

module.exports = {
  BANK, LOCAL, PAY_METHODS, CHARGE_TYPES,
  config, eligibilityOf, checkCart, normalizePayMethod, isLocal, guidanceFor,
};
