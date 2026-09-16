'use strict';

/** 관리자(히스메이커스) 통합 관리 API */

const { get, all, run, tx, setting, setSetting } = require('../db');
const { Router, readJson, sendJson, sendCsv, HttpError } = require('../lib/http');
const auth = require('../lib/auth');
const { toCsv } = require('../lib/csv');
const { CHANNELS } = require('../seed');
const { normalizePhone, nextOrderNo } = require('./shop');
const { monthStart, monthEnd } = require('./supplier');

const router = new Router();
const ORDER_STATUSES = ['주문접수', '공급처전달', '출고', '배송중', '완료', '반품'];
const PRODUCT_STATUSES = ['승인대기', '판매중', '반려', '품절', '판매중지'];
const REFUND_BEARERS = ['공급처', '소비자', '히스메이커스'];
const REFUND_REASONS = ['상품 하자', '오배송', '표시·광고 상이', '단순 변심', '상품정보 오기재', '주문 전달 누락'];

// ── 인증 ──
router.post('/api/admin/login', async (req, res) => {
  const b = await readJson(req);
  auth.adminLogin(res, b.password);
  sendJson(res, 200, { ok: true });
});
router.post('/api/admin/logout', (req, res) => {
  auth.adminLogout(req, res);
  sendJson(res, 200, { ok: true });
});
router.get('/api/admin/me', (req, res) => {
  sendJson(res, 200, { authenticated: !!auth.currentAdmin(req), channels: CHANNELS, orderStatuses: ORDER_STATUSES, refundBearers: REFUND_BEARERS, refundReasons: REFUND_REASONS });
});

// ── 대시보드 ──
router.get('/api/admin/dashboard', (req, res) => {
  auth.requireAdmin(req);
  const from = monthStart(), to = monthEnd();
  const sales = get(
    `SELECT IFNULL(SUM(oi.subtotal),0) AS sales, IFNULL(SUM(oi.commission_amt),0) AS commission
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.status != '반품' AND oi.refunded = 0 AND date(o.created_at) BETWEEN date(?) AND date(?)`, from, to);

  sendJson(res, 200, {
    period: { from, to },
    counts: {
      suppliers: get("SELECT COUNT(*) AS c FROM suppliers WHERE status = '계약중'").c,
      productsPending: get("SELECT COUNT(*) AS c FROM products WHERE status = '승인대기'").c,
      productsOnSale: get("SELECT COUNT(*) AS c FROM products WHERE status = '판매중'").c,
      ordersToForward: get("SELECT COUNT(*) AS c FROM orders WHERE status = '주문접수'").c,
      ordersInProgress: get("SELECT COUNT(*) AS c FROM orders WHERE status IN ('공급처전달','출고','배송중')").c,
    },
    sales: { ...sales, net: sales.sales - sales.commission },
    byStatus: all('SELECT status, COUNT(*) AS c, IFNULL(SUM(total_amount),0) AS amount FROM orders GROUP BY status'),
    byChannel: all(
      `SELECT o.channel, COUNT(DISTINCT o.id) AS orders, IFNULL(SUM(oi.subtotal),0) AS amount
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
       WHERE o.status != '반품' GROUP BY o.channel`),
    bySupplier: all(
      `SELECT s.id, s.name, COUNT(DISTINCT o.id) AS orders, IFNULL(SUM(oi.subtotal),0) AS sales,
              IFNULL(SUM(oi.commission_amt),0) AS commission, IFNULL(SUM(oi.settle_amt),0) AS payout
       FROM suppliers s
       LEFT JOIN order_items oi ON oi.supplier_id = s.id AND oi.refunded = 0
       LEFT JOIN orders o ON o.id = oi.order_id AND o.status != '반품'
       GROUP BY s.id ORDER BY sales DESC`),
    pendingProducts: all(
      `SELECT p.id, p.name, p.suggested_price, p.created_at, s.name AS supplier_name
       FROM products p JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.status = '승인대기' ORDER BY p.id DESC LIMIT 10`),
  });
});

// ── 상품 통합 관리 ──
function adminProduct(p) {
  return {
    ...p,
    supplier_name: get('SELECT name FROM suppliers WHERE id = ?', p.supplier_id)?.name,
    images: all('SELECT id, url FROM product_images WHERE product_id = ? ORDER BY sort_order, id', p.id),
    channels: all('SELECT * FROM channel_listings WHERE product_id = ?', p.id),
  };
}

