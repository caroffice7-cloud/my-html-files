'use strict';

/**
 * 판매수수료율 결정 규칙
 *   1) 상품에 개별 수수료율이 지정되어 있으면 그 값 (건바이건 협의 결과)
 *   2) 없으면 공급처 계약의 기본 수수료율
 *   3) 둘 다 없으면 미확정 → 0% 로 계산하고 화면에 경고를 띄운다
 */

const { get, run } = require('../db');

function contractOf(supplierId) {
  return get('SELECT * FROM supplier_contracts WHERE supplier_id = ? ORDER BY id DESC', supplierId);
}

/** @returns {{rate:number, source:'상품 개별'|'공급처 계약'|'미확정', confirmed:boolean}} */
function effectiveRate(product) {
  if (product && product.commission_rate != null) {
    return { rate: product.commission_rate, source: '상품 개별', confirmed: true };
  }
  const contract = product ? contractOf(product.supplier_id) : null;
  if (contract && contract.commission_rate != null) {
    return { rate: contract.commission_rate, source: '공급처 계약', confirmed: true };
  }
  return { rate: 0, source: '미확정', confirmed: false };
}

/** 0~1 사이의 비율로 정규화한다. 빈 값이면 null(미지정). */
function normalizeRate(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  // 1보다 크면 퍼센트로 입력한 것으로 보고 100으로 나눈다 (25 → 0.25)
  const rate = n > 1 ? n / 100 : n;
  return Math.min(1, Math.round(rate * 10000) / 10000);
}

function logChange({ supplierId, productId, scope, oldRate, newRate, memo }) {
  if (oldRate === newRate) return;
  run(
    'INSERT INTO commission_logs(supplier_id, product_id, scope, old_rate, new_rate, memo) VALUES(?,?,?,?,?,?)',
    supplierId ?? null, productId ?? null, scope, oldRate ?? null, newRate ?? null, memo || null
  );
}

module.exports = { effectiveRate, normalizeRate, logChange, contractOf };
