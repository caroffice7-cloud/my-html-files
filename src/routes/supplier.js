'use strict';

/** 공급처(농가·소상공인) 화면 API — 상품 등록과 본인 판매 현황 */

const { get, all, run, tx } = require('../db');
const { Router, readJson, sendJson, HttpError, UPLOAD_MAX_BODY } = require('../lib/http');
const auth = require('../lib/auth');
const { saveDataUrl, removeUpload } = require('../lib/upload');
const { effectiveRate } = require('../lib/commission');
const { CHANNELS } = require('../seed');

const router = new Router();
const EDITABLE_STATUS = ['승인대기', '반려', '판매중', '품절', '판매중지'];

function publicSupplier(s) {
  return {
    id: s.id, name: s.name, ceo: s.ceo, bizNo: s.biz_no, taxType: s.tax_type,
    address: s.address, phone: s.phone, email: s.email, intro: s.intro, status: s.status, loginId: s.login_id,
  };
}

function contractOf(supplierId) {
  return get('SELECT * FROM supplier_contracts WHERE supplier_id = ? ORDER BY id DESC', supplierId);
}

router.post('/api/supplier/login', async (req, res) => {
  const body = await readJson(req);
  const supplier = auth.supplierLogin(res, body.loginId, body.password, req);
  sendJson(res, 200, { ok: true, supplier: publicSupplier(supplier) });
});

router.post('/api/supplier/logout', (req, res) => {
  auth.supplierLogout(req, res);
  sendJson(res, 200, { ok: true });
});

router.get('/api/supplier/me', (req, res) => {
  const supplier = auth.currentSupplier(req);
  if (!supplier) return sendJson(res, 200, { authenticated: false });
  sendJson(res, 200, {
    authenticated: true,
    supplier: publicSupplier(supplier),
    contract: contractOf(supplier.id),
    channels: CHANNELS,
  });
});

router.put('/api/supplier/me', async (req, res) => {
  const supplier = auth.requireSupplier(req);
  const b = await readJson(req);
  run('UPDATE suppliers SET phone = ?, email = ?, intro = ?, address = ? WHERE id = ?',
    b.phone ?? supplier.phone, b.email ?? supplier.email, b.intro ?? supplier.intro,
    b.address ?? supplier.address, supplier.id);
  sendJson(res, 200, { ok: true });
});

router.post('/api/supplier/password', async (req, res) => {
  const supplier = auth.requireSupplier(req);
  const b = await readJson(req);
  if (!auth.verifyPassword(b.current || '', supplier.password_hash, supplier.password_salt)) {
    throw new HttpError(401, '현재 비밀번호가 올바르지 않습니다.');
  }
  if (String(b.next || '').length < 8) throw new HttpError(400, '새 비밀번호는 8자 이상이어야 합니다.');
  const { hash, salt } = auth.hashPassword(b.next);
  run('UPDATE suppliers SET password_hash = ?, password_salt = ? WHERE id = ?', hash, salt, supplier.id);
  sendJson(res, 200, { ok: true });
});

// ── 상품 ──
function productWithExtras(p) {
  const eff = effectiveRate(p);
  return {
    ...p,
    effective_rate: eff.rate,
    rate_source: eff.source,
    rate_confirmed: eff.confirmed,
    images: all('SELECT id, url, sort_order FROM product_images WHERE product_id = ? ORDER BY sort_order, id', p.id),
    channels: all('SELECT channel, listed, channel_price, channel_url FROM channel_listings WHERE product_id = ?', p.id),
    soldQty: get(`SELECT IFNULL(SUM(oi.qty),0) AS q FROM order_items oi JOIN orders o ON o.id = oi.order_id
                  WHERE oi.product_id = ? AND o.status != '반품'`, p.id).q,
  };
}

router.get('/api/supplier/products', (req, res) => {
  const supplier = auth.requireSupplier(req);
  sendJson(res, 200, {
    products: all('SELECT * FROM products WHERE supplier_id = ? ORDER BY id DESC', supplier.id).map(productWithExtras),
  });
});

function readProductBody(b) {
  return {
    name: String(b.name || '').trim(),
    category: b.category || null,
    spec: b.spec || null,
    grade: b.grade || null,
    origin: b.origin || null,
    shelfLife: b.shelfLife || null,
    storage: b.storage || null,
    ingredients: b.ingredients || null,
    noticeItems: b.noticeItems || null,
    description: b.description || null,
    supplyPrice: Math.max(0, Number(b.supplyPrice || 0)),
    suggestedPrice: Math.max(0, Number(b.suggestedPrice || 0)),
    stock: Math.max(0, Number(b.stock || 0)),
    shippingFee: Math.max(0, Number(b.shippingFee || 0)),
    freeShipOver: Math.max(0, Number(b.freeShipOver || 0)),
  };
}