router.get('/api/admin/products', (req, res, ctx) => {
  auth.requireAdmin(req);
  const where = [], params = [];
  if (ctx.query.get('status')) { where.push('p.status = ?'); params.push(ctx.query.get('status')); }
  if (ctx.query.get('supplierId')) { where.push('p.supplier_id = ?'); params.push(Number(ctx.query.get('supplierId'))); }
  if (ctx.query.get('q')) { where.push('(p.name LIKE ? OR p.category LIKE ?)'); const k = `%${ctx.query.get('q')}%`; params.push(k, k); }
  const sql = `SELECT p.* FROM products p ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC`;
  sendJson(res, 200, {
    statuses: PRODUCT_STATUSES,
    channels: CHANNELS,
    products: all(sql, ...params).map(adminProduct),
  });
});

router.patch('/api/admin/products/:id/approve', async (req, res, ctx) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const product = get('SELECT * FROM products WHERE id = ?', Number(ctx.params.id));
  if (!product) throw new HttpError(404, '상품을 찾을 수 없습니다.');

  if (b.approve) {
    if (!product.suggested_price) throw new HttpError(400, '권장판매가가 입력되지 않은 상품은 승인할 수 없습니다.');
    tx(() => {
      run("UPDATE products SET status = '판매중', reject_reason = NULL, updated_at = datetime('now','localtime') WHERE id = ?", product.id);
      // 승인 시 자사몰 채널은 기본 노출로 둔다(외부 채널은 관리자가 따로 켠다).
      run(`INSERT INTO channel_listings(product_id, channel, listed) VALUES(?, '자사몰', 1)
           ON CONFLICT(product_id, channel) DO UPDATE SET listed = 1, updated_at = datetime('now','localtime')`, product.id);
    });
    return sendJson(res, 200, { ok: true, status: '판매중' });
  }

  const reason = String(b.reason || '').trim();
  if (!reason) throw new HttpError(400, '반려 사유를 입력해 주세요. (공급처 화면에 그대로 표시됩니다)');
  run("UPDATE products SET status = '반려', reject_reason = ?, updated_at = datetime('now','localtime') WHERE id = ?", reason, product.id);
  sendJson(res, 200, { ok: true, status: '반려' });
});

router.put('/api/admin/products/:id', async (req, res, ctx) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const p = get('SELECT * FROM products WHERE id = ?', Number(ctx.params.id));
  if (!p) throw new HttpError(404, '상품을 찾을 수 없습니다.');
  run(
    `UPDATE products SET name=?, category=?, spec=?, origin=?, shelf_life=?, storage=?, ingredients=?, notice_items=?,
            description=?, supply_price=?, suggested_price=?, stock=?, shipping_fee=?, free_ship_over=?, status=?,
            updated_at=datetime('now','localtime') WHERE id = ?`,
    b.name ?? p.name, b.category ?? p.category, b.spec ?? p.spec, b.origin ?? p.origin,
    b.shelfLife ?? p.shelf_life, b.storage ?? p.storage, b.ingredients ?? p.ingredients,
    b.noticeItems ?? p.notice_items, b.description ?? p.description,
    Number(b.supplyPrice ?? p.supply_price), Number(b.suggestedPrice ?? p.suggested_price),
    Number(b.stock ?? p.stock), Number(b.shippingFee ?? p.shipping_fee), Number(b.freeShipOver ?? p.free_ship_over),
    b.status && PRODUCT_STATUSES.includes(b.status) ? b.status : p.status, p.id
  );
  sendJson(res, 200, { ok: true });
});

