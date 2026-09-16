'use strict';

/* 소비자 쇼핑몰 로직 */

const state = { info: null, products: [], cart: loadCart(), category: '', keyword: '' };
const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadCart() {
  try { return JSON.parse(localStorage.getItem('bmctvda_cart') || '[]'); } catch { return []; }
}
function saveCart() {
  try { localStorage.setItem('bmctvda_cart', JSON.stringify(state.cart)); } catch { /* 저장 실패는 무시 */ }
  renderCartCount();
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
  return data;
}

async function init() {
  state.info = await api('/api/shop/info');
  $('orgLine').textContent = state.info.orgName || '';
  $('fOrg').textContent = state.info.orgName || '';
  $('fInfo').textContent = [
    state.info.orgBizNo ? `사업자등록번호 ${state.info.orgBizNo}` : '',
    state.info.orgAddress, state.info.orgPhone,
  ].filter(Boolean).join(' · ');
  $('bankNotice').textContent = state.info.bankAccount || '입금 계좌는 주문 후 안내드립니다.';
  renderCats();
  renderCartCount();

  const params = new URLSearchParams(location.search);
  if (params.get('product')) return showDetail(Number(params.get('product')));
  await loadProducts();
}

function renderCats() {
  const cats = ['', ...state.info.categories];
  $('cats').innerHTML = cats.map((c) =>
    `<button class="${state.category === c ? 'on' : ''}" onclick="pickCategory('${esc(c)}')">${c || '전체'}</button>`).join('');
}

function pickCategory(c) {
  state.category = c;
  renderCats();
  goHome();
}

async function loadProducts() {
  const params = new URLSearchParams();
  if (state.category) params.set('category', state.category);
  if (state.keyword) params.set('q', state.keyword);
  const d = await api(`/api/shop/products?${params}`);
  state.products = d.products;
  renderList();
}

