# 자연사랑 생활장터 — 보성군 지역화폐 쇼핑배달서비스 신청 접수 앱

보성군 기본소득 지역화폐(월 20만원)를 자연사랑 생활장터(농업회사법인 히스메이커스 주식회사) 쇼핑배달서비스로
연결하는 **신청 접수 전용** 앱입니다. 기존 `jayeonsarang-order.html`(주문접수·처리현황·가격표·정산 운영 도구)과는
별개의 시스템으로, **회원 모집 단계의 "신청서 + 이용약관 동의" 접수**와 개인정보 보호에 특화되어 있습니다.

- 신청 접수 화면: 모바일 앱처럼 설치 가능한 PWA + PC 브라우저 겸용(하이브리드, 반응형 1개 코드베이스)
- 백엔드: 신청자 개인정보를 필드 단위로 암호화하여 저장, 관리자 인증, 접수/처리 상태 관리, 개인정보 파기 기능

## 폴더 구조

```
boseong-currency-delivery-app/
├── backend/                  # Node.js/Express 백엔드 API
│   ├── src/
│   │   ├── server.js         # 서버 진입점
│   │   ├── db.js             # SQLite 스키마
│   │   ├── crypto.js         # AES-256-GCM 필드 암호화/마스킹
│   │   ├── middleware/       # JWT 인증, 요청 제한(rate limit)
│   │   ├── routes/           # /api/applications, /api/admin
│   │   ├── validators/       # 신청서 입력값 검증
│   │   └── scripts/createAdmin.js  # 관리자 계정 생성 스크립트
│   ├── .env.example
│   └── package.json
└── frontend/                 # 정적 프론트엔드 (하이브리드: 모바일 PWA + PC 웹)
    ├── index.html            # 신청서 + 이용약관 + 전자서명 (일반 신청자용)
    ├── admin.html            # 접수 담당자 관리자 페이지
    ├── manifest.json         # PWA 설치(홈 화면 추가) 설정
    ├── service-worker.js     # 오프라인 앱 셸 캐시
    ├── css/style.css
    └── js/ (config.js, app.js, admin.js)
```

## 1. 로컬 실행

### 1) 백엔드

```bash
cd backend
npm install
cp .env.example .env
```

`.env`에서 반드시 아래 두 값을 실제 값으로 교체합니다.