/** 채널 연동 설정 — 계약서의 할인 허용 한도를 여기서 강제한다. */
router.put('/api/admin/products/:id/channels', async (req, res, ctx) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const product = get('SELECT * FROM products WHERE id = ?', Number(ctx.params.id));
  if (!product) throw new HttpError(404, '상품을 찾을 수 없습니다.');
  if (!CHANNELS.includes(b.channel)) throw new HttpError(400, '알 수 없는 채널입니다.');

  const price = b.channelPrice === '' || b.channelPrice == null ? null : Number(b.channelPrice);
  if (price != null && price > 0 && product.suggested_price > 0) {
    const contract = get('SELECT * FROM supplier_contracts WHERE supplier_id = ? ORDER BY id DESC', product.supplier_id);
    const limit = contract?.discount_limit_rate;
    if (limit != null) {
      const floor = Math.round(product.suggested_price * (1 - limit));
      if (price < floor && !b.force) {
        throw new HttpError(409,
          `권장판매가 ${product.suggested_price.toLocaleString('ko-KR')}원 대비 할인 허용 한도(${Math.round(limit * 100)}%)를 넘습니다. ` +
          `최저 ${floor.toLocaleString('ko-KR')}원까지 가능하며, 더 낮추려면 공급처 사전 동의를 받은 뒤 "동의 확인" 후 저장하세요.`);
      }
    }
  }

  run(
    `INSERT INTO channel_listings(product_id, channel, listed, channel_price, channel_url, channel_note, updated_at)
     VALUES(?,?,?,?,?,?,datetime('now','localtime'))
     ON CONFLICT(product_id, channel) DO UPDATE SET
       listed = excluded.listed, channel_price = excluded.channel_price,
       channel_url = excluded.channel_url, channel_note = excluded.channel_note,
       updated_at = datetime('now','localtime')`,
    product.id, b.channel, b.listed ? 1 : 0, price, b.channelUrl || null,
    b.force ? '할인 한도 초과 — 공급처 사전 동의 확인함' : (b.channelNote || null)
  );
  sendJson(res, 200, { ok: true });
});

// ── 공급처 · 계약 조건 ──
router.get('/api/admin/suppliers', (req, res) => {
  auth.requireAdmin(req);
  sendJson(res, 200, {
    suppliers: all('SELECT * FROM suppliers ORDER BY id').map((s) => ({
      id: s.id, name: s.name, ceo: s.ceo, bizNo: s.biz_no, taxType: s.tax_type, address: s.address,
      phone: s.phone, email: s.email, loginId: s.login_id, intro: s.intro, status: s.status,
      contract: get('SELECT * FROM supplier_contracts WHERE supplier_id = ? ORDER BY id DESC', s.id),
      productCount: get('SELECT COUNT(*) AS c FROM products WHERE supplier_id = ?', s.id).c,
    })),
  });
});

router.post('/api/admin/suppliers', async (req, res) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  if (!b.name) throw new HttpError(400, '상호를 입력해 주세요.');
  if (!b.loginId) throw new HttpError(400, '공급처 로그인 아이디를 입력해 주세요.');
  if (get('SELECT id FROM suppliers WHERE login_id = ?', b.loginId)) throw new HttpError(409, '이미 사용 중인 아이디입니다.');
  const password = String(b.password || '').trim() || `${b.loginId}2026`;
  const { hash, salt } = auth.hashPassword(password);

  const id = tx(() => {
    const ins = run(
      `INSERT INTO suppliers(name, ceo, biz_no, tax_type, address, phone, email, login_id, password_hash, password_salt, intro, status)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,'계약중')`,
      b.name, b.ceo || null, b.bizNo || null, b.taxType || null, b.address || null,
      b.phone || null, b.email || null, b.loginId, hash, salt, b.intro || null
    );
    const sid = Number(ins.lastInsertRowid);
    run(
      `INSERT INTO supplier_contracts(supplier_id, commission_rate, commission_note, settlement_cycle,
                                      shipping_method, ship_days, discount_limit_rate, note)
       VALUES(?,?,?,?,?,?,?,?)`,
      sid, b.commissionRate != null && b.commissionRate !== '' ? Number(b.commissionRate) : null,
      b.commissionNote || null, b.settlementCycle || '익월 15일',
      b.shippingMethod || '위탁배송(공급처 직발송)',
      b.shipDays != null && b.shipDays !== '' ? Number(b.shipDays) : null,
      b.discountLimitRate != null && b.discountLimitRate !== '' ? Number(b.discountLimitRate) : null,
      b.note || null
    );
    return sid;
  });
  sendJson(res, 201, { ok: true, id, password });
});

