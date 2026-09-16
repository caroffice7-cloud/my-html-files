'use strict';

/** 소비자 자사몰 API */

const { get, all, run, tx, setting } = require('../db');
const { Router, readJson, sendJson, HttpError } = require('../lib/http');

const router = new Router();
const SELF = '자사몰';

function salePrice(product) {
  const listing = get('SELECT * FROM channel_listings WHERE product_id = ? AND channel = ?', product.id, SELF);
  return listing && listing.channel_price ? listing.channel_price : product.suggested_price;
}

function decorate(product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    spec: product.spec,
    grade: product.grade,
    origin: product.origin,
    shelfLife: product.shelf_life,
    storage: product.storage,
    ingredients: product.ingredients,
    noticeItems: product.notice_items,
    description: product.description,
    price: salePrice(product),
    suggestedPrice: product.suggested_price,
    stock: product.stock,
    shippingFee: product.shipping_fee,
    freeShipOver: product.free_ship_over,
    supplier: get('SELECT id, name, ceo, address, intro, biz_no FROM suppliers WHERE id = ?', product.supplier_id),
    images: all('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order, id', product.id).map((r) => r.url),
  };
}

function listedProducts() {
  return all(
    `SELECT p.* FROM products p
     JOIN channel_listings cl ON cl.product_id = p.id AND cl.channel = ? AND cl.listed = 1
     WHERE p.status = '판매중' ORDER BY p.id DESC`, SELF
  );
}

router.get('/api/shop/info', (req, res) => {
  sendJson(res, 200, {
    mallName: setting('mall_name', 'BMCTVda 보성 직거래장터'),
    orgName: setting('org_name', ''),
    orgBizNo: setting('org_biz_no', ''),
    orgAddress: setting('org_address', ''),
    orgPhone: setting('org_phone', ''),
    bankAccount: setting('bank_account', ''),
    shippingFee: Number(setting('default_shipping_fee', '3500')),
    freeShipOver: Number(setting('free_ship_over', '50000')),
    categories: all(
      `SELECT DISTINCT p.category AS c FROM products p
       JOIN channel_listings cl ON cl.product_id = p.id AND cl.channel = ? AND cl.listed = 1
       WHERE p.status = '판매중' AND p.category IS NOT NULL AND p.category != '' ORDER BY p.category`, SELF
    ).map((r) => r.c),
    suppliers: all("SELECT id, name, ceo, address, intro FROM suppliers WHERE status = '계약중' ORDER BY id"),
  });
});

router.get('/api/shop/products', (req, res, ctx) => {
  const category = ctx.query.get('category');
  const keyword = (ctx.query.get('q') || '').trim().toLowerCase();
  const supplierId = ctx.query.get('supplierId');

  let items = listedProducts().map(decorate);
  if (category) items = items.filter((p) => p.category === category);
  if (supplierId) items = items.filter((p) => String(p.supplier.id) === String(supplierId));
  if (keyword) {
    items = items.filter((p) =>
      p.name.toLowerCase().includes(keyword) ||
      (p.category || '').toLowerCase().includes(keyword) ||
      (p.supplier?.name || '').toLowerCase().includes(keyword));
  }
  sendJson(res, 200, { products: items });
});

router.get('/api/shop/products/:id', (req, res, ctx) => {
  const product = get('SELECT * FROM products WHERE id = ?', Number(ctx.params.id));
  if (!product) throw new HttpError(404, '상품을 찾을 수 없습니다.');
  const listing = get('SELECT listed FROM channel_listings WHERE product_id = ? AND channel = ?', product.id, SELF);
  if (product.status !== '판매중' || !listing || !listing.listed) {
    throw new HttpError(404, '현재 판매 중인 상품이 아닙니다.');
  }
  sendJson(res, 200, { product: decorate(product) });
});

