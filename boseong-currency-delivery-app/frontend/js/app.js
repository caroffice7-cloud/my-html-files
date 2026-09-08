(function () {
  'use strict';

  const API_BASE = window.APP_CONFIG.API_BASE;

  // ---------- 서비스워커 등록 (PWA: 모바일 홈화면 설치 + PC 브라우저 병행) ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch((err) => {
        console.warn('서비스워커 등록 실패:', err);
      });
    });
  }

  // ---------- 연/월 선택 옵션 채우기 ----------
  const yearSelect = document.getElementById('desiredStartYear');
  const monthSelect = document.getElementById('desiredStartMonth');
  const now = new Date();
  const currentYear = now.getFullYear();

  for (let y = currentYear; y <= currentYear + 2; y++) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = `${y}년`;
    yearSelect.appendChild(opt);
  }
  for (let m = 1; m <= 12; m++) {
    const opt = document.createElement('option');
    opt.value = String(m);
    opt.textContent = `${m}월`;
    monthSelect.appendChild(opt);
  }
  monthSelect.value = String(now.getMonth() + 1);

  document.getElementById('today-label').textContent = now.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // ---------- 서명 패드 ----------
  const canvas = document.getElementById('signature-pad');
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let hasSignature = false;
  const signatureStatus = document.getElementById('signature-status');

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a1a1a';
  }
  window.addEventListener('resize', () => {
    const dataUrl = hasSignature ? canvas.toDataURL('image/png') : null;
    resizeCanvas();
    if (dataUrl) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height);
      img.src = dataUrl;
    }
  });
  resizeCanvas();

  function getPos(evt) {
    const rect = canvas.getBoundingClientRect();
    if (evt.touches && evt.touches[0]) {
      return { x: evt.touches[0].clientX - rect.left, y: evt.touches[0].clientY - rect.top };
    }
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function startDraw(evt) {
    evt.preventDefault();
    drawing = true;
    const p = getPos(evt);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function moveDraw(evt) {
    if (!drawing) return;
    evt.preventDefault();
    const p = getPos(evt);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    hasSignature = true;
    signatureStatus.textContent = '서명이 입력되었습니다.';
  }
  function endDraw() {
    drawing = false;
  }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', moveDraw);
  window.addEventListener('mouseup', endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', moveDraw, { passive: false });
  canvas.addEventListener('touchend', endDraw);

  document.getElementById('clear-signature').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasSignature = false;
    signatureStatus.textContent = '아직 서명하지 않았습니다.';
  });

  // ---------- 폼 제출 ----------
  const form = document.getElementById('application-form');
  const errorBox = document.getElementById('error-box');
  const errorItems = document.getElementById('error-items');
  const submitBtn = document.getElementById('submit-btn');
  const MAX_AMOUNT = 200000;

  function showErrors(messages) {
    errorItems.innerHTML = '';
    messages.forEach((msg) => {
      const li = document.createElement('li');
      li.textContent = msg;
      errorItems.appendChild(li);
    });
    errorBox.classList.remove('hidden');
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function clearErrors() {
    errorBox.classList.add('hidden');
    errorItems.innerHTML = '';
  }

  function collectFormData() {
    const naturelinkRadio = form.querySelector('input[name="naturelinkMember"]:checked');
    return {
      name: document.getElementById('name').value.trim(),
      birthdate: document.getElementById('birthdate').value,
      phone: document.getElementById('phone').value.trim(),
      emergencyPhone: document.getElementById('emergencyPhone').value.trim() || undefined,
      address: document.getElementById('address').value.trim(),
      naturelinkMember: naturelinkRadio ? naturelinkRadio.value === 'yes' : undefined,
      monthlyCurrencyAmount: document.getElementById('monthlyCurrencyAmount').value || undefined,
      desiredPaymentAmount: document.getElementById('desiredPaymentAmount').value,
      desiredStartYear: yearSelect.value,
      desiredStartMonth: monthSelect.value,
      proxyWriter: document.getElementById('proxyWriter').value.trim() || undefined,
      signature: hasSignature ? canvas.toDataURL('image/png') : '',
      privacyAgreed: document.getElementById('privacyAgreed').checked,
      termsAgreed: document.getElementById('termsAgreed').checked,
    };
  }

  function validateClientSide(data) {
    const errors = [];
    if (!data.name) errors.push('성명을 입력해 주세요.');
    if (!data.birthdate) errors.push('생년월일을 입력해 주세요.');
    if (!data.phone || !/^[0-9-]{9,14}$/.test(data.phone)) errors.push('연락처(본인)를 올바르게 입력해 주세요.');
    if (!data.address) errors.push('주소(배송지)를 입력해 주세요.');
    if (data.naturelinkMember === undefined) errors.push('자연사랑 모임 소속 여부를 선택해 주세요.');
    const amount = Number(data.desiredPaymentAmount);
    if (!amount || amount <= 0) errors.push('참여 희망 결제 금액을 입력해 주세요.');
    else if (amount > MAX_AMOUNT) errors.push(`참여 희망 결제 금액은 월 ${MAX_AMOUNT.toLocaleString()}원 이내여야 합니다.`);
    if (!data.signature) errors.push('신청인 서명을 입력해 주세요.');
    if (!data.privacyAgreed) errors.push('개인정보 수집·이용에 동의해야 신청할 수 있습니다.');
    if (!data.termsAgreed) errors.push('이용약관에 동의해야 신청할 수 있습니다.');
    return errors;
  }

  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    clearErrors();

    const data = collectFormData();
    const errors = validateClientSide(data);
    if (errors.length > 0) {
      showErrors(errors);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '제출 중...';

    try {
      const res = await fetch(`${API_BASE}/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await res.json();

      if (!res.ok) {
        showErrors(result.details || [result.error || '신청 처리 중 오류가 발생했습니다.']);
        return;
      }

      document.getElementById('success-detail').textContent =
        `접수번호 ${result.id}번으로 접수되었습니다. 담당자 확인 후 순차 안내드립니다.`;
      document.getElementById('success-modal').classList.remove('hidden');
      form.reset();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasSignature = false;
      signatureStatus.textContent = '아직 서명하지 않았습니다.';
      monthSelect.value = String(now.getMonth() + 1);
    } catch (err) {
      showErrors(['서버에 연결할 수 없습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.']);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '신청서 제출하기';
    }
  });

  document.getElementById('modal-confirm').addEventListener('click', () => {
    document.getElementById('success-modal').classList.add('hidden');
  });
})();