router.put('/api/admin/suppliers/:id', async (req, res, ctx) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const s = get('SELECT * FROM suppliers WHERE id = ?', Number(ctx.params.id));
  if (!s) throw new HttpError(404, '공급처를 찾을 수 없습니다.');
  run(
    'UPDATE suppliers SET name=?, ceo=?, biz_no=?, tax_type=?, address=?, phone=?, email=?, intro=?, status=? WHERE id = ?',
    b.name ?? s.name, b.ceo ?? s.ceo, b.bizNo ?? s.biz_no, b.taxType ?? s.tax_type, b.address ?? s.address,
    b.phone ?? s.phone, b.email ?? s.email, b.intro ?? s.intro, b.status ?? s.status, s.id
  );
  sendJson(res, 200, { ok: true });
});

router.put('/api/admin/suppliers/:id/contract', async (req, res, ctx) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const sid = Number(ctx.params.id);
  const c = get('SELECT * FROM supplier_contracts WHERE supplier_id = ? ORDER BY id DESC', sid);
  if (!c) throw new HttpError(404, '계약 조건을 찾을 수 없습니다.');
  const num = (v, fallback) => (v === '' || v == null ? fallback : Number(v));
  run(
    `UPDATE supplier_contracts SET commission_rate=?, commission_note=?, settlement_cycle=?, shipping_method=?,
            ship_days=?, discount_limit_rate=?, channel_fee_bearer=?, contract_start=?, contract_period=?, note=?,
            updated_at=datetime('now','localtime') WHERE id = ?`,
    b.commissionRate === '' ? null : num(b.commissionRate, c.commission_rate),
    b.commissionNote ?? c.commission_note, b.settlementCycle ?? c.settlement_cycle,
    b.shippingMethod ?? c.shipping_method,
    b.shipDays === '' ? null : num(b.shipDays, c.ship_days),
    b.discountLimitRate === '' ? null : num(b.discountLimitRate, c.discount_limit_rate),
    b.channelFeeBearer ?? c.channel_fee_bearer, b.contractStart ?? c.contract_start,
    b.contractPeriod ?? c.contract_period, b.note ?? c.note, c.id
  );
  sendJson(res, 200, { ok: true });
});

router.post('/api/admin/suppliers/:id/password', async (req, res, ctx) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const s = get('SELECT * FROM suppliers WHERE id = ?', Number(ctx.params.id));
  if (!s) throw new HttpError(404, '공급처를 찾을 수 없습니다.');
  const password = String(b.password || '').trim();
  if (password.length < 8) throw new HttpError(400, '비밀번호는 8자 이상이어야 합니다.');
  const { hash, salt } = auth.hashPassword(password);
  run('UPDATE suppliers SET password_hash = ?, password_salt = ? WHERE id = ?', hash, salt, s.id);
  sendJson(res, 200, { ok: true });
});