function normalizePhone(value) {
  const d = String(value || '').replace(/[^0-9]/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}

function nextOrderNo() {
  const d = new Date();
  const prefix = `M${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const row = get('SELECT COUNT(*) AS c FROM orders WHERE order_no LIKE ?', `${prefix}-%`);
  return `${prefix}-${String(row.c + 1).padStart(4, '0')}`;
}

/**
 * 주문 금액 계산. 위탁배송이므로 배송비는 공급처 단위로 부과하고,
 * 공급처별 합계가 무료배송 기준을 넘으면 면제한다.
 */
function priceOrder(rawItems) {
  const lines = [];
  for (const raw of rawItems || []) {
    const qty = Math.max(1, Math.min(999, parseInt(raw.qty, 10) || 1));
    const product = get('SELECT * FROM products WHERE id = ?', raw.productId);
    if (!product || product.status !== '판매중') continue;
    const listing = get('SELECT listed FROM channel_listings WHERE product_id = ? AND channel = ?', product.id, SELF);
    if (!listing || !listing.listed) continue;
    if (product.stock > 0 && qty > product.stock) {
      throw new HttpError(409, `"${product.name}" 재고가 ${product.stock}개 남아 있습니다. 수량을 줄여 주세요.`);
    }
    const contract = get('SELECT * FROM supplier_contracts WHERE supplier_id = ? ORDER BY id DESC', product.supplier_id);
    const rate = contract && contract.commission_rate != null ? contract.commission_rate : 0;
    const unit = salePrice(product);
    const subtotal = unit * qty;
    const commission = Math.round(subtotal * rate);
    lines.push({
      productId: product.id, supplierId: product.supplier_id, name: product.name, spec: product.spec,
      qty, unitPrice: unit, subtotal, commissionRate: rate, commissionAmt: commission,
      settleAmt: subtotal - commission,
      shippingFee: product.shipping_fee || Number(setting('default_shipping_fee', '3500')),
      freeShipOver: product.free_ship_over || Number(setting('free_ship_over', '50000')),
    });
  }

  const bySupplier = new Map();
  for (const l of lines) {
    const agg = bySupplier.get(l.supplierId) || { amount: 0, fee: 0, freeOver: 0 };
    agg.amount += l.subtotal;
    agg.fee = Math.max(agg.fee, l.shippingFee);
    agg.freeOver = Math.max(agg.freeOver, l.freeShipOver);
    bySupplier.set(l.supplierId, agg);
  }
  let shipping = 0;
  for (const agg of bySupplier.values()) {
    if (!(agg.freeOver > 0 && agg.amount >= agg.freeOver)) shipping += agg.fee;
  }

  const goods = lines.reduce((a, b) => a + b.subtotal, 0);
  return { lines, goods, shipping, total: goods + shipping };
}

/** 장바구니 금액 미리보기 (배송비 안내용) */
router.post('/api/shop/quote', async (req, res) => {
  const body = await readJson(req);
  const q = priceOrder(body.items);
  sendJson(res, 200, {
    goods: q.goods, shipping: q.shipping, total: q.total,
    lines: q.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, subtotal: l.subtotal })),
  });
});

router.post('/api/shop/orders', async (req, res) => {
  const body = await readJson(req);
  const c = body.customer || {};
  const name = String(c.name || '').trim();
  const phone = normalizePhone(c.phone);
  if (!name) throw new HttpError(400, '주문자 이름을 입력해 주세요.');
  if (!phone) throw new HttpError(400, '연락처를 올바르게 입력해 주세요.');
  if (!String(c.address || '').trim()) throw new HttpError(400, '배송지 주소를 입력해 주세요.');
  if (!body.agreed) throw new HttpError(400, '주문 내용 확인 및 개인정보 제공에 동의해 주세요.');

  const quote = priceOrder(body.items);
  if (!quote.lines.length) throw new HttpError(400, '주문할 상품이 없습니다.');

  const result = tx(() => {
    const orderNo = nextOrderNo();
    const ins = run(
      `INSERT INTO orders(order_no, channel, customer_name, customer_phone, customer_email, zipcode, address,
                          address_detail, memo, status, goods_amount, shipping_fee, total_amount, pay_method, payer_name)
       VALUES(?,?,?,?,?,?,?,?,?,'주문접수',?,?,?,?,?)`,
      orderNo, SELF, name, phone, c.email || null, c.zipcode || null, c.address,
      c.addressDetail || null, body.memo || null,
      quote.goods, quote.shipping, quote.total, body.payMethod || '무통장입금', c.payerName || name
    );
    const orderId = Number(ins.lastInsertRowid);

    for (const l of quote.lines) {
      run(
        `INSERT INTO order_items(order_id, product_id, supplier_id, name, spec, qty, unit_price, subtotal,
                                 commission_rate, commission_amt, settle_amt)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        orderId, l.productId, l.supplierId, l.name, l.spec, l.qty, l.unitPrice, l.subtotal,
        l.commissionRate, l.commissionAmt, l.settleAmt
      );
      if (l.qty > 0) run('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ? AND stock > 0', l.qty, l.productId);
    }
    run('INSERT INTO order_logs(order_id, from_status, to_status, memo) VALUES(?,?,?,?)',
      orderId, null, '주문접수', '자사몰 주문');
    return { orderNo, orderId };
  });

  sendJson(res, 201, {
    ok: true,
    orderNo: result.orderNo,
    amounts: { goods: quote.goods, shipping: quote.shipping, total: quote.total },
    payMethod: body.payMethod || '무통장입금',
    bankAccount: setting('bank_account', ''),
    message: '주문이 접수되었습니다. 입금이 확인되면 공급처로 전달되어 발송됩니다.',
  });
});

router.get('/api/shop/orders/:orderNo', (req, res, ctx) => {
  const phone = normalizePhone(ctx.query.get('phone'));
  if (!phone) throw new HttpError(400, '주문 시 입력한 연락처를 함께 입력해 주세요.');
  const order = get('SELECT * FROM orders WHERE order_no = ? AND customer_phone = ?', ctx.params.orderNo, phone);
  if (!order) throw new HttpError(404, '해당 주문번호의 내역을 찾을 수 없습니다.');
  sendJson(res, 200, {
    order: {
      orderNo: order.order_no, status: order.status, createdAt: order.created_at,
      goods: order.goods_amount, shipping: order.shipping_fee, total: order.total_amount,
      paid: !!order.paid, payMethod: order.pay_method,
      address: `${order.address || ''} ${order.address_detail || ''}`.trim(),
    },
    items: all('SELECT name, spec, qty, unit_price, subtotal, tracking_no FROM order_items WHERE order_id = ?', order.id),
    history: all('SELECT from_status, to_status, memo, created_at FROM order_logs WHERE order_id = ? ORDER BY id', order.id),
  });
});

module.exports = { router, priceOrder, normalizePhone, nextOrderNo, SELF };
