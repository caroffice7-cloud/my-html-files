// 백엔드 API 주소 설정
// 로컬 개발: backend를 4000번 포트로 띄운 상태에서 그대로 사용
// 배포 시: 아래 한 줄만 실제 백엔드 도메인으로 교체하면 된다 (예: 'https://api.jayeonsarang-market.kr/api')
window.APP_CONFIG = {
  API_BASE: window.localStorage.getItem('API_BASE_OVERRIDE') || 'http://localhost:4000/api',
};