```bash
# 무작위 32바이트 hex 키 생성 예시
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- `ENCRYPTION_KEY` : 개인정보(성명/생년월일/연락처/주소/서명 등) 암호화 키
- `JWT_SECRET` : 관리자 로그인 토큰 서명 키

관리자 계정 생성(최초 1회, 이후 재실행 시 비밀번호 갱신):

```bash
npm run create-admin -- <아이디> <비밀번호>
```

서버 실행:

```bash
npm start
# 자연사랑 생활장터 접수 서버가 4000번 포트에서 실행 중입니다.
```

### 2) 프론트엔드

정적 파일이므로 아무 정적 서버로 열면 됩니다.

```bash
cd frontend
python3 -m http.server 5500
# http://localhost:5500/index.html      → 신청서 (일반 사용자)
# http://localhost:5500/admin.html      → 관리자 페이지 (접수 담당자)
```

프론트엔드가 백엔드와 다른 포트/도메인에서 실행되면 `backend/.env`의 `FRONTEND_ORIGIN`에 해당 origin을
추가해야 CORS가 허용됩니다. 백엔드 주소를 바꾸려면 `frontend/js/config.js`의 `API_BASE` 값을 수정하세요
(배포판에서는 브라우저 콘솔에서 `localStorage.setItem('API_BASE_OVERRIDE', 'https://실서버주소/api')`로도
임시 전환이 가능합니다).

## 2. "하이브리드(모바일 앱 + PC 버전 병행)" 구현 방식

네이티브 앱스토어 심사 없이 **모바일에서는 설치형 앱처럼, PC에서는 일반 웹사이트처럼** 동일한 코드로 동작하도록
PWA(Progressive Web App) 방식을 사용했습니다.

- `manifest.json` + `service-worker.js`로 모바일 브라우저(Chrome/Safari)에서 "홈 화면에 추가" 시
  독립 실행형 앱 아이콘으로 설치되고, 오프라인에서도 신청서 화면 자체는 열립니다(제출은 온라인 필요).
- CSS는 모바일 우선(반응형)으로 작성하고 900px 이상 화면(PC)에서는 여백/레이아웃만 넓게 재배치하므로,
  별도의 PC 전용 페이지 없이 반응형 1세트로 모바일/PC를 함께 지원합니다.
- 필요 시 Capacitor 등으로 동일 `frontend/` 코드를 감싸 네이티브 iOS/Android 빌드로 확장할 수 있는 구조입니다
  (현재는 웹/PWA 배포가 가장 빠르고 비용이 낮은 접근이라 우선 적용).

## 3. 개인정보 보호 설계 (백엔드)

이용약관 제7조(개인정보의 수집 및 이용)를 시스템으로 구현했습니다.

| 요구 사항 | 구현 |
|---|---|
| 최소 항목만 수집 | 성명·생년월일·연락처·주소·서명 등 신청서 명시 항목만 수집 |
| 수집 목적 외 사용 금지 | 신청 접수/주문배송/정산 목적의 API만 제공, 별도 마케팅 연동 없음 |
| 저장 시 보호 | 성명/생년월일/연락처/주소/서명/대리작성자 정보를 **AES-256-GCM으로 필드 단위 암호화**하여 DB에 저장 |
| 동의 확보·증빙 | 신청 시 `privacyAgreed`, `termsAgreed` 체크(둘 다 필수) + 동의 시각·IP·User-Agent를 감사 기록으로 별도 저장 |
| 접근 통제 | 관리자 전용 API는 JWT 인증 필요, 목록 조회 시 이름/연락처는 마스킹 처리, 상세 열람·상태변경·파기는 접근 로그(access_log)에 기록 |
| 파기 | 관리자 페이지에서 건별 "개인정보 파기(삭제)" 실행 시 DB에서 완전 삭제 (`DATA_RETENTION_DAYS`는 보관기간 안내용 값) |
| 남용 방지 | 신청 제출/관리자 로그인 모두 IP 기준 요청 제한(rate limit) 적용 |

> 시범사업(프로토타입) 단계에서는 SQLite 파일 DB를 사용합니다. 실제 다수 회원·다중 접수자 운영 단계로 갈 경우
> PostgreSQL 등 관리형 DB로 교체하고, 서버 자체도 HTTPS(SSL)로만 서비스해야 합니다 (배포 시 반드시 리버스
> 프록시/호스팅 단에서 HTTPS를 강제하세요 — 이 저장소 자체는 HTTP/HTTPS를 가리지 않는 앱 코드만 포함합니다).

## 4. 배포 시 체크리스트

1. 백엔드를 Node 실행 가능한 서버(예: 클라우드 VM, Render, Railway 등)에 올리고 `.env`를 운영값으로 설정
2. `ENCRYPTION_KEY`, `JWT_SECRET`은 절대 저장소에 커밋하지 말고 배포 환경변수로만 주입
3. HTTPS 적용 (모든 개인정보가 오가므로 필수)
4. `frontend/js/config.js`의 `API_BASE`를 운영 백엔드 주소로 수정 후 정적 호스팅(예: GitHub Pages, Netlify, 또는
   백엔드와 같은 서버의 static 디렉터리)에 배포
5. `npm run create-admin`으로 접수 담당자 계정 발급 (기본 계정/비밀번호를 그대로 쓰지 말 것)
6. 데이터 볼륨(`backend/data/`)이 재배포 시에도 유지되도록 영속 스토리지 마운트

## 5. 다음 확장(2·3차 예정)

- 지역화폐 카드 결제기 연동, 쿠팡 오픈 API 자동 매입 연동
- 정기배송/구독 신청, 회원 구매 이력 기반 AI 통합돌봄 데이터 파운드리 연계
- Capacitor 기반 네이티브 앱 패키징(필요 시)
