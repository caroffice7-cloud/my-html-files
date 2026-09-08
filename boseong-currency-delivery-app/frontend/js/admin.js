(function () {
  'use strict';

  const API_BASE = window.APP_CONFIG.API_BASE;
  const TOKEN_KEY = 'jayeonsarang_admin_token';
  const USER_KEY = 'jayeonsarang_admin_username';

  const loginView = document.getElementById('login-view');
  const dashboardView = document.getElementById('dashboard-view');
  const loginError = document.getElementById('login-error');

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function setSession(token, username) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, username);
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  }

  async function apiFetch(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      clearSession();
      showLogin('세션이 만료되었습니다. 다시 로그인해 주세요.');
      throw new Error('unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '요청 처리 중 오류가 발생했습니다.');
    return data;
  }

  function showLogin(errMsg) {
    loginView.classList.remove('hidden');
    dashboardView.classList.add('hidden');
    if (errMsg) {
      loginError.textContent = errMsg;
      loginError.classList.remove('hidden');
    }
  }

  function showDashboard() {
    loginView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    document.getElementById('admin-username-label').textContent = `${sessionStorage.getItem(USER_KEY)} 님`;
    loadApplications();
  }

  document.getElementById('login-btn').addEventListener('click', async () => {
    loginError.classList.add('hidden');
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      const res = await fetch(`${API_BASE}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '로그인에 실패했습니다.');
      setSession(data.token, data.username);
      document.getElementById('login-password').value = '';
      showDashboard();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.classList.remove('hidden');
    }
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    clearSession();
    showLogin();
  });

  document.getElementById('refresh-btn').addEventListener('click', loadApplications);
  document.getElementById('status-filter').addEventListener('change', loadApplications);

  async function loadApplications() {
    const status = document.getElementById('status-filter').value;
    const tbody = document.getElementById('rows-body');
    tbody.innerHTML = '';
    try {
      const rows = await apiFetch(`/applications${status ? `?status=${encodeURIComponent(status)}` : ''}`);
      document.getElementById('empty-msg').classList.toggle('hidden', rows.length > 0);
      rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${row.id}</td>
          <td>${new Date(row.createdAt).toLocaleString('ko-KR')}</td>
          <td>${row.name}</td>
          <td>${row.phone}</td>
          <td>${row.naturelinkMember ? '예' : '아니오'}</td>
          <td>${row.desiredPaymentAmount.toLocaleString()}원</td>
          <td>${row.desiredStart}</td>
          <td><span class="status-badge status-${row.status}">${row.status}</span></td>
          <td><button class="btn btn-secondary" data-id="${row.id}">상세</button></td>
        `;
        tr.querySelector('button[data-id]').addEventListener('click', () => openDetail(row.id));
        tbody.appendChild(tr);
      });
    } catch (err) {
      if (err.message !== 'unauthorized') alert(err.message);
    }
  }

  const detailModal = document.getElementById('detail-modal');
  let currentDetailId = null;

  async function openDetail(id) {
    try {
      const d = await apiFetch(`/applications/${id}`);
      currentDetailId = id;
      document.getElementById('detail-title').textContent = `신청 상세 #${d.id}`;
      document.getElementById('detail-content').innerHTML = `
        <dt>접수일시</dt><dd>${new Date(d.createdAt).toLocaleString('ko-KR')}</dd>
        <dt>성명</dt><dd>${d.name}</dd>
        <dt>생년월일</dt><dd>${d.birthdate}</dd>
        <dt>연락처(본인)</dt><dd>${d.phone}</dd>
        <dt>비상연락처</dt><dd>${d.emergencyPhone || '-'}</dd>
        <dt>배송지 주소</dt><dd>${d.address}</dd>
        <dt>자연사랑 회원</dt><dd>${d.naturelinkMember ? '예' : '아니오'}</dd>
        <dt>월 수령액</dt><dd>${d.monthlyCurrencyAmount ? d.monthlyCurrencyAmount.toLocaleString() + '원' : '-'}</dd>
        <dt>희망 결제액</dt><dd>${d.desiredPaymentAmount.toLocaleString()}원</dd>
        <dt>희망 시작월</dt><dd>${d.desiredStartYear}년 ${d.desiredStartMonth}월</dd>
        <dt>대리 작성자</dt><dd>${d.proxyWriter || '-'}</dd>
        <dt>개인정보 동의</dt><dd>${d.privacyAgreed ? '동의함' : '동의안함'}</dd>
        <dt>약관 동의</dt><dd>${d.termsAgreed ? '동의함' : '동의안함'}</dd>
        <dt>동의 IP</dt><dd>${d.consentIp || '-'}</dd>
        <dt>메모</dt><dd>${d.memo || '-'}</dd>
      `;
      document.getElementById('detail-sig-wrap').innerHTML = d.signature
        ? `<p class="hint">신청인 서명</p><img class="sig-preview" src="${d.signature}" alt="서명 이미지" />`
        : '';
      document.getElementById('detail-status-select').value = d.status;
      detailModal.classList.remove('hidden');
    } catch (err) {
      if (err.message !== 'unauthorized') alert(err.message);
    }
  }

  document.getElementById('detail-close-btn').addEventListener('click', () => {
    detailModal.classList.add('hidden');
    currentDetailId = null;
  });

  document.getElementById('detail-save-btn').addEventListener('click', async () => {
    if (!currentDetailId) return;
    const status = document.getElementById('detail-status-select').value;
    try {
      await apiFetch(`/applications/${currentDetailId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      detailModal.classList.add('hidden');
      loadApplications();
    } catch (err) {
      if (err.message !== 'unauthorized') alert(err.message);
    }
  });

  document.getElementById('detail-purge-btn').addEventListener('click', async () => {
    if (!currentDetailId) return;
    if (!confirm('정말로 이 신청 건의 개인정보를 영구 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
    try {
      await apiFetch(`/applications/${currentDetailId}`, { method: 'DELETE' });
      detailModal.classList.add('hidden');
      loadApplications();
    } catch (err) {
      if (err.message !== 'unauthorized') alert(err.message);
    }
  });

  // 세션 복원
  if (getToken()) {
    showDashboard();
  } else {
    showLogin();
  }
})();
