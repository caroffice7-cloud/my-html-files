'use strict';

/* 운영자(히스메이커스) 통합 관리 화면 */

const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const pct = (r) => (r == null ? '미확정' : `${Math.round(r * 10000) / 100}%`);
const asPct = (r) => (r == null ? '' : String(Math.round(r * 10000) / 100));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { channels: [], orderStatuses: [], refundBearers: [], refundReasons: [], suppliers: [], products: [], manualOrder: [], me: null };

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error('로그인이 필요합니다.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || '요청 처리 실패'); e.status = res.status; throw e; }
  return data;
}

function showLogin() { $('loginView').classList.remove('hidden'); $('appView').classList.add('hidden'); }
function showApp() { $('loginView').classList.add('hidden'); $('appView').classList.remove('hidden'); }

async function doLogin() {
  try {
    await api('/api/admin/login', { method: 'POST', body: { loginId: $('loginId').value.trim(), password: $('pw').value } });
    showApp(); await boot();
  } catch (err) { $('loginMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
}

function applyRole() {
  const me = state.me;
  $('whoami').textContent = me ? `${me.name} · ${me.role}` : '';
  const isOwner = me && me.role === '총괄';
  document.querySelectorAll('.admin-nav button[data-owner]').forEach((b) => b.classList.toggle('hidden', !isOwner));
  if (me && me.mustChange) {
    setTimeout(() => { alert('첫 로그인입니다. 비밀번호를 바꿔 주세요.'); openPasswordDialog(); }, 300);
  }
}

function openPasswordDialog() {
  $('dlgTitle').textContent = '비밀번호 변경';
  $('dlgBody').innerHTML = `
    <div class="row-form">
      <div><label class="mini">현재 비밀번호</label><input id="mpwCur" type="password"></div>
      <div><label class="mini">새 비밀번호 (8자 이상)</label><input id="mpwNew" type="password"></div>
    </div><div id="mpwMsg"></div>`;
  $('dlgFoot').innerHTML = `<button class="btn btn-sm btn-ghost" onclick="dlg.close()">닫기</button>
    <button class="btn btn-sm btn-primary" onclick="changeMyPassword()">변경</button>`;
  dlg.showModal();
}

async function changeMyPassword() {
  try {
    await api('/api/admin/password', { method: 'POST', body: { current: $('mpwCur').value, next: $('mpwNew').value } });
    state.me.mustChange = false; dlg.close(); alert('비밀번호를 바꿨습니다.');
  } catch (err) { $('mpwMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
}

/* ── 운영자 계정 (총괄만) ── */
async function renderAccounts() {
  const d = await api('/api/admin/accounts');
  $('view-accounts').innerHTML = `
    <div class="panel">
      <h3>운영자 계정</h3>
      <p class="mini">
        <b>총괄</b> — 모든 기능 + 공급처·계약·수수료·정산 지급·설정·계정 관리 ·
        <b>담당자</b> — 상품 승인, 주문 관리, 채널 연동, 정산 조회<br>
        계정을 나누면 상품 승인·주문 처리·정산이 누가 했는지 기록에 남습니다.
      </p>
      <div class="row-form" style="margin-top:12px">
        <input id="acLoginId" placeholder="아이디 (영문소문자·숫자)">
        <input id="acName" placeholder="담당자 이름">
        <input id="acPhone" placeholder="연락처">
        <select id="acRole">${d.roles.map((r) => `<option ${r === '담당자' ? 'selected' : ''}>${r}</option>`).join('')}</select>
        <input id="acPw" placeholder="초기 비밀번호 (8자 이상)">
        <button class="btn btn-sm btn-primary" onclick="createAccount()">계정 추가</button>
      </div>
      <div id="acMsg"></div>
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th>아이디</th><th>이름</th><th>역할</th><th>연락처</th><th>마지막 로그인</th><th>상태</th><th></th></tr></thead>
      <tbody>${d.accounts.map((a) => `<tr data-id="${a.id}">
        <td><b>${esc(a.login_id)}</b></td>
        <td><input class="inline-edit" value="${esc(a.name)}" data-f="name"></td>
        <td><select class="inline-edit" data-f="role">${d.roles.map((r) => `<option ${a.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
        <td><input class="inline-edit" value="${esc(a.phone)}" data-f="phone"></td>
        <td class="mini">${esc(a.last_login_at) || '없음'}${a.must_change ? '<br><span style="color:var(--amber-600)">비밀번호 변경 필요</span>' : ''}</td>
        <td>${a.active ? '사용중' : '<span class="muted">중지</span>'}</td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="saveAccount(${a.id})">저장</button>
          <button class="btn btn-sm btn-ghost" onclick="resetAccountPw(${a.id}, '${esc(a.login_id)}')">비밀번호 재발급</button>
          <button class="btn btn-sm ${a.active ? 'btn-danger' : 'btn-outline'}" onclick="toggleAccount(${a.id}, ${a.active ? 0 : 1})">${a.active ? '사용 중지' : '사용 재개'}</button>
        </td></tr>`).join('')}</tbody>
    </table></div>
    <div class="panel">
      <h3>변경 기록</h3>
      <div class="table-scroll"><table>
        <thead><tr><th>일시</th><th>담당자</th><th>작업</th><th>대상</th><th>내용</th><th>접속 IP</th></tr></thead>
        <tbody>${d.logs.map((l) => `<tr><td class="mini">${esc(l.created_at)}</td><td>${esc(l.actor_name) || '-'}</td>
          <td>${esc(l.action)}</td><td class="mini">${esc(l.target) || '-'}</td>
          <td class="mini">${esc(l.detail) || ''}</td><td class="mini">${esc(l.ip) || ''}</td></tr>`).join('')
          || '<tr><td colspan="6" class="muted">기록이 없습니다.</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

function accountRow(id) {
  const tr = document.querySelector(`tr[data-id="${id}"]`);
  const out = {};
  tr.querySelectorAll('[data-f]').forEach((el) => { out[el.dataset.f] = el.value; });
  return out;
}

async function createAccount() {
  try {
    await api('/api/admin/accounts', { method: 'POST', body: {
      loginId: $('acLoginId').value.trim(), name: $('acName').value.trim(),
      phone: $('acPhone').value.trim(), role: $('acRole').value, password: $('acPw').value.trim() } });
    alert(`계정을 만들었습니다.\n아이디: ${$('acLoginId').value.trim()}\n초기 비밀번호를 담당자에게 안전하게 전달하세요.`);
    renderAccounts();
  } catch (err) { $('acMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
}

async function saveAccount(id) {
  try { await api(`/api/admin/accounts/${id}`, { method: 'PUT', body: accountRow(id) }); renderAccounts(); }
  catch (err) { alert(err.message); }
}

async function toggleAccount(id, active) {
  if (!active && !confirm('이 계정의 사용을 중지하면 즉시 로그아웃됩니다. 계속할까요?')) return;
  try { await api(`/api/admin/accounts/${id}`, { method: 'PUT', body: { active: !!active } }); renderAccounts(); }
  catch (err) { alert(err.message); }
}

async function resetAccountPw(id, loginId) {
  const pw = prompt(`${loginId} 계정의 새 비밀번호를 입력하세요 (8자 이상)`);
  if (!pw) return;
  try {
    await api(`/api/admin/accounts/${id}`, { method: 'PUT', body: { password: pw } });
    alert('비밀번호를 재발급했습니다.'); renderAccounts();
  } catch (err) { alert(err.message); }
}
async function doLogout() { await api('/api/admin/logout', { method: 'POST' }); location.reload(); }

async function boot() {
  const me = await api('/api/admin/me');
  state.me = me.user || null;
  applyRole();
  state.channels = me.channels;
  state.orderStatuses = me.orderStatuses;
  state.refundBearers = me.refundBearers || ['공급처', '소비자', '히스메이커스'];
  state.refundReasons = me.refundReasons || [];
  state.supplierStatuses = me.supplierStatuses || ['협의중', '계약중', '계약종료'];
  document.querySelectorAll('.admin-nav button').forEach((b) => { b.onclick = () => switchView(b.dataset.view); });
  switchView('dashboard');
}

function switchView(v) {
  document.querySelectorAll('.admin-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  document.querySelectorAll('.admin-wrap > section').forEach((s) => s.classList.toggle('hidden', s.id !== `view-${v}`));
  ({ dashboard: renderDashboard, products: renderProducts, channels: renderChannels, orders: renderOrders,
     suppliers: renderSuppliers, commissions: renderCommissions, settlement: renderSettlement,
     settings: renderSettings, accounts: renderAccounts }[v])();
}

/* ── 대시보드 ── */
async function renderDashboard() {
  const d = await api('/api/admin/dashboard');
  $('view-dashboard').innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><div class="k">계약 공급처</div><div class="v">${d.counts.suppliers}곳</div></div>
      <div class="kpi ${d.counts.productsPending ? 'warn' : ''}"><div class="k">승인 대기 상품</div><div class="v">${d.counts.productsPending}건</div></div>
      <div class="kpi"><div class="k">판매중 상품</div><div class="v">${d.counts.productsOnSale}건</div></div>
      <div class="kpi ${d.counts.ordersToForward ? 'danger' : ''}"><div class="k">공급처 전달 대기</div><div class="v">${d.counts.ordersToForward}건</div></div>
      <div class="kpi"><div class="k">이번 달 판매금액</div><div class="v">${won(d.sales.sales)}</div></div>
      <div class="kpi"><div class="k">이번 달 수수료 수익</div><div class="v">${won(d.sales.commission)}</div></div>
    </div>

    ${d.counts.ordersToForward ? `<div class="alert alert-warn">공급처에 전달하지 않은 주문이 ${d.counts.ordersToForward}건 있습니다.
      계약상 영업일 기준 1일 이내에 전달해야 합니다. → <button class="btn btn-sm btn-primary" onclick="switchView('orders')">주문 관리로 이동</button></div>` : ''}

    <div class="panel">
      <h3>승인 대기 상품</h3>
      <table><thead><tr><th>상품</th><th>공급처</th><th class="num">권장판매가</th><th>등록일</th><th></th></tr></thead>
      <tbody>${d.pendingProducts.map((p) => `<tr>
        <td>${esc(p.name)}</td><td>${esc(p.supplier_name)}</td>
        <td class="num">${p.suggested_price ? won(p.suggested_price) : '<span class="mini" style="color:var(--red-600)">미입력</span>'}</td>
        <td class="mini">${esc(p.created_at)}</td>
        <td><button class="btn btn-sm btn-outline" onclick="switchView('products')">검수</button></td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">승인 대기 중인 상품이 없습니다.</td></tr>'}</tbody></table>
    </div>

    <div class="panel">
      <h3>공급처별 누적 실적</h3>
      <table><thead><tr><th>공급처</th><th class="num">주문</th><th class="num">판매금액</th><th class="num">수수료</th><th class="num">지급대상</th></tr></thead>
      <tbody>${d.bySupplier.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${s.orders}</td>
        <td class="num">${won(s.sales)}</td><td class="num">${won(s.commission)}</td><td class="num">${won(s.payout)}</td></tr>`).join('')}</tbody></table>
    </div>

    <div class="panel">
      <h3>채널별 판매</h3>
      <table><thead><tr><th>채널</th><th class="num">주문</th><th class="num">판매금액</th></tr></thead>
      <tbody>${d.byChannel.map((c) => `<tr><td>${esc(c.channel)}</td><td class="num">${c.orders}</td><td class="num">${won(c.amount)}</td></tr>`).join('')
        || '<tr><td colspan="3" class="muted">판매 내역이 없습니다.</td></tr>'}</tbody></table>
    </div>`;
}

/* ── 상품 승인·관리 ── */
let productFilter = { status: '', q: '' };

async function renderProducts() {
  const params = new URLSearchParams();
  if (productFilter.status) params.set('status', productFilter.status);
  if (productFilter.q) params.set('q', productFilter.q);
  const d = await api(`/api/admin/products?${params}`);
  state.products = d.products;

  $('view-products').innerHTML = `
    <div class="toolbar">
      <input id="pq" placeholder="상품명·분류 검색" value="${esc(productFilter.q)}">
      <select id="pstatus"><option value="">전체 상태</option>
        ${d.statuses.map((s) => `<option ${productFilter.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" onclick="applyProductFilter()">조회</button>
      <a class="btn btn-sm btn-outline" href="/api/admin/export/products.csv?channel=자사몰">상품 CSV 내보내기</a>
      <span class="mini">${d.products.length}건</span>
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th>사진</th><th>상품</th><th>공급처</th><th>분류</th><th class="num">공급가</th><th class="num">권장판매가</th>
        <th class="num">재고</th><th>수수료</th><th>상태</th><th>채널 노출</th><th></th></tr></thead>
      <tbody>${d.products.map((p) => `<tr>
        <td>${p.images[0] ? `<img src="${esc(p.images[0].url)}" style="width:44px;height:44px;object-fit:cover;border-radius:6px">` : '<span class="mini muted">없음</span>'}</td>
        <td><b>${esc(p.name)}</b><br><span class="mini">${esc(p.spec)}${p.origin ? ` · ${esc(p.origin)}` : ''}</span>
          ${p.reject_reason ? `<br><span class="mini" style="color:var(--red-600)">반려: ${esc(p.reject_reason)}</span>` : ''}</td>
        <td class="mini">${esc(p.supplier_name)}</td>
        <td class="mini">${esc(p.category)}</td>
        <td class="num">${p.supply_price ? won(p.supply_price) : '<span class="mini muted">미입력</span>'}</td>
        <td class="num">${p.suggested_price ? won(p.suggested_price) : '<span class="mini muted">미입력</span>'}</td>
        <td class="num">${p.stock}</td>
        <td><span class="rate-tag ${p.rate_source === '상품 개별' ? 'own' : p.rate_confirmed ? 'base' : 'none'}">
          ${p.rate_confirmed ? `${asPct(p.effective_rate)}%` : '미확정'}</span></td>
        <td><span class="badge b-${esc(p.status)}">${esc(p.status)}</span></td>
        <td class="mini">${p.channels.filter((c) => c.listed).map((c) => c.channel).join(', ') || '-'}</td>
        <td>
          ${p.status === '승인대기' ? `<button class="btn btn-sm btn-primary" onclick="approve(${p.id}, true)">승인</button>
            <button class="btn btn-sm btn-danger" onclick="approve(${p.id}, false)">반려</button>` : ''}
          <button class="btn btn-sm btn-outline" onclick="openProduct(${p.id})">상세</button>
        </td></tr>`).join('') || '<tr><td colspan="11" class="muted">상품이 없습니다.</td></tr>'}
      </tbody></table></div>`;
}

function applyProductFilter() {
  productFilter = { q: $('pq').value.trim(), status: $('pstatus').value };
  renderProducts();
}

async function approve(id, ok) {
  try {
    if (ok) {
      if (!confirm('이 상품을 승인하고 자사몰에 노출할까요?')) return;
      await api(`/api/admin/products/${id}/approve`, { method: 'PATCH', body: { approve: true } });
    } else {
      const reason = prompt('반려 사유를 입력해 주세요. (공급처 화면에 그대로 표시됩니다)');
      if (!reason) return;
      await api(`/api/admin/products/${id}/approve`, { method: 'PATCH', body: { approve: false, reason } });
    }
    renderProducts();
  } catch (err) { alert(err.message); }
}

function openProduct(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  $('dlgTitle').textContent = `상품 상세 — ${p.name}`;
  $('dlgBody').innerHTML = `
    ${p.images.length ? `<div class="thumb-list" style="margin-bottom:12px">${p.images.map((i) => `<figure><img src="${esc(i.url)}" alt=""></figure>`).join('')}</div>` : ''}
    <div class="row-form">
      <div style="grid-column:1/-1"><label class="mini">상품명</label><input id="epName" value="${esc(p.name)}"></div>
      <div><label class="mini">분류</label><input id="epCategory" value="${esc(p.category)}"></div>
      <div><label class="mini">규격</label><input id="epSpec" value="${esc(p.spec)}"></div>
      <div><label class="mini">원산지</label><input id="epOrigin" value="${esc(p.origin)}"></div>
      <div><label class="mini">소비기한</label><input id="epShelf" value="${esc(p.shelf_life)}"></div>
      <div><label class="mini">공급가</label><input id="epSupply" type="number" value="${p.supply_price}"></div>
      <div><label class="mini">권장판매가</label><input id="epSuggested" type="number" value="${p.suggested_price}"></div>
      <div><label class="mini">재고</label><input id="epStock" type="number" value="${p.stock}"></div>
      <div><label class="mini">개별 수수료율 (%)</label>
        <input id="epRate" type="number" step="0.1" min="0" max="100" value="${asPct(p.commission_rate)}"
          placeholder="비우면 공급처 기본율"></div>
      <div><label class="mini">적용 요율</label>
        <input value="${p.rate_confirmed ? `${asPct(p.effective_rate)}% (${p.rate_source})` : '미확정'}" disabled></div>
      <div><label class="mini">상태</label><select id="epStatus">
        ${['승인대기', '판매중', '반려', '품절', '판매중지'].map((s) => `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div style="grid-column:1/-1"><label class="mini">원재료명</label><input id="epIngredients" value="${esc(p.ingredients)}"></div>
      <div style="grid-column:1/-1"><label class="mini">상품정보 제공고시</label><textarea id="epNotice" rows="2">${esc(p.notice_items)}</textarea></div>
      <div style="grid-column:1/-1"><label class="mini">상품 설명</label><textarea id="epDesc" rows="3">${esc(p.description)}</textarea></div>
    </div>
    <h4 style="margin-top:18px">채널 연동</h4>
    <p class="mini">외부 채널은 1단계에서 수동 등록입니다. 등록한 채널 URL을 적어 두면 상품 CSV 내보내기에 함께 나갑니다.</p>
    <div id="chBox">${channelRows(p)}</div>
    <div id="epMsg"></div>`;
  $('dlgFoot').innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="dlg.close()">닫기</button>
    <button class="btn btn-sm btn-primary" onclick="saveProduct(${p.id})">상품 정보 저장</button>`;
  dlg.showModal();
}

function channelRows(p) {
  return state.channels.map((ch) => {
    const c = p.channels.find((x) => x.channel === ch) || {};
    return `<div class="channel-row" data-ch="${esc(ch)}">
      <b>${esc(ch)}</b>
      <label class="mini"><input type="checkbox" class="chListed" ${c.listed ? 'checked' : ''}> 노출</label>
      <input class="chPrice" type="number" placeholder="채널 판매가 (비우면 권장판매가)" value="${c.channel_price ?? ''}">
      <input class="chUrl" placeholder="채널 상품 URL" value="${esc(c.channel_url)}">
      <button class="btn btn-sm btn-primary" onclick="saveChannel(${p.id}, '${esc(ch)}', this)">저장</button>
    </div>`;
  }).join('');
}

async function saveChannel(productId, channel, btn, force) {
  const row = btn.closest('.channel-row');
  const body = {
    channel,
    listed: row.querySelector('.chListed').checked,
    channelPrice: row.querySelector('.chPrice').value,
    channelUrl: row.querySelector('.chUrl').value.trim(),
    force: !!force,
  };
  try {
    await api(`/api/admin/products/${productId}/channels`, { method: 'PUT', body });
    $('epMsg').innerHTML = `<div class="alert alert-ok">${esc(channel)} 채널 설정을 저장했습니다.</div>`;
    renderProducts();
  } catch (err) {
    if (err.status === 409) {
      if (confirm(`${err.message}\n\n공급처 사전 동의를 받았다면 [확인]을 눌러 그대로 저장합니다.`)) {
        return saveChannel(productId, channel, btn, true);
      }
      return;
    }
    $('epMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

async function saveProduct(id) {
  try {
    await api(`/api/admin/products/${id}`, { method: 'PUT', body: {
      name: $('epName').value.trim(), category: $('epCategory').value.trim(), spec: $('epSpec').value.trim(),
      origin: $('epOrigin').value.trim(), shelfLife: $('epShelf').value.trim(),
      ingredients: $('epIngredients').value.trim(), noticeItems: $('epNotice').value.trim(),
      description: $('epDesc').value.trim(), supplyPrice: Number($('epSupply').value || 0),
      suggestedPrice: Number($('epSuggested').value || 0), stock: Number($('epStock').value || 0),
      status: $('epStatus').value, commissionRate: $('epRate').value.trim(),
    } });
    dlg.close();
    renderProducts();
  } catch (err) { $('epMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
}

/* ── 채널 연동 한눈에 보기 ── */
async function renderChannels() {
  const d = await api('/api/admin/products?status=판매중');
  $('view-channels').innerHTML = `
    <div class="toolbar">
      ${state.channels.map((ch) => `<a class="btn btn-sm btn-outline" href="/api/admin/export/products.csv?channel=${encodeURIComponent(ch)}">${esc(ch)} 업로드용 CSV</a>`).join('')}
    </div>
    <div class="panel">
      <p class="mini">자사몰이 상품 데이터의 단일 원천입니다. 여기서 켠 채널로 상품을 내보내면 같은 정보가 그대로 쓰입니다.
        1단계에서는 외부 채널 등록이 수동이므로, 등록을 마친 뒤 채널 URL을 입력해 연결 상태를 관리하십시오.</p>
      <div class="table-scroll"><table>
        <thead><tr><th>상품</th><th>공급처</th><th class="num">권장판매가</th>
          ${state.channels.map((c) => `<th class="num">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${d.products.map((p) => `<tr>
          <td><b>${esc(p.name)}</b><br><span class="mini">${esc(p.spec)}</span></td>
          <td class="mini">${esc(p.supplier_name)}</td>
          <td class="num">${won(p.suggested_price)}</td>
          ${state.channels.map((ch) => {
            const c = p.channels.find((x) => x.channel === ch) || {};
            return `<td class="num">${c.listed
              ? `<span class="badge b-판매중">노출</span><br><span class="mini">${won(c.channel_price || p.suggested_price)}</span>${c.channel_url ? `<br><a class="mini" href="${esc(c.channel_url)}" target="_blank" rel="noopener">링크</a>` : ''}`
              : '<span class="mini muted">미노출</span>'}</td>`;
          }).join('')}
        </tr>`).join('') || `<tr><td colspan="${3 + state.channels.length}" class="muted">판매중인 상품이 없습니다.</td></tr>`}
        </tbody></table></div>
    </div>`;
}

/* ── 주문 관리 ── */
let orderFilter = { status: '', channel: '', q: '' };

async function renderOrders() {
  const params = new URLSearchParams();
  Object.entries(orderFilter).forEach(([k, v]) => { if (v) params.set(k, v); });
  const d = await api(`/api/admin/orders?${params}`);

  $('view-orders').innerHTML = `
    <div class="toolbar">
      <input id="oq" placeholder="주문번호·주문자·연락처" value="${esc(orderFilter.q)}">
      <select id="ostatus"><option value="">전체 상태</option>
        ${d.statuses.map((s) => `<option ${orderFilter.status === s ? 'selected' : ''}>${s} (${d.counts[s]})</option>`).join('')}</select>
      <select id="ochannel"><option value="">전체 채널</option>
        ${d.channels.map((c) => `<option ${orderFilter.channel === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <button class="btn btn-sm btn-primary" onclick="applyOrderFilter()">조회</button>
      <button class="btn btn-sm btn-outline" onclick="openManualOrder()">외부 채널 주문 수동 등록</button>
    </div>
    <div class="table-scroll"><table>
      <thead><tr><th>주문번호</th><th>일시</th><th>채널</th><th>주문자</th><th>상품</th>
        <th class="num">금액</th><th>입금</th><th>상태</th><th></th></tr></thead>
      <tbody>${d.orders.map((o) => `<tr>
        <td><b>${esc(o.order_no)}</b></td>
        <td class="mini">${esc(o.created_at)}</td>
        <td class="mini">${esc(o.channel)}</td>
        <td>${esc(o.customer_name)}<br><span class="mini">${esc(o.customer_phone)}</span></td>
        <td class="mini">${o.items.map((i) => `${esc(i.name)} ×${i.qty}`).join('<br>')}</td>
        <td class="num">${won(o.total_amount)}</td>
        <td><label class="mini"><input type="checkbox" ${o.paid ? 'checked' : ''} onchange="setPaid(${o.id}, this.checked)"> 확인</label></td>
        <td><select onchange="setOrderStatus(${o.id}, this.value)">
          ${d.statuses.map((s) => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><button class="btn btn-sm btn-outline" onclick="openOrder(${o.id})">상세</button></td>
      </tr>`).join('') || '<tr><td colspan="9" class="muted">주문이 없습니다.</td></tr>'}
      </tbody></table></div>`;
}

function applyOrderFilter() {
  orderFilter = { q: $('oq').value.trim(), status: $('ostatus').value.replace(/\s*\(\d+\)$/, ''), channel: $('ochannel').value };
  renderOrders();
}

async function setOrderStatus(id, status) {
  if (status === '반품') return openRefundDialog(id);
  try { await api(`/api/admin/orders/${id}/status`, { method: 'PATCH', body: { status } }); renderOrders(); }
  catch (err) { alert(err.message); renderOrders(); }
}

/** 반품 처리 — 계약서 제7조의 비용 부담 주체를 함께 기록한다. */
function openRefundDialog(id) {
  $('dlgTitle').textContent = '반품 처리';
  $('dlgBody').innerHTML = `
    <p class="mini">계약서 제7조에 따라 반품 사유와 비용 부담 주체를 기록합니다.
      공급처 부담으로 기록한 비용은 해당 공급처의 정산 지급액에서 공제됩니다.</p>
    <div class="row-form">
      <div><label class="mini">반품 사유</label>
        <select id="rfReason" onchange="suggestBearer()">
          ${state.refundReasons.map((r) => `<option>${esc(r)}</option>`).join('')}
        </select></div>
      <div><label class="mini">비용 부담 주체</label>
        <select id="rfBearer">${state.refundBearers.map((b) => `<option>${esc(b)}</option>`).join('')}</select></div>
      <div><label class="mini">반품 처리 비용 (원)</label><input id="rfCost" type="number" value="0"></div>
    </div>
    <p class="mini" style="margin-top:8px">
      상품 하자·오배송·표시 상이 → <b>공급처</b> 부담 · 단순 변심 → <b>소비자</b> 부담 ·
      상품정보 오기재·주문 전달 누락 → <b>히스메이커스</b> 부담
    </p>
    <div id="rfMsg"></div>`;
  $('dlgFoot').innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="dlg.close(); renderOrders();">취소</button>
    <button class="btn btn-sm btn-danger" onclick="submitRefund(${id})">반품 처리</button>`;
  dlg.showModal();
  suggestBearer();
}

function suggestBearer() {
  const map = {
    '상품 하자': '공급처', '오배송': '공급처', '표시·광고 상이': '공급처',
    '단순 변심': '소비자', '상품정보 오기재': '히스메이커스', '주문 전달 누락': '히스메이커스',
  };
  const bearer = map[$('rfReason').value];
  if (bearer) $('rfBearer').value = bearer;
}

async function submitRefund(id) {
  try {
    await api(`/api/admin/orders/${id}/status`, { method: 'PATCH', body: {
      status: '반품', refundReason: $('rfReason').value,
      refundBearer: $('rfBearer').value, refundCost: Number($('rfCost').value || 0),
    } });
    dlg.close();
    renderOrders();
  } catch (err) { $('rfMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
}
async function setPaid(id, paid) {
  await api(`/api/admin/orders/${id}/paid`, { method: 'PATCH', body: { paid } });
}

async function openOrder(id) {
  const d = await api(`/api/admin/orders/${id}`);
  $('dlgTitle').textContent = `주문 상세 — ${d.order.order_no}`;
  $('dlgBody').innerHTML = `
    <table class="spec-table"><tbody>
      <tr><th>주문자</th><td>${esc(d.order.customer_name)} (${esc(d.order.customer_phone)})</td></tr>
      <tr><th>배송지</th><td>${esc(d.order.zipcode)} ${esc(d.order.address)} ${esc(d.order.address_detail)}</td></tr>
      <tr><th>요청사항</th><td>${esc(d.order.memo) || '-'}</td></tr>
      <tr><th>결제</th><td>${esc(d.order.pay_method)} · ${d.order.paid ? '입금확인' : '입금대기'} · ${won(d.order.total_amount)}
        <span class="mini">(상품 ${won(d.order.goods_amount)} + 배송비 ${won(d.order.shipping_fee)})</span></td></tr>
      ${d.order.status === '반품' ? `<tr><th>반품</th><td>${esc(d.order.refund_reason) || '-'} ·
        비용 부담 <b>${esc(d.order.refund_bearer) || '-'}</b>${d.order.refund_cost ? ` · ${won(d.order.refund_cost)}` : ''}</td></tr>` : ''}
    </tbody></table>
    <h4 style="margin-top:16px">주문 상품 · 공급처 전달 정보</h4>
    <table><thead><tr><th>상품</th><th>공급처</th><th class="num">수량</th><th class="num">판매금액</th>
      <th class="num">수수료</th><th class="num">정산액</th><th>송장</th></tr></thead>
      <tbody>${d.items.map((i) => `<tr>
        <td>${esc(i.name)}<br><span class="mini">${esc(i.spec)}</span></td>
        <td>${esc(i.supplier_name)}<br><span class="mini">${esc(i.supplier_phone)}</span></td>
        <td class="num">${i.qty}</td><td class="num">${won(i.subtotal)}</td>
        <td class="num">${won(i.commission_amt)} <span class="mini">(${pct(i.commission_rate)})</span></td>
        <td class="num">${won(i.settle_amt)}</td>
        <td class="mini">${esc(i.tracking_no) || '<span class="muted">미입력</span>'}</td></tr>`).join('')}
      </tbody></table>
    <h4 style="margin-top:16px">처리 이력</h4>
    <table><tbody>${d.logs.map((l) => `<tr><td class="mini">${esc(l.created_at)}</td>
      <td>${esc(l.from_status) || '-'} → <b>${esc(l.to_status)}</b></td><td class="mini">${esc(l.memo) || ''}</td></tr>`).join('')}</tbody></table>`;
  $('dlgFoot').innerHTML = `<button class="btn btn-sm btn-ghost" onclick="dlg.close()">닫기</button>`;
  dlg.showModal();
}

async function openManualOrder() {
  const d = await api('/api/admin/products?status=판매중');
  state.manualOrder = [];
  $('dlgTitle').textContent = '외부 채널 주문 수동 등록';
  $('dlgBody').innerHTML = `
    <p class="mini">쿠팡 등 API 연동 전 채널의 주문을 직접 입력합니다. 입력한 주문도 정산에 함께 집계됩니다.</p>
    <div class="row-form">
      <div><label class="mini">채널</label><select id="moChannel">
        ${state.channels.filter((c) => c !== '자사몰').map((c) => `<option>${c}</option>`).join('')}</select></div>
      <div><label class="mini">채널 주문번호</label><input id="moExternal" placeholder="예: 3000123456"></div>
      <div><label class="mini">주문자 *</label><input id="moName"></div>
      <div><label class="mini">연락처</label><input id="moPhone"></div>
      <div style="grid-column:1/-1"><label class="mini">배송지</label><input id="moAddress"></div>
      <div><label class="mini">배송비</label><input id="moShip" type="number" value="0"></div>
      <div style="grid-column:1/-1"><label class="mini">상품 추가</label>
        <select id="moPick" onchange="addManualItem(this.value); this.value='';">
          <option value="">선택…</option>
          ${d.products.map((p) => `<option value="${p.id}">[${esc(p.supplier_name)}] ${esc(p.name)} — ${won(p.suggested_price)}</option>`).join('')}
        </select></div>
    </div>
    <div id="moItems"></div>
    <div id="moMsg"></div>`;
  $('dlgFoot').innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="dlg.close()">취소</button>
    <button class="btn btn-sm btn-primary" onclick="submitManualOrder()">주문 등록</button>`;
  state.manualCatalog = d.products;
  renderManualItems();
  dlg.showModal();
}

function addManualItem(id) {
  if (!id) return;
  const p = state.manualCatalog.find((x) => x.id === Number(id));
  if (!p) return;
  const existing = state.manualOrder.find((i) => i.productId === p.id);
  if (existing) existing.qty += 1;
  else state.manualOrder.push({ productId: p.id, name: p.name, qty: 1, unitPrice: p.suggested_price });
  renderManualItems();
}

function renderManualItems() {
  const total = state.manualOrder.reduce((a, i) => a + i.unitPrice * i.qty, 0);
  $('moItems').innerHTML = `
    <table><thead><tr><th>상품</th><th class="num">단가</th><th class="num">수량</th><th class="num">금액</th><th></th></tr></thead>
      <tbody>${state.manualOrder.map((i, idx) => `<tr>
        <td>${esc(i.name)}</td>
        <td class="num"><input type="number" value="${i.unitPrice}" style="width:100px;text-align:right"
          onchange="state.manualOrder[${idx}].unitPrice=Number(this.value);renderManualItems()"></td>
        <td class="num"><input type="number" min="1" value="${i.qty}" style="width:64px;text-align:right"
          onchange="state.manualOrder[${idx}].qty=Number(this.value);renderManualItems()"></td>
        <td class="num">${won(i.unitPrice * i.qty)}</td>
        <td><button class="btn btn-sm btn-ghost" onclick="state.manualOrder.splice(${idx},1);renderManualItems()">삭제</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">상품을 추가해 주세요.</td></tr>'}</tbody></table>
    <p style="text-align:right;font-weight:800">상품 합계 ${won(total)}</p>`;
}

async function submitManualOrder() {
  try {
    const d = await api('/api/admin/orders', { method: 'POST', body: {
      channel: $('moChannel').value, externalNo: $('moExternal').value.trim(),
      customerName: $('moName').value.trim(), customerPhone: $('moPhone').value.trim(),
      address: $('moAddress').value.trim(), shippingFee: Number($('moShip').value || 0),
      items: state.manualOrder,
    } });
    dlg.close();
    renderOrders();
    alert(`등록 완료 · 주문번호 ${d.orderNo} · 합계 ${won(d.total)}`);
  } catch (err) { $('moMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
}

/* ── 공급처 · 계약 ── */
async function renderSuppliers() {
  const d = await api('/api/admin/suppliers');
  state.suppliers = d.suppliers;
  $('view-suppliers').innerHTML = `
    <div class="toolbar"><button class="btn btn-sm btn-outline" onclick="openSupplier()">공급처 추가</button></div>
    ${d.suppliers.some((s) => s.contract?.commission_rate == null)
      ? '<div class="alert alert-warn">판매수수료율이 확정되지 않은 공급처가 있습니다. 수수료가 0%로 계산되므로 계약 확정 후 반드시 입력해 주세요.</div>' : ''}
    <div class="table-scroll"><table>
      <thead><tr><th>상호</th><th>대표자</th><th>사업자등록번호</th><th>아이디</th><th class="num">수수료</th>
        <th>정산주기</th><th>배송</th><th class="num">할인한도</th><th class="num">상품</th><th>상태</th><th></th></tr></thead>
      <tbody>${d.suppliers.map((s) => `<tr>
        <td><b>${esc(s.name)}</b><br><span class="mini">${esc(s.address)}</span></td>
        <td>${esc(s.ceo)}</td>
        <td class="mini">${esc(s.bizNo)}<br>${esc(s.taxType)}</td>
        <td class="mini">${esc(s.loginId)}</td>
        <td class="num">${s.contract?.commission_rate == null
          ? '<span style="color:var(--red-600);font-weight:700">미확정</span>' : pct(s.contract.commission_rate)}</td>
        <td class="mini">${esc(s.contract?.settlement_cycle)}</td>
        <td class="mini">${esc(s.contract?.shipping_method)}${s.contract?.ship_days ? `<br>영업일 ${s.contract.ship_days}일` : ''}</td>
        <td class="num">${s.contract?.discount_limit_rate == null ? '<span class="mini muted">미확정</span>' : pct(s.contract.discount_limit_rate)}</td>
        <td class="num">${s.productCount}</td>
        <td><span class="badge b-${esc(s.status)}">${esc(s.status)}</span></td>
        <td><button class="btn btn-sm btn-outline" onclick="openSupplier(${s.id})">계약 · 정보</button></td>
      </tr>`).join('')}</tbody></table></div>`;
}

function openSupplier(id) {
  const s = id ? state.suppliers.find((x) => x.id === id) : null;
  const c = s?.contract || {};
  $('dlgTitle').textContent = s ? `공급처 — ${s.name}` : '공급처 추가';
  $('dlgBody').innerHTML = `
    <h4>사업자 정보</h4>
    <div class="row-form">
      <div><label class="mini">상호 *</label><input id="sName" value="${esc(s?.name)}"></div>
      <div><label class="mini">대표자</label><input id="sCeo" value="${esc(s?.ceo)}"></div>
      <div><label class="mini">사업자등록번호</label><input id="sBizNo" value="${esc(s?.bizNo)}"></div>
      <div><label class="mini">과세유형</label><input id="sTaxType" value="${esc(s?.taxType)}" placeholder="일반과세자 / 간이과세자"></div>
      <div style="grid-column:1/-1"><label class="mini">사업장 주소</label><input id="sAddress" value="${esc(s?.address)}"></div>
      <div><label class="mini">연락처</label><input id="sPhone" value="${esc(s?.phone)}"></div>
      <div><label class="mini">이메일</label><input id="sEmail" value="${esc(s?.email)}"></div>
      <div><label class="mini">로그인 아이디 ${s ? '' : '*'}</label>
        <input id="sLoginId" value="${esc(s?.loginId)}" ${s ? 'disabled' : ''}></div>
      <div><label class="mini">${s ? '비밀번호 재설정 (8자 이상)' : '초기 비밀번호 (비우면 자동 생성)'}</label>
        <input id="sPassword" type="text" placeholder="${s ? '변경할 때만 입력' : '아이디+2026'}"></div>
      <div><label class="mini">상태</label><select id="sStatus">
        ${(state.supplierStatuses || ['협의중', '계약중', '계약종료']).map((v) =>
          `<option ${(s?.status || '협의중') === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div style="grid-column:1/-1"><label class="mini">소개글 (상품 상세페이지에 표시)</label>
        <textarea id="sIntro" rows="2">${esc(s?.intro)}</textarea></div>
    </div>

    <h4 style="margin-top:18px">위탁판매 계약 조건</h4>
    <div class="row-form">
      <div><label class="mini">판매수수료율 (%)</label>
        <input id="cRate" type="number" step="0.1" min="0" max="100" value="${asPct(c.commission_rate)}" placeholder="협의 전이면 비워 두세요"></div>
      <div><label class="mini">정산 주기</label><input id="cCycle" value="${esc(c.settlement_cycle || '익월 15일')}"></div>
      <div><label class="mini">배송 방식</label><input id="cShipping" value="${esc(c.shipping_method || '위탁배송(공급처 직발송)')}"></div>
      <div><label class="mini">출고 기한 (영업일)</label><input id="cShipDays" type="number" value="${c.ship_days ?? ''}"></div>
      <div><label class="mini">할인 허용 한도 (%)</label><input id="cDiscount" type="number" step="0.1" min="0" max="100" value="${asPct(c.discount_limit_rate)}" placeholder="협의 전이면 비워 두세요"></div>
      <div><label class="mini">채널수수료 부담</label><input id="cFeeBearer" value="${esc(c.channel_fee_bearer || '수탁자(히스메이커스) 부담')}"></div>
      <div><label class="mini">계약 시작일</label><input id="cStart" type="date" value="${esc(c.contract_start)}"></div>
      <div><label class="mini">계약 기간</label><input id="cPeriod" value="${esc(c.contract_period || '1년(자동연장)')}"></div>
      <div style="grid-column:1/-1"><label class="mini">수수료 비고</label><input id="cNote" value="${esc(c.commission_note)}"></div>
      <div style="grid-column:1/-1"><label class="mini">특약 · 비고</label><textarea id="cMemo" rows="2">${esc(c.note)}</textarea></div>
    </div>
    <p class="mini" style="margin-top:8px">
      수수료율을 비워 두면 "미확정"으로 저장되며, 주문 시 수수료가 0원으로 계산됩니다.<br>
      상품마다 다른 요율로 합의한 경우에는 <b>수수료 관리</b> 화면에서 상품별로 따로 입력하십시오.
    </p>
    <div id="sMsg"></div>`;
  $('dlgFoot').innerHTML = `
    <button class="btn btn-sm btn-ghost" onclick="dlg.close()">취소</button>
    <button class="btn btn-sm btn-primary" onclick="saveSupplier(${s ? s.id : 'null'})">저장</button>`;
  dlg.showModal();
}

async function saveSupplier(id) {
  const body = {
    name: $('sName').value.trim(), ceo: $('sCeo').value.trim(), bizNo: $('sBizNo').value.trim(),
    taxType: $('sTaxType').value.trim(), address: $('sAddress').value.trim(), phone: $('sPhone').value.trim(),
    email: $('sEmail').value.trim(), intro: $('sIntro').value.trim(), status: $('sStatus').value,
  };
  const contract = {
    commissionRate: $('cRate').value, commissionNote: $('cNote').value.trim(),
    settlementCycle: $('cCycle').value.trim(), shippingMethod: $('cShipping').value.trim(),
    shipDays: $('cShipDays').value, discountLimitRate: $('cDiscount').value,
    channelFeeBearer: $('cFeeBearer').value.trim(), contractStart: $('cStart').value,
    contractPeriod: $('cPeriod').value.trim(), note: $('cMemo').value.trim(),
  };
  try {
    if (id) {
      await api(`/api/admin/suppliers/${id}`, { method: 'PUT', body });
      await api(`/api/admin/suppliers/${id}/contract`, { method: 'PUT', body: contract });
      if ($('sPassword').value.trim()) {
        await api(`/api/admin/suppliers/${id}/password`, { method: 'POST', body: { password: $('sPassword').value.trim() } });
      }
    } else {
      const d = await api('/api/admin/suppliers', { method: 'POST', body: {
        ...body, ...contract, loginId: $('sLoginId').value.trim(), password: $('sPassword').value.trim(),
      } });
      alert(`공급처를 등록했습니다.\n아이디: ${$('sLoginId').value.trim()}\n초기 비밀번호: ${d.password}\n\n공급처에 안전하게 전달해 주세요.`);
    }
    dlg.close();
    renderSuppliers();
  } catch (err) { $('sMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
}

/* ── 수수료 관리 ── */

async function renderCommissions() {
  const d = await api('/api/admin/commissions');
  state.commissions = d;

  $('view-commissions').innerHTML = `
    <div class="panel">
      <h3>판매수수료율 관리</h3>
      <p class="mini">
        농가·소상공인과 협의한 요율을 여기서 바로 입력합니다. <b>%로 입력</b>하시면 됩니다(예: 20).<br>
        · <b>공급처 기본율</b> — 그 공급처의 모든 상품에 적용<br>
        · <b>상품 개별율</b> — 특정 상품만 다르게 합의한 경우에만 입력(비우면 기본율을 따릅니다)<br>
        · 비워 두면 <b>미확정</b>으로 표시되고 주문 시 수수료가 0원으로 계산됩니다.
      </p>
      ${d.unconfirmed.length ? `<div class="alert alert-warn">
        기본 수수료율이 정해지지 않은 공급처: <b>${d.unconfirmed.map((u) => esc(u.name)).join(', ')}</b>
        — 협의 후 입력해 주세요.</div>` : ''}
    </div>

    ${d.suppliers.map((sup) => `
      <div class="supplier-block" data-supplier="${sup.id}">
        <div class="supplier-head">
          <span class="nm">${esc(sup.name)}</span>
          <span class="badge b-${esc(sup.status)}">${esc(sup.status)}</span>
          <span class="mini">상품 ${sup.productCount}건${sup.overrideCount ? ` · 개별 요율 ${sup.overrideCount}건` : ''}</span>
          <span class="base">
            <label class="mini">기본 수수료율</label>
            <input class="rate-input supplier-rate ${sup.baseRate == null ? 'unset' : ''}" type="number" step="0.1" min="0" max="100"
              value="${asPct(sup.baseRate)}" placeholder="미정" data-id="${sup.id}">
            <span class="mini">%</span>
            <button class="btn btn-sm btn-ghost" onclick="resetOverrides(${sup.id})"
              ${sup.overrideCount ? '' : 'disabled'}>개별 요율 해제</button>
          </span>
        </div>
        ${sup.commissionNote ? `<p class="mini" style="padding:8px 14px 0;margin:0">계약 메모: ${esc(sup.commissionNote)}</p>` : ''}
        <table>
          <thead><tr><th>상품</th><th>분류</th><th class="num">권장판매가</th><th class="num">누적 판매</th>
            <th class="num">개별 요율(%)</th><th>적용 요율</th><th class="num">건당 수수료</th></tr></thead>
          <tbody>${sup.products.map((p) => `<tr>
            <td>${esc(p.name)}<br><span class="mini">${esc(p.spec)}</span></td>
            <td class="mini">${esc(p.category)}</td>
            <td class="num">${p.suggestedPrice ? won(p.suggestedPrice) : '<span class="mini muted">미입력</span>'}</td>
            <td class="num">${p.sold ? won(p.sold) : '-'}</td>
            <td class="num"><input class="rate-input product-rate" type="number" step="0.1" min="0" max="100"
              value="${asPct(p.ownRate)}" placeholder="기본율" data-id="${p.id}"></td>
            <td><span class="rate-tag ${p.rateSource === '상품 개별' ? 'own' : p.rateConfirmed ? 'base' : 'none'}">
              ${p.rateConfirmed ? `${asPct(p.effectiveRate)}% · ${esc(p.rateSource)}` : '미확정'}</span></td>
            <td class="num">${p.suggestedPrice && p.rateConfirmed
              ? `${won(Math.round(p.suggestedPrice * p.effectiveRate))} <span class="mini">(정산 ${won(p.suggestedPrice - Math.round(p.suggestedPrice * p.effectiveRate))})</span>`
              : '<span class="mini muted">-</span>'}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="muted">등록된 상품이 없습니다.</td></tr>'}</tbody>
        </table>
      </div>`).join('')}

    <div class="panel">
      <h3>수수료율 변경 이력</h3>
      <table><thead><tr><th>일시</th><th>대상</th><th>구분</th><th class="num">이전</th><th class="num">변경</th><th>메모</th></tr></thead>
        <tbody>${d.logs.map((l) => `<tr>
          <td class="mini">${esc(l.created_at)}</td>
          <td>${esc(l.supplier_name) || '-'}${l.product_name ? ` <span class="mini">/ ${esc(l.product_name)}</span>` : ''}</td>
          <td class="mini">${esc(l.scope)}</td>
          <td class="num">${l.old_rate == null ? '미정' : asPct(l.old_rate) + '%'}</td>
          <td class="num"><b>${l.new_rate == null ? '미정(기본율 적용)' : asPct(l.new_rate) + '%'}</b></td>
          <td class="mini">${esc(l.memo) || ''}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">변경 이력이 없습니다.</td></tr>'}</tbody></table>
    </div>

    <div class="commission-bar">
      <input id="cmMemo" placeholder="협의 메모 (예: 2026-09-16 김보연 대표 방문 협의)" style="flex:1;min-width:220px;padding:8px 10px;border:1px solid var(--line);border-radius:8px">
      <button class="btn btn-sm btn-primary" onclick="saveCommissions()">변경 내용 저장</button>
      <button class="btn btn-sm btn-ghost" onclick="renderCommissions()">되돌리기</button>
      <span id="cmMsg" class="mini"></span>
    </div>`;
}

async function saveCommissions() {
  const memo = $('cmMemo').value.trim();
  const suppliers = [...document.querySelectorAll('.supplier-rate')].map((el) => ({ id: Number(el.dataset.id), rate: el.value.trim() }));
  const products = [...document.querySelectorAll('.product-rate')].map((el) => ({ id: Number(el.dataset.id), rate: el.value.trim() }));
  try {
    const d = await api('/api/admin/commissions', { method: 'PUT', body: { suppliers, products, memo } });
    await renderCommissions();
    $('cmMsg').innerHTML = d.changed
      ? `<span style="color:var(--green-700);font-weight:700">${d.changed}건 저장했습니다.</span>`
      : '변경된 내용이 없습니다.';
  } catch (err) {
    $('cmMsg').innerHTML = `<span style="color:var(--red-600);font-weight:700">${esc(err.message)}</span>`;
  }
}

async function resetOverrides(supplierId) {
  if (!confirm('이 공급처의 상품 개별 요율을 모두 지우고 기본율로 되돌릴까요?')) return;
  const d = await api(`/api/admin/commissions/${supplierId}/reset`, { method: 'POST', body: { memo: $('cmMemo')?.value.trim() } });
  await renderCommissions();
  $('cmMsg').textContent = `${d.cleared}건을 기본율로 되돌렸습니다.`;
}

/* ── 정산 ── */
async function renderSettlement(from, to) {
  const q = from && to ? `?from=${from}&to=${to}` : '';
  const d = await api(`/api/admin/settlement${q}`);
  $('view-settlement').innerHTML = `
    <div class="toolbar">
      <input id="stf" type="date" value="${d.from}"> ~ <input id="stt" type="date" value="${d.to}">
      <button class="btn btn-sm btn-primary" onclick="renderSettlement($('stf').value, $('stt').value)">조회</button>
      <a class="btn btn-sm btn-outline" href="/api/admin/settlement.csv?from=${d.from}&to=${d.to}">판매·정산 내역 CSV</a>
    </div>
    <div class="panel">
      <h3>공급처별 정산 집계 (${d.from} ~ ${d.to})</h3>
      <table><thead><tr><th>공급처</th><th class="num">주문</th><th class="num">판매금액</th><th class="num">수수료</th>
        <th class="num">반품</th><th class="num">공급처 부담</th><th class="num">지급대상</th><th class="num">미정산</th><th></th></tr></thead>
        <tbody>${d.bySupplier.map((s) => `<tr>
          <td><b>${esc(s.supplier)}</b></td><td class="num">${s.orders}</td>
          <td class="num">${won(s.sales)}</td><td class="num">${won(s.commission)}</td>
          <td class="num">${won(s.refund)}</td>
          <td class="num">${s.supplierCost ? `<span style="color:var(--red-600)">−${won(s.supplierCost)}</span>` : '-'}</td>
          <td class="num"><b>${won(s.netPayout)}</b></td>
          <td class="num">${won(Math.max(0, s.unsettled))}</td>
          <td>${s.unsettled > 0
            ? `<button class="btn btn-sm btn-primary" onclick="closeSettlement(${s.supplierId},'${d.from}','${d.to}')">정산서 생성</button>`
            : '<span class="mini muted">마감됨</span>'}</td>
        </tr>`).join('') || '<tr><td colspan="9" class="muted">해당 기간 판매 내역이 없습니다.</td></tr>'}</tbody></table>
      <p class="mini" style="margin-top:10px">정산서를 생성하면 해당 기간의 미정산 판매 건이 묶여 마감되고, 공급처 화면에도 표시됩니다.</p>
    </div>
    <div class="panel">
      <h3>생성된 정산서</h3>
      <table><thead><tr><th>공급처</th><th>정산기간</th><th class="num">판매금액</th><th class="num">수수료</th>
        <th class="num">반품</th><th class="num">공급처 부담</th><th class="num">지급액</th><th>지급예정</th><th>상태</th><th></th></tr></thead>
        <tbody>${d.settlements.map((s) => `<tr>
          <td>${esc(s.supplier_name)}</td><td class="mini">${esc(s.period_from)} ~ ${esc(s.period_to)}</td>
          <td class="num">${won(s.sales_amount)}</td><td class="num">${won(s.commission_amt)}</td>
          <td class="num">${won(s.refund_amount)}</td>
          <td class="num">${s.supplier_cost ? `<span style="color:var(--red-600)">−${won(s.supplier_cost)}</span>` : '-'}</td>
          <td class="num"><b>${won(s.payout_amount)}</b></td>
          <td class="mini">${esc(s.pay_due)}</td>
          <td><span class="badge b-${esc(s.status)}">${esc(s.status)}</span></td>
          <td>
            <a class="btn btn-sm btn-outline" href="/api/admin/settlements/${s.id}/statement.csv">정산서</a>
            ${s.status !== '지급완료' ? `<button class="btn btn-sm btn-primary" onclick="markPaid(${s.id})">지급완료</button>` : ''}
          </td></tr>`).join('') || '<tr><td colspan="10" class="muted">생성된 정산서가 없습니다.</td></tr>'}</tbody></table>
    </div>`;
}

async function closeSettlement(supplierId, from, to) {
  if (!confirm(`${from} ~ ${to} 기간의 미정산 건을 마감하고 정산서를 생성할까요?`)) return;
  try {
    const d = await api('/api/admin/settlement', { method: 'POST', body: { supplierId, from, to } });
    alert(`정산서를 생성했습니다.\n판매 ${won(d.sales)} / 수수료 ${won(d.commission)}`
      + (d.supplierCost ? ` / 공급처 부담 비용 ${won(d.supplierCost)} 공제` : '')
      + `\n지급액 ${won(d.payout)} · 지급 예정일 ${d.payDue}`);
    renderSettlement(from, to);
  } catch (err) { alert(err.message); }
}

async function markPaid(id) {
  if (!confirm('지급 완료로 처리할까요?')) return;
  await api(`/api/admin/settlements/${id}`, { method: 'PATCH', body: { status: '지급완료' } });
  renderSettlement();
}

/* ── 설정 ── */
async function renderSettings() {
  const s = await api('/api/admin/settings');
  $('view-settings').innerHTML = `
    <div class="panel">
      <h3>쇼핑몰 · 사업자 정보</h3>
      <div class="row-form">
        <div><label class="mini">쇼핑몰 이름</label><input id="tMall" value="${esc(s.mallName)}"></div>
        <div><label class="mini">상호</label><input id="tOrg" value="${esc(s.orgName)}"></div>
        <div><label class="mini">사업자등록번호</label><input id="tBiz" value="${esc(s.orgBizNo)}"></div>
        <div><label class="mini">연락처</label><input id="tPhone" value="${esc(s.orgPhone)}"></div>
        <div style="grid-column:1/-1"><label class="mini">사업장 주소</label><input id="tAddr" value="${esc(s.orgAddress)}"></div>
        <div style="grid-column:1/-1"><label class="mini">입금 계좌 안내 (주문 완료 화면에 표시)</label><input id="tBank" value="${esc(s.bankAccount)}"></div>
        <div><label class="mini">기본 배송비 (원)</label><input id="tShip" type="number" value="${s.defaultShippingFee}"></div>
        <div><label class="mini">무료배송 기준 (원)</label><input id="tFree" type="number" value="${s.freeShipOver}"></div>
        <div style="grid-column:1/-1"><label class="mini">사이트 주소 (채널 CSV의 링크에 사용)</label>
          <input id="tBase" value="${esc(s.siteBaseUrl)}" placeholder="https://bmctvda.example.com"></div>
      </div>
      <div style="margin-top:12px"><button class="btn btn-sm btn-primary" onclick="saveSettings()">저장</button></div>
      <div id="setMsg"></div>
      <p class="mini" style="margin-top:14px">
        · 관리자 비밀번호는 서버 환경변수 <code>ADMIN_PASSWORD</code> 로 변경합니다.<br>
        · 배송비는 위탁배송 특성상 <b>공급처 단위</b>로 부과되며, 상품별로 따로 지정한 값이 있으면 그 값이 우선합니다.
      </p>
    </div>`;
}

async function saveSettings() {
  try {
    await api('/api/admin/settings', { method: 'PUT', body: {
      mallName: $('tMall').value, orgName: $('tOrg').value, orgBizNo: $('tBiz').value,
      orgPhone: $('tPhone').value, orgAddress: $('tAddr').value, bankAccount: $('tBank').value,
      defaultShippingFee: Number($('tShip').value), freeShipOver: Number($('tFree').value),
      siteBaseUrl: $('tBase').value.trim(),
    } });
    $('setMsg').innerHTML = '<div class="alert alert-ok">저장했습니다.</div>';
  } catch (err) { $('setMsg').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
}

(async function start() {
  const me = await fetch('/api/admin/me').then((r) => r.json()).catch(() => ({ authenticated: false }));
  if (me.authenticated) { showApp(); boot(); } else showLogin();
})();