// ── 주문 통합 관리 ──
router.get('/api/admin/orders', (req, res, ctx) => {
  auth.requireAdmin(req);
  const where = [], params = [];
  if (ctx.query.get('status')) { where.push('o.status = ?'); params.push(ctx.query.get('status')); }
  if (ctx.query.get('channel')) { where.push('o.channel = ?'); params.push(ctx.query.get('channel')); }
  if (ctx.query.get('q')) {
    where.push('(o.customer_name LIKE ? OR o.customer_phone LIKE ? OR o.order_no LIKE ?)');
    const k = `%${ctx.query.get('q')}%`; params.push(k, k, k);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orders = all(`SELECT o.* FROM orders o ${whereSql} ORDER BY o.id DESC LIMIT 200`, ...params)
    .map((o) => ({ ...o, items: all('SELECT * FROM order_items WHERE order_id = ?', o.id) }));

  sendJson(res, 200, {
    statuses: ORDER_STATUSES, channels: CHANNELS,
    counts: Object.fromEntries(ORDER_STATUSES.map((s) => [s, get('SELECT COUNT(*) AS c FROM orders WHERE status = ?', s).c])),
    orders,
  });
});

router.get('/api/admin/orders/:id', (req, res, ctx) => {
  auth.requireAdmin(req);
  const order = get('SELECT * FROM orders WHERE id = ?', Number(ctx.params.id));
  if (!order) throw new HttpError(404, '주문을 찾을 수 없습니다.');
  sendJson(res, 200, {
    order,
    items: all(
      `SELECT oi.*, s.name AS supplier_name, s.phone AS supplier_phone
       FROM order_items oi LEFT JOIN suppliers s ON s.id = oi.supplier_id WHERE oi.order_id = ?`, order.id),
    logs: all('SELECT * FROM order_logs WHERE order_id = ? ORDER BY id', order.id),
  });
});

router.patch('/api/admin/orders/:id/status', async (req, res, ctx) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  if (!ORDER_STATUSES.includes(b.status)) throw new HttpError(400, `상태값이 올바르지 않습니다. (${ORDER_STATUSES.join(', ')})`);
  const order = get('SELECT * FROM orders WHERE id = ?', Number(ctx.params.id));
  if (!order) throw new HttpError(404, '주문을 찾을 수 없습니다.');
  if (order.status === b.status) return sendJson(res, 200, { ok: true, unchanged: true });

  tx(() => {
    run("UPDATE orders SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?", b.status, order.id);
    run('INSERT INTO order_logs(order_id, from_status, to_status, memo) VALUES(?,?,?,?)',
      order.id, order.status, b.status, b.memo || null);
    if (b.status === '반품') {
      // 계약서 제7조: 상품 하자·오배송은 공급처, 단순 변심은 소비자,
      // 상품정보 오기재·주문 전달 누락은 수탁자(히스메이커스)가 비용을 부담한다.
      const bearer = REFUND_BEARERS.includes(b.refundBearer) ? b.refundBearer : '소비자';
      run('UPDATE orders SET refund_reason = ?, refund_bearer = ?, refund_cost = ? WHERE id = ?',
        b.refundReason || null, bearer, Math.max(0, Number(b.refundCost || 0)), order.id);
      run('UPDATE order_items SET refunded = 1 WHERE order_id = ?', order.id);
      for (const it of all('SELECT product_id, qty FROM order_items WHERE order_id = ?', order.id)) {
        if (it.product_id) run('UPDATE products SET stock = stock + ? WHERE id = ?', it.qty, it.product_id);
      }
    }
    if (order.status === '반품' && b.status !== '반품') {
      run("UPDATE orders SET refund_reason = NULL, refund_bearer = NULL, refund_cost = 0 WHERE id = ?", order.id);
      run('UPDATE order_items SET refunded = 0 WHERE order_id = ?', order.id);
    }
  });
  sendJson(res, 200, { ok: true, status: b.status });
});

router.patch('/api/admin/orders/:id/paid', async (req, res, ctx) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const order = get('SELECT * FROM orders WHERE id = ?', Number(ctx.params.id));
  if (!order) throw new HttpError(404, '주문을 찾을 수 없습니다.');
  run("UPDATE orders SET paid = ?, updated_at = datetime('now','localtime') WHERE id = ?", b.paid ? 1 : 0, order.id);
  sendJson(res, 200, { ok: true });
});