router.post('/api/supplier/products', async (req, res) => {
  const supplier = auth.requireSupplier(req);
  const b = await readJson(req, UPLOAD_MAX_BODY);
  const p = readProductBody(b);
  if (!p.name) throw new HttpError(400, '상품명을 입력해 주세요.');

  const id = tx(() => {
    const ins = run(
      `INSERT INTO products(supplier_id, name, category, spec, grade, origin, shelf_life, storage, ingredients,
                            notice_items, description, supply_price, suggested_price, stock, shipping_fee, free_ship_over, status)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'승인대기')`,
      supplier.id, p.name, p.category, p.spec, p.grade, p.origin, p.shelfLife, p.storage, p.ingredients,
      p.noticeItems, p.description, p.supplyPrice, p.suggestedPrice, p.stock, p.shippingFee, p.freeShipOver
    );
    const pid = Number(ins.lastInsertRowid);
    for (const ch of CHANNELS) run('INSERT INTO channel_listings(product_id, channel, listed) VALUES(?,?,0)', pid, ch);
    saveImages(pid, b.images);
    return pid;
  });
  sendJson(res, 201, { ok: true, id });
});

router.put('/api/supplier/products/:id', async (req, res, ctx) => {
  const supplier = auth.requireSupplier(req);
  const product = get('SELECT * FROM products WHERE id = ? AND supplier_id = ?', Number(ctx.params.id), supplier.id);
  if (!product) throw new HttpError(404, '상품을 찾을 수 없습니다.');
  const b = await readJson(req, UPLOAD_MAX_BODY);
  const p = readProductBody({ ...product, ...b, supplyPrice: b.supplyPrice ?? product.supply_price,
    suggestedPrice: b.suggestedPrice ?? product.suggested_price, stock: b.stock ?? product.stock,
    shippingFee: b.shippingFee ?? product.shipping_fee, freeShipOver: b.freeShipOver ?? product.free_ship_over,
    shelfLife: b.shelfLife ?? product.shelf_life, noticeItems: b.noticeItems ?? product.notice_items });
  if (!p.name) throw new HttpError(400, '상품명을 입력해 주세요.');

  // 판매중이던 상품의 내용을 고치면 다시 검수를 받는다. 재고·품절 전환은 그대로 둔다.
  const contentChanged = ['name', 'category', 'spec', 'origin', 'description', 'ingredients', 'noticeItems']
    .some((k) => b[k] !== undefined);
  const nextStatus = product.status === '판매중' && contentChanged ? '승인대기' : product.status;

  tx(() => {
    run(
      `UPDATE products SET name=?, category=?, spec=?, grade=?, origin=?, shelf_life=?, storage=?, ingredients=?,
              notice_items=?, description=?, supply_price=?, suggested_price=?, stock=?, shipping_fee=?, free_ship_over=?,
              status=?, updated_at=datetime('now','localtime') WHERE id = ?`,
      p.name, p.category, p.spec, p.grade, p.origin, p.shelfLife, p.storage, p.ingredients,
      p.noticeItems, p.description, p.supplyPrice, p.suggestedPrice, p.stock, p.shippingFee, p.freeShipOver,
      nextStatus, product.id
    );
    saveImages(product.id, b.images);
  });
  sendJson(res, 200, { ok: true, status: nextStatus, requiresReview: nextStatus !== product.status });
});

/** 승인 요청(반려된 상품 재제출) */
router.post('/api/supplier/products/:id/submit', (req, res, ctx) => {
  const supplier = auth.requireSupplier(req);
  const product = get('SELECT * FROM products WHERE id = ? AND supplier_id = ?', Number(ctx.params.id), supplier.id);
  if (!product) throw new HttpError(404, '상품을 찾을 수 없습니다.');
  if (!product.suggested_price) throw new HttpError(400, '권장판매가를 입력한 뒤 승인 요청해 주세요.');
  run("UPDATE products SET status = '승인대기', reject_reason = NULL, updated_at = datetime('now','localtime') WHERE id = ?", product.id);
  sendJson(res, 200, { ok: true });
});

/** 품절 / 판매재개 등 공급처가 직접 바꿀 수 있는 상태 */
router.patch('/api/supplier/products/:id/status', async (req, res, ctx) => {
  const supplier = auth.requireSupplier(req);
  const body = await readJson(req);
  const status = String(body.status || '');
  if (!['품절', '판매중', '판매중지'].includes(status)) throw new HttpError(400, '변경할 수 없는 상태입니다.');
  const product = get('SELECT * FROM products WHERE id = ? AND supplier_id = ?', Number(ctx.params.id), supplier.id);
  if (!product) throw new HttpError(404, '상품을 찾을 수 없습니다.');
  if (!EDITABLE_STATUS.includes(product.status)) throw new HttpError(400, '지금은 상태를 바꿀 수 없습니다.');
  if (status === '판매중' && !['품절', '판매중지'].includes(product.status)) {
    throw new HttpError(400, '승인을 받은 뒤에 판매를 시작할 수 있습니다.');
  }
  run("UPDATE products SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?", status, product.id);
  sendJson(res, 200, { ok: true, status });
});