function renderList() {
  const box = $('productGrid');
  $('listEmpty').classList.toggle('hidden', state.products.length > 0);
  box.innerHTML = state.products.map((p) => {
    const img = p.images[0];
    const soldOut = p.stock === 0;
    return `<article class="pcard" onclick="showDetail(${p.id})">
      <div class="pthumb">${img ? `<img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy">` : '사진 준비 중'}</div>
      <div class="pbody">
        <div class="psupplier">${esc(p.supplier?.name || '')}</div>
        <div class="pname">${esc(p.name)}</div>
        <div class="pspec">${esc(p.spec || '')}${p.origin ? ` · ${esc(p.origin)}` : ''}</div>
        <div class="pprice">${won(p.price)} ${soldOut ? '<span class="pbadge soldout">품절</span>' : ''}</div>
      </div>
    </article>`;
  }).join('');
}

function doSearch() {
  state.keyword = $('searchBox').value.trim();
  goHome();
}

function view(id) {
  ['viewList', 'viewDetail', 'viewCart', 'viewLookup', 'viewDone'].forEach((v) => {
    $(v).classList.toggle('hidden', v !== id);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goHome() {
  history.replaceState({}, '', location.pathname);
  view('viewList');
  loadProducts();
}

async function showDetail(id) {
  let product;
  try {
    product = (await api(`/api/shop/products/${id}`)).product;
  } catch (err) {
    alert(err.message);
    return goHome();
  }
  history.replaceState({}, '', `?product=${id}`);
  const images = product.images;
  const rows = [
    ['공급처(생산자)', product.supplier ? `${product.supplier.name}${product.supplier.ceo ? ` (${product.supplier.ceo})` : ''}` : ''],
    ['규격', product.spec], ['등급', product.grade], ['원산지', product.origin],
    ['소비기한', product.shelfLife], ['보관방법', product.storage],
    ['원재료명', product.ingredients], ['상품정보 제공고시', product.noticeItems],
    ['배송', product.freeShipOver ? `${won(product.shippingFee || state.info.shippingFee)} (${won(product.freeShipOver)} 이상 무료)` : `${won(product.shippingFee || state.info.shippingFee)} · 공급처 직발송`],
  ].filter(([, v]) => v);

  $('detailBody').innerHTML = `
    <div class="detail">
      <div>
        <div class="gallery">
          <div class="main-img" id="mainImg">${images[0] ? `<img src="${esc(images[0])}" alt="${esc(product.name)}">` : '사진 준비 중'}</div>
          ${images.length > 1 ? `<div class="thumbs">${images.map((u, i) =>
            `<img src="${esc(u)}" class="${i === 0 ? 'on' : ''}" onclick="swapImage(this,'${esc(u)}')">`).join('')}</div>` : ''}
        </div>
      </div>
      <div>
        <div class="psupplier">${esc(product.supplier?.name || '')}</div>
        <h2>${esc(product.name)}</h2>
        <p class="pprice" style="font-size:1.6rem">${won(product.price)}</p>
        ${product.stock === 0 ? '<div class="alert alert-warn">현재 품절입니다.</div>' : ''}
        <div style="display:flex;gap:10px;align-items:center;margin:16px 0">
          <div class="qty">
            <button onclick="stepQty(-1)">−</button>
            <input id="detailQty" value="1" readonly>
            <button onclick="stepQty(1)">＋</button>
          </div>
          <button class="btn btn-outline" onclick="addToCart(${product.id})" ${product.stock === 0 ? 'disabled' : ''}>장바구니</button>
          <button class="btn btn-primary" onclick="addToCart(${product.id}, true)" ${product.stock === 0 ? 'disabled' : ''}>바로 주문</button>
        </div>
        <table class="spec-table"><tbody>
          ${rows.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}
        </tbody></table>
        ${product.description ? `<div class="panel" style="margin-top:16px"><h4>상품 설명</h4><p style="white-space:pre-wrap">${esc(product.description)}</p></div>` : ''}
        ${product.supplier?.intro ? `<div class="notice" style="margin-top:12px"><b>${esc(product.supplier.name)}</b><br>${esc(product.supplier.intro)}<br><span class="muted">${esc(product.supplier.address || '')}</span></div>` : ''}
      </div>
    </div>`;
  view('viewDetail');
}

function swapImage(el, url) {
  $('mainImg').innerHTML = `<img src="${url}" alt="">`;
  document.querySelectorAll('.thumbs img').forEach((i) => i.classList.toggle('on', i === el));
}

function stepQty(delta) {
  const input = $('detailQty');
  input.value = Math.max(1, Math.min(99, Number(input.value) + delta));
}

function addToCart(productId, goOrder) {
  const qty = Number($('detailQty')?.value || 1);
  const existing = state.cart.find((c) => c.productId === productId);
  if (existing) existing.qty = Math.min(99, existing.qty + qty);
  else state.cart.push({ productId, qty });
  saveCart();
  if (goOrder) showCart();
  else if (confirm('장바구니에 담았습니다. 장바구니로 이동할까요?')) showCart();
}

function renderCartCount() {
  const n = state.cart.reduce((a, b) => a + b.qty, 0);
  $('cartCount').textContent = n;
  $('cartCount').classList.toggle('hidden', n === 0);
}

async function showCart() {
  view('viewCart');
  await renderCart();
}

async function renderCart() {
  if (!state.cart.length) {
    $('cartLines').innerHTML = '<p class="muted">장바구니가 비어 있습니다.</p>';
    $('cartSummary').innerHTML = '';
    $('orderBtn').disabled = true;
    return;
  }
  let quote;
  try {
    quote = await api('/api/shop/quote', { method: 'POST', body: { items: state.cart } });
  } catch (err) {
    $('cartSummary').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    return;
  }
  // 판매 중지된 상품은 장바구니에서 정리한다.
  const validIds = new Set(quote.lines.map((l) => l.productId));
  if (validIds.size !== state.cart.length) {
    state.cart = state.cart.filter((c) => validIds.has(c.productId));
    saveCart();
  }

  $('cartLines').innerHTML = quote.lines.map((l) => `
    <div class="cart-row">
      <div class="info">
        <div style="font-weight:700">${esc(l.name)}</div>
        <div class="muted">${won(l.unitPrice)} × ${l.qty}</div>
      </div>
      <div class="qty">
        <button onclick="changeCartQty(${l.productId},-1)">−</button>
        <input value="${l.qty}" readonly>
        <button onclick="changeCartQty(${l.productId},1)">＋</button>
      </div>
      <b style="min-width:92px;text-align:right">${won(l.subtotal)}</b>
      <button class="btn btn-ghost btn-sm" onclick="changeCartQty(${l.productId},-99)">삭제</button>
    </div>`).join('');

  $('cartSummary').innerHTML = `
    <div class="sum-row"><span>상품 금액</span><span>${won(quote.goods)}</span></div>
    <div class="sum-row"><span>배송비 <span class="muted">(공급처별 부과, 위탁배송)</span></span><span>${quote.shipping ? won(quote.shipping) : '무료'}</span></div>
    <div class="sum-row total"><span>결제 예정 금액</span><span>${won(quote.total)}</span></div>`;
  $('orderBtn').disabled = false;
}

function changeCartQty(productId, delta) {
  const item = state.cart.find((c) => c.productId === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) state.cart = state.cart.filter((c) => c.productId !== productId);
  saveCart();
  renderCart();
}

async function submitOrder() {
  const box = $('orderMsg');
  box.innerHTML = '';
  const btn = $('orderBtn');
  btn.disabled = true;
  btn.textContent = '주문 처리 중…';
  try {
    const d = await api('/api/shop/orders', {
      method: 'POST',
      body: {
        items: state.cart,
        customer: {
          name: $('cName').value.trim(), phone: $('cPhone').value.trim(), email: $('cEmail').value.trim(),
          zipcode: $('cZip').value.trim(), address: $('cAddr').value.trim(),
          addressDetail: $('cAddrDetail').value.trim(), payerName: $('cPayer').value.trim(),
        },
        memo: $('cMemo').value.trim(),
        payMethod: $('payMethod').value,
        agreed: $('cAgree').checked,
      },
    });
    state.cart = [];
    saveCart();
    $('viewDone').innerHTML = `
      <div class="panel center" style="border-color:var(--green-600)">
        <h2>주문이 접수되었습니다</h2>
        <p style="font-size:1.4rem;font-weight:800">주문번호 <span style="color:var(--green-700)">${esc(d.orderNo)}</span></p>
        <p>결제 예정 금액 <b>${won(d.amounts.total)}</b> <span class="muted">(상품 ${won(d.amounts.goods)} + 배송비 ${won(d.amounts.shipping)})</span></p>
        <div class="notice" style="text-align:left;margin-top:14px">
          <b>${esc(d.payMethod)}</b><br>${esc(d.bankAccount || '입금 계좌는 문자로 안내드립니다.')}<br>
          ${esc(d.message)}
        </div>
        <div style="margin-top:16px;display:flex;gap:8px;justify-content:center">
          <button class="btn btn-outline" onclick="showLookup()">주문 조회</button>
          <button class="btn btn-primary" onclick="goHome()">쇼핑 계속하기</button>
        </div>
      </div>`;
    view('viewDone');
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '주문하기';
  }
}

function showLookup() { view('viewLookup'); }

async function lookupOrder() {
  const box = $('lookupResult');
  try {
    const d = await api(`/api/shop/orders/${encodeURIComponent($('lkNo').value.trim())}?phone=${encodeURIComponent($('lkPhone').value.trim())}`);
    const steps = ['주문접수', '공급처전달', '출고', '배송중', '완료'];
    const idx = steps.indexOf(d.order.status);
    box.innerHTML = `
      <div class="steps" style="margin-top:16px">
        ${steps.map((s, i) => `<div class="step ${i === idx ? 'on' : i < idx ? 'done' : ''}">${s}</div>`).join('')}
      </div>
      ${d.order.status === '반품' ? '<div class="alert alert-warn">반품 처리된 주문입니다.</div>' : ''}
      <table class="spec-table"><tbody>
        <tr><th>주문번호</th><td>${esc(d.order.orderNo)}</td></tr>
        <tr><th>주문일시</th><td>${esc(d.order.createdAt)}</td></tr>
        <tr><th>결제금액</th><td>${won(d.order.total)} (${d.order.paid ? '입금확인' : '입금대기'})</td></tr>
        <tr><th>배송지</th><td>${esc(d.order.address)}</td></tr>
      </tbody></table>
      <h4 style="margin-top:16px">주문 상품</h4>
      <table class="spec-table"><tbody>
        ${d.items.map((i) => `<tr><th>${esc(i.name)}</th><td>${i.qty}개 · ${won(i.subtotal)}${i.tracking_no ? `<br><span class="muted">송장 ${esc(i.tracking_no)}</span>` : ''}</td></tr>`).join('')}
      </tbody></table>`;
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