/** 외부 채널(쿠팡 등) 주문 수동 입력 — 1단계는 API 연동 없이 관리자가 직접 등록 */
router.post('/api/admin/orders', async (req, res) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const channel = CHANNELS.includes(b.channel) ? b.channel : '쿠팡';
  const name = String(b.customerName || '').trim();
  if (!name) throw new HttpError(400, '주문자 이름을 입력해 주세요.');
  const rawItems = Array.isArray(b.items) ? b.items : [];
  if (!rawItems.length) throw new HttpError(400, '주문 상품을 한 가지 이상 선택해 주세요.');

  const lines = [];
  for (const raw of rawItems) {
    const product = get('SELECT * FROM products WHERE id = ?', Number(raw.productId));
    if (!product) continue;
    const qty = Math.max(1, Number(raw.qty) || 1);
    const listing = get('SELECT channel_price FROM channel_listings WHERE product_id = ? AND channel = ?', product.id, channel);
    const unit = Number(raw.unitPrice) || listing?.channel_price || product.suggested_price;
    const contract = get('SELECT * FROM supplier_contracts WHERE supplier_id = ? ORDER BY id DESC', product.supplier_id);
    const rate = contract?.commission_rate ?? 0;
    const subtotal = unit * qty;
    const commission = Math.round(subtotal * rate);
    lines.push({ product, qty, unit, subtotal, rate, commission, settle: subtotal - commission });
  }
  if (!lines.length) throw new HttpError(400, '유효한 상품이 없습니다.');

  const goods = lines.reduce((a, l) => a + l.subtotal, 0);
  const shipping = Number(b.shippingFee || 0);

  const orderNo = tx(() => {
    const no = b.externalNo ? `${channel}-${b.externalNo}` : nextOrderNo();
    const ins = run(
      `INSERT INTO orders(order_no, channel, customer_name, customer_phone, zipcode, address, address_detail, memo,
                          status, goods_amount, shipping_fee, total_amount, pay_method, paid, external_no)
       VALUES(?,?,?,?,?,?,?,?,'주문접수',?,?,?,?,1,?)`,
      no, channel, name, normalizePhone(b.customerPhone), b.zipcode || null, b.address || null,
      b.addressDetail || null, b.memo || null, goods, shipping, goods + shipping,
      `${channel} 결제`, b.externalNo || null
    );
    const orderId = Number(ins.lastInsertRowid);
    for (const l of lines) {
      run(
        `INSERT INTO order_items(order_id, product_id, supplier_id, name, spec, qty, unit_price, subtotal,
                                 commission_rate, commission_amt, settle_amt)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        orderId, l.product.id, l.product.supplier_id, l.product.name, l.product.spec, l.qty, l.unit,
        l.subtotal, l.rate, l.commission, l.settle
      );
      run('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ? AND stock > 0', l.qty, l.product.id);
    }
    run('INSERT INTO order_logs(order_id, from_status, to_status, memo) VALUES(?,?,?,?)',
      orderId, null, '주문접수', `${channel} 주문 수동 등록`);
    return no;
  });

  sendJson(res, 201, { ok: true, orderNo, goods, shipping, total: goods + shipping });
});

// ── 정산 ──
function settlementRows(from, to, supplierId) {
  const params = [from, to];
  let sql = `SELECT oi.*, o.order_no, o.created_at, o.channel, o.status AS order_status,
                    o.refund_reason, o.refund_bearer, o.refund_cost, s.name AS supplier_name
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN suppliers s ON s.id = oi.supplier_id
             WHERE date(o.created_at) BETWEEN date(?) AND date(?)`;
  if (supplierId) { sql += ' AND oi.supplier_id = ?'; params.push(Number(supplierId)); }
  sql += ' ORDER BY oi.supplier_id, o.id';
  return all(sql, ...params);
}

router.get('/api/admin/settlement', (req, res, ctx) => {
  auth.requireAdmin(req);
  const from = ctx.query.get('from') || monthStart();
  const to = ctx.query.get('to') || monthEnd();
  const rows = settlementRows(from, to, ctx.query.get('supplierId'));

  const bySupplier = new Map();
  const countedRefundOrders = new Set();
  for (const r of rows) {
    const agg = bySupplier.get(r.supplier_id) || {
      supplierId: r.supplier_id, supplier: r.supplier_name, sales: 0, commission: 0, refund: 0,
      supplierCost: 0, payout: 0, orders: new Set(), settled: 0, unsettled: 0,
    };
    const isRefund = r.refunded || r.order_status === '반품';
    if (isRefund) {
      agg.refund += r.subtotal;
      // 공급처 부담으로 처리된 반품비용은 주문 단위이므로 한 번만 더한다
      if (r.refund_bearer === '공급처' && r.refund_cost > 0 && !countedRefundOrders.has(r.order_no)) {
        agg.supplierCost += r.refund_cost;
        countedRefundOrders.add(r.order_no);
      }
    } else {
      agg.sales += r.subtotal;
      agg.commission += r.commission_amt;
      agg.payout += r.settle_amt;
      if (r.settlement_id) agg.settled += r.settle_amt; else agg.unsettled += r.settle_amt;
    }
    agg.orders.add(r.order_no);
    bySupplier.set(r.supplier_id, agg);
  }

  sendJson(res, 200, {
    from, to, rows,
    bySupplier: [...bySupplier.values()].map((a) => ({
      ...a, orders: a.orders.size, netPayout: a.payout - a.supplierCost, unsettled: a.unsettled - a.supplierCost,
    })),
    settlements: all('SELECT s.*, sup.name AS supplier_name FROM settlements s JOIN suppliers sup ON sup.id = s.supplier_id ORDER BY s.id DESC LIMIT 50'),
  });
});

/** 기간 마감 → 공급처별 정산서 생성(미정산 건만 묶는다) */
router.post('/api/admin/settlement', async (req, res) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const from = b.from || monthStart();
  const to = b.to || monthEnd();
  if (!b.supplierId) throw new HttpError(400, '정산할 공급처를 선택해 주세요.');

  const rows = settlementRows(from, to, b.supplierId).filter((r) => !r.settlement_id);
  if (!rows.length) throw new HttpError(400, '해당 기간에 정산할 신규 판매 건이 없습니다.');

  const valid = rows.filter((r) => !r.refunded && r.order_status !== '반품');
  const sales = valid.reduce((a, r) => a + r.subtotal, 0);
  const commission = valid.reduce((a, r) => a + r.commission_amt, 0);
  const refundRows = rows.filter((r) => r.refunded || r.order_status === '반품');
  const refund = refundRows.reduce((a, r) => a + r.subtotal, 0);

  // 계약서 제8조: 판매수수료, 반품·환불액 및 "갑" 부담 비용을 공제한 금액을 지급한다.
  const countedOrders = new Set();
  const supplierCost = refundRows.reduce((a, r) => {
    if (r.refund_bearer !== '공급처' || !r.refund_cost || countedOrders.has(r.order_no)) return a;
    countedOrders.add(r.order_no);
    return a + r.refund_cost;
  }, 0);
  const payout = Math.max(0, valid.reduce((a, r) => a + r.settle_amt, 0) - supplierCost);

  const contract = get('SELECT * FROM supplier_contracts WHERE supplier_id = ? ORDER BY id DESC', Number(b.supplierId));
  const due = new Date(new Date(to).getFullYear(), new Date(to).getMonth() + 1, 15);
  const payDue = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-15`;

  const id = tx(() => {
    const ins = run(
      `INSERT INTO settlements(supplier_id, period_from, period_to, sales_amount, commission_amt, refund_amount,
                               supplier_cost, payout_amount, status, pay_due, note)
       VALUES(?,?,?,?,?,?,?,?,'정산예정',?,?)`,
      Number(b.supplierId), from, to, sales, commission, refund, supplierCost, payout, payDue,
      contract ? `수수료 기준: ${contract.commission_note || (contract.commission_rate != null ? Math.round(contract.commission_rate * 100) + '%' : '미확정')}` : null
    );
    const sid = Number(ins.lastInsertRowid);
    for (const r of rows) run('UPDATE order_items SET settlement_id = ? WHERE id = ?', sid, r.id);
    return sid;
  });

  sendJson(res, 201, { ok: true, id, sales, commission, refund, supplierCost, payout, payDue });
});

router.patch('/api/admin/settlements/:id', async (req, res, ctx) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const s = get('SELECT * FROM settlements WHERE id = ?', Number(ctx.params.id));
  if (!s) throw new HttpError(404, '정산 내역을 찾을 수 없습니다.');
  if (b.status === '지급완료') {
    run("UPDATE settlements SET status = '지급완료', paid_at = datetime('now','localtime'), note = ? WHERE id = ?", b.note ?? s.note, s.id);
  } else {
    run('UPDATE settlements SET status = ?, note = ? WHERE id = ?', b.status ?? s.status, b.note ?? s.note, s.id);
  }
  sendJson(res, 200, { ok: true });
});

/** 공급처 제출용 정산서 CSV */
router.get('/api/admin/settlements/:id/statement.csv', (req, res, ctx) => {
  auth.requireAdmin(req);
  const s = get('SELECT * FROM settlements WHERE id = ?', Number(ctx.params.id));
  if (!s) throw new HttpError(404, '정산 내역을 찾을 수 없습니다.');
  const supplier = get('SELECT * FROM suppliers WHERE id = ?', s.supplier_id);
  const rows = all(
    `SELECT oi.*, o.order_no, o.created_at, o.channel, o.status AS order_status
     FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.settlement_id = ? ORDER BY o.id`, s.id);

  const csv = toCsv(
    ['정산기간', '공급처', '주문번호', '판매일시', '채널', '상품', '규격', '수량', '판매단가', '판매금액', '수수료율(%)', '수수료', '지급액', '반품'],
    rows.map((r) => [
      `${s.period_from}~${s.period_to}`, supplier.name, r.order_no, r.created_at, r.channel, r.name, r.spec,
      r.qty, r.unit_price, r.subtotal, Math.round(r.commission_rate * 100), r.commission_amt, r.settle_amt,
      (r.refunded || r.order_status === '반품') ? '반품' : '',
    ]).concat([[
      '합계', supplier.name, '', '', '', '', '', '', '', s.sales_amount, '', s.commission_amt, s.payout_amount,
      [s.refund_amount ? `반품 ${s.refund_amount}원` : '', s.supplier_cost ? `공급처 부담 비용 ${s.supplier_cost}원 공제` : '']
        .filter(Boolean).join(' / '),
    ]])
  );
  sendCsv(res, `정산서_${supplier.name}_${s.period_from}_${s.period_to}.csv`, csv);
});

router.get('/api/admin/settlement.csv', (req, res, ctx) => {
  auth.requireAdmin(req);
  const from = ctx.query.get('from') || monthStart();
  const to = ctx.query.get('to') || monthEnd();
  const rows = settlementRows(from, to, ctx.query.get('supplierId'));
  const csv = toCsv(
    ['주문번호', '판매일시', '채널', '공급처', '상품', '규격', '수량', '판매단가', '판매금액', '수수료율(%)', '수수료', '지급액', '주문상태', '정산번호'],
    rows.map((r) => [
      r.order_no, r.created_at, r.channel, r.supplier_name, r.name, r.spec, r.qty, r.unit_price, r.subtotal,
      Math.round(r.commission_rate * 100), r.commission_amt, r.settle_amt, r.order_status, r.settlement_id || '미정산',
    ])
  );
  sendCsv(res, `판매정산내역_${from}_${to}.csv`, csv);
});

/** 외부 링크형 채널(토스쇼핑 등) 업로드용 상품 표준 내보내기 */
router.get('/api/admin/export/products.csv', (req, res, ctx) => {
  auth.requireAdmin(req);
  const channel = ctx.query.get('channel') || '자사몰';
  const rows = all(
    `SELECT p.*, s.name AS supplier_name, cl.channel_price, cl.channel_url, cl.listed
     FROM products p JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN channel_listings cl ON cl.product_id = p.id AND cl.channel = ?
     WHERE p.status = '판매중' ORDER BY p.id`, channel);
  const base = setting('site_base_url', '');
  const csv = toCsv(
    ['상품ID', '상품명', '카테고리', '규격', '원산지', '공급처', '권장판매가', '채널판매가', '재고', '대표이미지', '자사몰링크', '채널링크', '노출여부'],
    rows.map((r) => {
      const img = get('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order, id', r.id);
      return [
        r.id, r.name, r.category, r.spec, r.origin, r.supplier_name, r.suggested_price,
        r.channel_price || r.suggested_price, r.stock,
        img ? base + img.url : '', base ? `${base}/?product=${r.id}` : `/?product=${r.id}`,
        r.channel_url || '', r.listed ? '노출' : '미노출',
      ];
    })
  );
  sendCsv(res, `상품_채널업로드_${channel}.csv`, csv);
});

// ── 설정 ──
router.get('/api/admin/settings', (req, res) => {
  auth.requireAdmin(req);
  sendJson(res, 200, {
    mallName: setting('mall_name', ''), orgName: setting('org_name', ''),
    orgBizNo: setting('org_biz_no', ''), orgAddress: setting('org_address', ''),
    orgPhone: setting('org_phone', ''), bankAccount: setting('bank_account', ''),
    defaultShippingFee: Number(setting('default_shipping_fee', '3500')),
    freeShipOver: Number(setting('free_ship_over', '50000')),
    siteBaseUrl: setting('site_base_url', ''),
    orderForwardSla: setting('order_forward_sla', ''),
  });
});

router.put('/api/admin/settings', async (req, res) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const map = {
    mallName: 'mall_name', orgName: 'org_name', orgBizNo: 'org_biz_no', orgAddress: 'org_address',
    orgPhone: 'org_phone', bankAccount: 'bank_account', defaultShippingFee: 'default_shipping_fee',
    freeShipOver: 'free_ship_over', siteBaseUrl: 'site_base_url', orderForwardSla: 'order_forward_sla',
  };
  for (const [field, key] of Object.entries(map)) if (b[field] !== undefined) setSetting(key, b[field]);
  sendJson(res, 200, { ok: true });
});

module.exports = { router, ORDER_STATUSES, PRODUCT_STATUSES };