router.delete('/api/supplier/products/:id/images/:imageId', (req, res, ctx) => {
  const supplier = auth.requireSupplier(req);
  const image = get(
    `SELECT pi.* FROM product_images pi JOIN products p ON p.id = pi.product_id
     WHERE pi.id = ? AND p.supplier_id = ?`, Number(ctx.params.imageId), supplier.id);
  if (!image) throw new HttpError(404, '이미지를 찾을 수 없습니다.');
  run('DELETE FROM product_images WHERE id = ?', image.id);
  removeUpload(image.url);
  sendJson(res, 200, { ok: true });
});

const MAX_IMAGES_PER_REQUEST = 8;

function saveImages(productId, images) {
  if (!Array.isArray(images) || !images.length) return;
  if (images.length > MAX_IMAGES_PER_REQUEST) {
    throw new HttpError(400, `사진은 한 번에 ${MAX_IMAGES_PER_REQUEST}장까지 올릴 수 있습니다.`);
  }
  const base = get('SELECT IFNULL(MAX(sort_order), 0) AS n FROM product_images WHERE product_id = ?', productId).n;
  images.forEach((dataUrl, i) => {
    const url = saveDataUrl(dataUrl);
    run('INSERT INTO product_images(product_id, url, sort_order) VALUES(?,?,?)', productId, url, base + i + 1);
  });
}

// ── 판매 현황 / 정산 예정 ──
router.get('/api/supplier/sales', (req, res, ctx) => {
  const supplier = auth.requireSupplier(req);
  const from = ctx.query.get('from') || monthStart();
  const to = ctx.query.get('to') || monthEnd();

  const rows = all(
    `SELECT o.order_no, o.created_at, o.status, o.channel, o.customer_name,
            oi.name, oi.spec, oi.qty, oi.unit_price, oi.subtotal, oi.commission_rate, oi.commission_amt,
            oi.settle_amt, oi.refunded, oi.tracking_no, oi.settlement_id
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.supplier_id = ? AND date(o.created_at) BETWEEN date(?) AND date(?)
     ORDER BY o.id DESC`,
    supplier.id, from, to
  );

  const valid = rows.filter((r) => !r.refunded && r.status !== '반품');
  const totals = {
    orders: new Set(valid.map((r) => r.order_no)).size,
    sales: valid.reduce((a, b) => a + b.subtotal, 0),
    commission: valid.reduce((a, b) => a + b.commission_amt, 0),
    refund: rows.filter((r) => r.refunded || r.status === '반품').reduce((a, b) => a + b.subtotal, 0),
  };
  totals.payout = valid.reduce((a, b) => a + b.settle_amt, 0);

  sendJson(res, 200, {
    from, to, rows, totals,
    contract: contractOf(supplier.id),
    settlements: all('SELECT * FROM settlements WHERE supplier_id = ? ORDER BY id DESC LIMIT 12', supplier.id),
    pendingOrders: all(
      `SELECT o.order_no, o.created_at, o.status, o.customer_name, o.customer_phone, o.address, o.address_detail,
              oi.id AS item_id, oi.name, oi.spec, oi.qty, oi.tracking_no
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE oi.supplier_id = ? AND o.status IN ('공급처전달','출고') ORDER BY o.id DESC`, supplier.id),
  });
});

/** 공급처가 송장번호를 입력하면 해당 주문을 출고 처리한다. */
router.post('/api/supplier/tracking', async (req, res) => {
  const supplier = auth.requireSupplier(req);
  const b = await readJson(req);
  const item = get(
    `SELECT oi.*, o.status AS order_status FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.id = ? AND oi.supplier_id = ?`, Number(b.itemId), supplier.id);
  if (!item) throw new HttpError(404, '해당 주문 항목을 찾을 수 없습니다.');
  const tracking = String(b.trackingNo || '').trim();
  if (!tracking) throw new HttpError(400, '송장번호를 입력해 주세요.');

  tx(() => {
    run('UPDATE order_items SET tracking_no = ? WHERE id = ?', tracking, item.id);
    const remaining = get(
      "SELECT COUNT(*) AS c FROM order_items WHERE order_id = ? AND (tracking_no IS NULL OR tracking_no = '')", item.order_id).c;
    if (remaining === 0 && item.order_status === '공급처전달') {
      run("UPDATE orders SET status = '출고', updated_at = datetime('now','localtime') WHERE id = ?", item.order_id);
      run('INSERT INTO order_logs(order_id, from_status, to_status, memo) VALUES(?,?,?,?)',
        item.order_id, '공급처전달', '출고', `공급처 송장 입력 (${tracking})`);
    }
  });
  sendJson(res, 200, { ok: true });
});

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function monthEnd() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

module.exports = { router, monthStart, monthEnd, publicSupplier };
