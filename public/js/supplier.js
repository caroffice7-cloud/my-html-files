'use strict';

/* 공급처 화면 로직 — 상품 등록·수정, 주문 발송, 판매현황·정산 */

const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const pct = (r) => (r == null ? '미확정' : `${Math.round(r * 10000) / 100}%`);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { me: null, contract: null, products: [], pendingImages: [] };

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error('로그인이 필요합니다.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청 처리 실패');
  return data;
}

function showLogin() { $('loginView').classList.remove('hidden'); $('appView').classList.add('hidden'); }
function showApp() { $('loginView').classList.add('hidden'); $('appView').classList.remove('hidden'); }

async function doLogin() {
  try {
    await api('/api/supplier/login', { method: 'POST', body: { loginId: $('loginId').value.trim(), password: $('loginPw').value } });
    await boot();
  } catch (err) {
    $('loginMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function doLogout() {
  await api('/api/supplier/logout', { method: 'POST' });
  location.reload();
}

async function boot() {
  const me = await api('/api/supplier/me');
  if (!me.authenticated) return showLogin();
  state.me = me.supplier;
  state.contract = me.contract;
  $('supplierName').textContent = me.supplier.name;
  showApp();
  document.querySelectorAll('.admin-nav button').forEach((b) => { b.onclick = () => switchView(b.dataset.view); });
  switchView('products');
}

function switchView(v) {
  document.querySelectorAll('.admin-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  document.querySelectorAll('.admin-wrap > section').forEach((s) => s.classList.toggle('hidden', s.id !== `view-${v}`));
  ({ products: renderProducts, new: renderNew, orders: renderOrders, sales: renderSales, account: renderAccount }[v])();
}

/* ── 내 상품 ── */
async function renderProducts() {
  const d = await api('/api/supplier/products');
  state.products = d.products;
  const pending = d.products.filter((p) => p.status === '승인대기').length;
  const rejected = d.products.filter((p) => p.status === '반려').length;

  $('view-products').innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><div class="k">등록 상품</div><div class="v">${d.products.length}건</div></div>
      <div class="kpi"><div class="k">판매중</div><div class="v">${d.products.filter((p) => p.status === '판매중').length}건</div></div>
      <div class="kpi ${pending ? 'warn' : ''}"><div class="k">승인 대기</div><div class="v">${pending}건</div></div>
      <div class="kpi ${rejected ? 'danger' : ''}"><div class="k">반려</div><div class="v">${rejected}건</div></div>
    </div>
    ${rejected ? `<div class="alert alert-warn">반려된 상품이 있습니다. 사유를 확인하고 수정한 뒤 다시 승인 요청해 주세요.</div>` : ''}
    <div class="table-scroll"><table>
      <thead><tr><th>사진</th><th>상품명</th><th>분류</th><th>규격</th><th class="num">공급가</th><th class="num">권장판매가</th>
        <th class="num">재고</th><th class="num">누적판매</th><th>수수료</th><th>상태</th><th></th></tr></thead>
      <tbody>${d.products.map((p) => `<tr>
        <td>${p.images[0] ? `<img src="${esc(p.images[0].url)}" style="width:44px;height:44px;object-fit:cover;border-radius:6px">` : '<span class="mini muted">없음</span>'}</td>
        <td><b>${esc(p.name)}</b>${p.reject_reason ? `<br><span class="mini" style="color:var(--red-600)">반려: ${esc(p.reject_reason)}</span>` : ''}</td>
        <td class="mini">${esc(p.category)}</td>
        <td class="mini">${esc(p.spec)}</td>
        <td class="num">${p.supply_price ? won(p.supply_price) : '<span class="mini muted">미입력</span>'}</td>
        <td class="num">${p.suggested_price ? won(p.suggested_price) : '<span class="mini muted">미입력</span>'}</td>
        <td class="num">${p.stock}</td>
        <td class="num">${p.soldQty}</td>
        <td class="mini">${p.rate_confirmed
          ? `${pct(p.effective_rate)}${p.rate_source === '상품 개별' ? ' <span class="mini">(개별)</span>' : ''}`
          : '<span style="color:var(--amber-600)">협의 전</span>'}</td>
        <td><span class="badge b-${esc(p.status)}">${esc(p.status)}</span></td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="openProduct(${p.id})">수정</button>
          ${['반려', '승인대기'].includes(p.status) ? `<button class="btn btn-sm btn-primary" onclick="submitForReview(${p.id})">승인요청</button>` : ''}
          ${p.status === '판매중' ? `<button class="btn btn-sm btn-ghost" onclick="setStatus(${p.id},'품절')">품절</button>` : ''}
          ${['품절', '판매중지'].includes(p.status) ? `<button class="btn btn-sm btn-ghost" onclick="setStatus(${p.id},'판매중')">판매재개</button>` : ''}
        </td></tr>`).join('') || '<tr><td colspan="10" class="muted">등록된 상품이 없습니다.</td></tr>'}
      </tbody>
    </table></div>`;
}

async function setStatus(id, status) {
  try { await api(`/api/supplier/products/${id}/status`, { method: 'PATCH', body: { status } }); renderProducts(); }
  catch (err) { alert(err.message); }
}

async function submitForReview(id) {
  try { await api(`/api/supplier/products/${id}/submit`, { method: 'POST' }); alert('승인 요청했습니다. 운영자 검수 후 판매가 시작됩니다.'); renderProducts(); }
  catch (err) { alert(err.message); }
}

/* ── 상품 등록/수정 폼 ── */
function productForm(p = {}) {
  return `
    <div class="row-form">
      <div style="grid-column:1/-1"><label class="mini">상품명 *</label><input id="fName" value="${esc(p.name)}"></div>
      <div><label class="mini">분류</label><input id="fCategory" value="${esc(p.category)}" placeholder="예: 가공식품, 아열대과일"></div>
      <div><label class="mini">규격 (용량·중량·구성)</label><input id="fSpec" value="${esc(p.spec)}" placeholder="예: 180ml"></div>
      <div><label class="mini">등급·당도</label><input id="fGrade" value="${esc(p.grade)}"></div>
      <div><label class="mini">원산지</label><input id="fOrigin" value="${esc(p.origin)}"></div>
      <div><label class="mini">소비기한</label><input id="fShelf" value="${esc(p.shelf_life)}" placeholder="예: 제조일로부터 12개월"></div>
      <div><label class="mini">보관방법</label><input id="fStorage" value="${esc(p.storage)}"></div>
      <div><label class="mini">공급가 (원)</label><input id="fSupply" type="number" value="${p.supply_price ?? 0}"></div>
      <div><label class="mini">권장판매가 (원) *</label><input id="fSuggested" type="number" value="${p.suggested_price ?? 0}"></div>
      <div><label class="mini">재고 수량</label><input id="fStock" type="number" value="${p.stock ?? 0}"></div>
      <div><label class="mini">배송비 (원, 0이면 기본값)</label><input id="fShipFee" type="number" value="${p.shipping_fee ?? 0}"></div>
      <div><label class="mini">무료배송 기준 (원)</label><input id="fFreeOver" type="number" value="${p.free_ship_over ?? 0}"></div>
      <div style="grid-column:1/-1"><label class="mini">원재료명 및 함량</label><input id="fIngredients" value="${esc(p.ingredients)}"></div>
      <div style="grid-column:1/-1"><label class="mini">상품정보 제공고시 (업소명·소재지, 제조연월일, 내용량 등)</label>
        <textarea id="fNotice" rows="2">${esc(p.notice_items)}</textarea></div>
      <div style="grid-column:1/-1"><label class="mini">상품 설명</label><textarea id="fDesc" rows="4">${esc(p.description)}</textarea></div>
      <div style="grid-column:1/-1">
        <label class="mini">상품 사진 (여러 장 선택 가능 · 장당 4MB 이하)</label>
        <input id="fImages" type="file" accept="image/*" multiple onchange="readImages(this)">
        <div id="newThumbs" class="thumb-list" style="margin-top:8px"></div>
      </div>
    </div>`;
}

function collectProduct() {
  return {
    name: $('fName').value.trim(), category: $('fCategory').value.trim(), spec: $('fSpec').value.trim(),
    grade: $('fGrade').value.trim(), origin: $('fOrigin').value.trim(), shelfLife: $('fShelf').value.trim(),
    storage: $('fStorage').value.trim(), ingredients: $('fIngredients').value.trim(),
    noticeItems: $('fNotice').value.trim(), description: $('fDesc').value.trim(),
    supplyPrice: Number($('fSupply').value || 0), suggestedPrice: Number($('fSuggested').value || 0),
    stock: Number($('fStock').value || 0), shippingFee: Number($('fShipFee').value || 0),
    freeShipOver: Number($('fFreeOver').value || 0),
    images: state.pendingImages,
  };
}

const MAX_IMAGE_SIDE = 1600;   // 긴 변 기준 축소 크기
const IMAGE_QUALITY = 0.85;

/**
 * 휴대폰 사진은 3~5MB가 흔해서 그대로 올리면 시골 회선에서 오래 걸리고 저장 공간도 낭비된다.
 * 브라우저에서 미리 긴 변 1600px 로 줄이고 JPEG 로 다시 인코딩해 보낸다.
 */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('사진을 읽지 못했습니다.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('사진 형식을 인식하지 못했습니다.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
        if (scale === 1 && reader.result.length < 1.2 * 1024 * 1024) return resolve(reader.result);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height); // 투명 PNG 가 검게 나오지 않도록
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function readImages(input) {
  state.pendingImages = [];
  const box = $('newThumbs');
  box.innerHTML = '';
  const files = [...input.files].slice(0, 8);
  if (input.files.length > 8) alert('사진은 한 번에 8장까지 올릴 수 있습니다. 앞의 8장만 사용합니다.');
  if (!files.length) return;

  box.innerHTML = '<span class="mini">사진 준비 중…</span>';
  const prepared = [];
  let savedFrom = 0;
  for (const file of files) {
    try {
      savedFrom += file.size;
      prepared.push(await shrinkImage(file));
    } catch (err) {
      alert(`${file.name}: ${err.message}`);
    }
  }
  state.pendingImages = prepared;
  const after = prepared.reduce((a, d) => a + d.length * 0.75, 0);
  box.innerHTML = prepared.map((d) => `<figure><img src="${d}" alt=""></figure>`).join('')
    + `<div class="mini" style="width:100%">${prepared.length}장 준비됨 · ${(savedFrom / 1024 / 1024).toFixed(1)}MB → ${(after / 1024 / 1024).toFixed(1)}MB 로 줄여서 올립니다</div>`;
}

function renderNew() {
  state.pendingImages = [];
  const c = state.contract;
  $('view-new').innerHTML = `
    <div class="panel">
      <h3>상품 등록</h3>
      <div class="contract-box" style="margin-bottom:14px">
        <b>내 계약 조건</b> · 판매수수료 ${pct(c?.commission_rate)}${c?.commission_note ? ` (${esc(c.commission_note)})` : ''}
        · 정산 ${esc(c?.settlement_cycle)} · ${esc(c?.shipping_method)}${c?.ship_days ? ` · 주문 전달 후 영업일 ${c.ship_days}일 이내 출고` : ''}
      </div>
      ${productForm()}
      <div style="margin-top:14px">
        <button class="btn btn-primary" onclick="createProduct()">등록하고 승인 요청</button>
      </div>
      <p class="mini" style="margin-top:10px">
        등록하시면 운영자 검수 후 판매가 시작됩니다. 식품은 표시사항(제조원·원산지·소비기한·원재료)을 빠짐없이 입력해 주세요.
      </p>
      <div id="newMsg"></div>
    </div>`;
}

async function createProduct() {
  try {
    const body = collectProduct();
    if (!body.name) throw new Error('상품명을 입력해 주세요.');
    await api('/api/supplier/products', { method: 'POST', body });
    $('newMsg').innerHTML = '<div class="alert alert-ok">등록했습니다. 운영자 승인 후 판매가 시작됩니다.</div>';
    state.pendingImages = [];
    setTimeout(() => switchView('products'), 800);
  } catch (err) {
    $('newMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

function openProduct(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  state.pendingImages = [];
  $('dlgTitle').textContent = `상품 수정 — ${p.name}`;
  $('dlgBody').innerHTML = `
    ${p.reject_reason ? `<div class="alert alert-error">반려 사유: ${esc(p.reject_reason)}</div>` : ''}
    ${p.images.length ? `<div class="thumb-list" style="margin-bottom:12px">${p.images.map((i) =>
      `<figure><img src="${esc(i.url)}" alt=""><button onclick="deleteImage(${p.id},${i.id})" title="삭제">×</button></figure>`).join('')}</div>` : ''}
    ${productForm(p)}
    <p class="mini" style="margin-top:10px">판매중인 상품의 내용을 고치면 다시 검수를 받습니다.</p>
    <div id="editMsg"></div>`;
  $('dlgFoot').innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="dlg.close()">취소</button>
    <button class="btn btn-sm btn-primary" onclick="saveProduct(${p.id})">저장</button>`;
  dlg.showModal();
}

async function saveProduct(id) {
  try {
    const d = await api(`/api/supplier/products/${id}`, { method: 'PUT', body: collectProduct() });
    dlg.close();
    if (d.requiresReview) alert('수정 내용이 저장되었습니다. 다시 검수를 받은 뒤 판매가 재개됩니다.');
    renderProducts();
  } catch (err) {
    $('editMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function deleteImage(productId, imageId) {
  if (!confirm('이 사진을 삭제할까요?')) return;
  await api(`/api/supplier/products/${productId}/images/${imageId}`, { method: 'DELETE' });
  dlg.close();
  await renderProducts();
  openProduct(productId);
}

/* ── 주문 · 발송 ── */
async function renderOrders() {
  const d = await api('/api/supplier/sales');
  $('view-orders').innerHTML = `
    <div class="panel">
      <h3>발송해야 할 주문</h3>
      <p class="mini">${state.contract?.ship_days ? `계약상 주문 전달일로부터 영업일 기준 ${state.contract.ship_days}일 이내에 출고해 주세요.` : ''}
        송장번호를 입력하면 주문 상태가 자동으로 "출고"로 바뀝니다.</p>
      <div class="table-scroll"><table>
        <thead><tr><th>주문번호</th><th>주문일</th><th>상품</th><th class="num">수량</th><th>받는분</th><th>배송지</th><th>송장번호</th></tr></thead>
        <tbody>${d.pendingOrders.map((o) => `<tr>
          <td><b>${esc(o.order_no)}</b><br><span class="badge b-${esc(o.status)}">${esc(o.status)}</span></td>
          <td class="mini">${esc(o.created_at)}</td>
          <td>${esc(o.name)}<br><span class="mini">${esc(o.spec)}</span></td>
          <td class="num">${o.qty}</td>
          <td>${esc(o.customer_name)}<br><span class="mini">${esc(o.customer_phone)}</span></td>
          <td class="mini">${esc(o.address)} ${esc(o.address_detail)}</td>
          <td>
            <input id="trk${o.item_id}" value="${esc(o.tracking_no)}" placeholder="송장번호" style="width:130px">
            <button class="btn btn-sm btn-primary" onclick="saveTracking(${o.item_id})">저장</button>
          </td></tr>`).join('') || '<tr><td colspan="7" class="muted">발송 대기 중인 주문이 없습니다.</td></tr>'}
        </tbody>
      </table></div>
    </div>`;
}

async function saveTracking(itemId) {
  try {
    await api('/api/supplier/tracking', { method: 'POST', body: { itemId, trackingNo: $(`trk${itemId}`).value.trim() } });
    renderOrders();
  } catch (err) { alert(err.message); }
}

/* ── 판매 현황 · 정산 ── */
async function renderSales(from, to) {
  const q = from && to ? `?from=${from}&to=${to}` : '';
  const d = await api(`/api/supplier/sales${q}`);
  const c = d.contract;
  $('view-sales').innerHTML = `
    <div class="toolbar">
      <input id="sf" type="date" value="${d.from}"> ~ <input id="st" type="date" value="${d.to}">
      <button class="btn btn-sm btn-primary" onclick="renderSales($('sf').value, $('st').value)">조회</button>
    </div>
    <div class="contract-box" style="margin-bottom:14px">
      판매수수료 <b>${pct(c?.commission_rate)}</b>${c?.commission_note ? ` — ${esc(c.commission_note)}` : ''} ·
      정산 주기 <b>${esc(c?.settlement_cycle)}</b> · ${esc(c?.shipping_method)}
      ${c?.discount_limit_rate != null ? ` · 할인 허용 한도 권장판매가 대비 ${Math.round(c.discount_limit_rate * 100)}%` : ''}
    </div>
    <div class="kpi-grid">
      <div class="kpi"><div class="k">주문 건수</div><div class="v">${d.totals.orders}건</div></div>
      <div class="kpi"><div class="k">판매금액</div><div class="v">${won(d.totals.sales)}</div></div>
      <div class="kpi"><div class="k">판매수수료</div><div class="v">${won(d.totals.commission)}</div></div>
      <div class="kpi"><div class="k">정산 예정액</div><div class="v">${won(d.totals.payout)}</div></div>
      ${d.totals.refund ? `<div class="kpi danger"><div class="k">반품</div><div class="v">${won(d.totals.refund)}</div></div>` : ''}
    </div>
    <div class="panel">
      <h3>정산 내역</h3>
      <table><thead><tr><th>정산기간</th><th class="num">판매금액</th><th class="num">수수료</th><th class="num">반품</th>
        <th class="num">부담 비용</th><th class="num">지급액</th><th>지급예정일</th><th>상태</th></tr></thead>
        <tbody>${d.settlements.map((s) => `<tr>
          <td>${esc(s.period_from)} ~ ${esc(s.period_to)}</td>
          <td class="num">${won(s.sales_amount)}</td><td class="num">${won(s.commission_amt)}</td>
          <td class="num">${won(s.refund_amount)}</td>
          <td class="num">${s.supplier_cost ? `<span style="color:var(--red-600)">−${won(s.supplier_cost)}</span>` : '-'}</td>
          <td class="num"><b>${won(s.payout_amount)}</b></td>
          <td class="mini">${esc(s.pay_due)}</td><td><span class="badge b-${esc(s.status)}">${esc(s.status)}</span></td>
        </tr>`).join('') || '<tr><td colspan="8" class="muted">아직 확정된 정산 내역이 없습니다.</td></tr>'}</tbody></table>
      <p class="mini">부담 비용은 상품 하자·오배송 등 공급처 귀책으로 발생한 반품 처리 비용이며, 계약서 제8조에 따라 지급액에서 공제됩니다.</p>
    </div>
    <div class="panel">
      <h3>판매 상세</h3>
      <div class="table-scroll"><table>
        <thead><tr><th>주문번호</th><th>일시</th><th>채널</th><th>상품</th><th class="num">수량</th>
          <th class="num">판매금액</th><th class="num">수수료</th><th class="num">정산액</th><th>상태</th></tr></thead>
        <tbody>${d.rows.map((r) => `<tr>
          <td class="mini">${esc(r.order_no)}</td><td class="mini">${esc(r.created_at)}</td><td class="mini">${esc(r.channel)}</td>
          <td>${esc(r.name)}</td><td class="num">${r.qty}</td>
          <td class="num">${won(r.subtotal)}</td><td class="num">${won(r.commission_amt)}</td>
          <td class="num">${won(r.settle_amt)}</td>
          <td><span class="badge b-${esc(r.status)}">${esc(r.status)}</span>${r.settlement_id ? ' <span class="mini">정산완료</span>' : ''}</td>
        </tr>`).join('') || '<tr><td colspan="9" class="muted">해당 기간 판매 내역이 없습니다.</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

/* ── 계약 · 내 정보 ── */
function renderAccount() {
  const s = state.me, c = state.contract;
  $('view-account').innerHTML = `
    <div class="panel">
      <h3>위탁판매 계약 조건</h3>
      <table class="spec-table"><tbody>
        <tr><th>판매수수료</th><td>${pct(c?.commission_rate)} ${c?.commission_note ? `<br><span class="mini">${esc(c.commission_note)}</span>` : ''}</td></tr>
        <tr><th>정산 주기</th><td>${esc(c?.settlement_cycle)}</td></tr>
        <tr><th>배송 방식</th><td>${esc(c?.shipping_method)}${c?.ship_days ? ` · 주문 전달 후 영업일 ${c.ship_days}일 이내 출고` : ''}</td></tr>
        <tr><th>할인 허용 한도</th><td>${c?.discount_limit_rate != null ? `권장판매가 대비 ${Math.round(c.discount_limit_rate * 100)}%` : '미확정'}</td></tr>
        <tr><th>채널수수료 부담</th><td>${esc(c?.channel_fee_bearer)}</td></tr>
        <tr><th>계약 기간</th><td>${esc(c?.contract_period)}</td></tr>
        ${c?.note ? `<tr><th>비고</th><td>${esc(c.note)}</td></tr>` : ''}
      </tbody></table>
      <p class="mini" style="margin-top:10px">계약 조건 변경은 서면 합의 사항입니다. 수정이 필요하면 운영자에게 알려주세요.</p>
    </div>

    <div class="panel">
      <h3>사업자 정보</h3>
      <table class="spec-table"><tbody>
        <tr><th>상호</th><td>${esc(s.name)}</td></tr>
        <tr><th>대표자</th><td>${esc(s.ceo)}</td></tr>
        <tr><th>사업자등록번호</th><td>${esc(s.bizNo)} ${esc(s.taxType)}</td></tr>
        <tr><th>로그인 아이디</th><td>${esc(s.loginId)}</td></tr>
      </tbody></table>
      <div class="row-form" style="margin-top:14px">
        <div style="grid-column:1/-1"><label class="mini">사업장 주소</label><input id="aAddress" value="${esc(s.address)}"></div>
        <div><label class="mini">연락처</label><input id="aPhone" value="${esc(s.phone)}"></div>
        <div><label class="mini">이메일</label><input id="aEmail" value="${esc(s.email)}"></div>
        <div style="grid-column:1/-1"><label class="mini">농장·업소 소개 (상품 상세페이지에 표시됩니다)</label>
          <textarea id="aIntro" rows="3">${esc(s.intro)}</textarea></div>
      </div>
      <div style="margin-top:12px"><button class="btn btn-sm btn-primary" onclick="saveAccount()">저장</button></div>
      <div id="accMsg"></div>
    </div>

    <div class="panel">
      <h3>비밀번호 변경</h3>
      <div class="row-form">
        <div><label class="mini">현재 비밀번호</label><input id="pwCur" type="password"></div>
        <div><label class="mini">새 비밀번호 (8자 이상)</label><input id="pwNew" type="password"></div>
      </div>
      <div style="margin-top:12px"><button class="btn btn-sm btn-primary" onclick="changePassword()">변경</button></div>
      <div id="pwMsg"></div>
    </div>`;
}

async function saveAccount() {
  try {
    await api('/api/supplier/me', { method: 'PUT', body: {
      address: $('aAddress').value.trim(), phone: $('aPhone').value.trim(),
      email: $('aEmail').value.trim(), intro: $('aIntro').value.trim(),
    } });
    $('accMsg').innerHTML = '<div class="alert alert-ok">저장했습니다.</div>';
    state.me = (await api('/api/supplier/me')).supplier;
  } catch (err) { $('accMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
}

async function changePassword() {
  try {
    await api('/api/supplier/password', { method: 'POST', body: { current: $('pwCur').value, next: $('pwNew').value } });
    $('pwMsg').innerHTML = '<div class="alert alert-ok">비밀번호를 변경했습니다.</div>';
    $('pwCur').value = ''; $('pwNew').value = '';
  } catch (err) { $('pwMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
}

(async function start() {
  const me = await fetch('/api/supplier/me').then((r) => r.json()).catch(() => ({ authenticated: false }));
  if (me.authenticated) boot(); else showLogin();
})();
