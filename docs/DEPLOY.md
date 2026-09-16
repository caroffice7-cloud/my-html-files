# 서버에 올리는 방법

개발자가 아닌 분이 따라 할 수 있도록 쓴 실제 배포 절차입니다.
필요한 것은 **Node.js 22.13 이상을 설치할 수 있는 리눅스 서버 한 대**뿐입니다.

권장: 카페24 Node.js 호스팅, AWS Lightsail, Naver Cloud, Vultr 등.
상품 사진을 저장하므로 디스크는 **20GB 이상**을 권장합니다.

---

## 1. 준비물

| 항목 | 설명 |
| --- | --- |
| 서버 | Ubuntu 22.04 이상 권장, 디스크 20GB 이상 |
| 도메인 | 예) shop.bmctvda.kr — 결제·개인정보를 다루므로 HTTPS 필수 |
| 관리자 비밀번호 | 운영에 쓸 비밀번호를 미리 정해 두십시오 |
| 입금 계좌 | 무통장입금 안내에 표시할 계좌 (운영자 화면 > 설정에서 입력) |

---

## 2. 설치

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git sqlite3
node --version        # v22.13 이상 확인

sudo mkdir -p /opt/mall && sudo chown $USER /opt/mall
git clone https://github.com/caroffice7-cloud/my-html-files.git /opt/mall
cd /opt/mall
```

---

## 3. 서비스로 등록

```bash
sudo tee /etc/systemd/system/mall.service > /dev/null <<'EOF'
[Unit]
Description=BMCTVda 보성 농산물 직거래 자사몰
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/mall
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=SECURE_COOKIE=1
Environment=ADMIN_PASSWORD=여기에_실제_비밀번호

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now mall
sudo systemctl status mall
```

로그 확인: `sudo journalctl -u mall -f`

---

## 4. HTTPS 연결

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/sites-available/mall > /dev/null <<'EOF'
server {
    server_name shop.example.kr;          # 실제 도메인으로 바꾸십시오
    client_max_body_size 8m;              # 상품 사진 업로드 여유분
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/mall /etc/nginx/sites-enabled/mall
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d shop.example.kr
```

HTTPS를 붙인 뒤 **운영자 화면 > 설정 > 사이트 주소**에 `https://shop.example.kr` 을 입력하십시오.
채널 업로드용 CSV의 상품 링크와 이미지 주소가 이 값을 기준으로 만들어집니다.

---

## 5. 백업 (중요)

지켜야 할 것은 **두 가지**입니다.

| 대상 | 경로 |
| --- | --- |
| 데이터베이스 | `data/mall.db` |
| 상품 사진 | `public/uploads/` |

```bash
sudo tee /opt/mall/backup.sh > /dev/null <<'EOF'
#!/bin/bash
set -e
STAMP=$(date +%Y%m%d-%H%M)
DEST=/opt/mall/backups
mkdir -p "$DEST"
sqlite3 /opt/mall/data/mall.db ".backup '$DEST/mall-$STAMP.db'"
gzip -f "$DEST/mall-$STAMP.db"
tar czf "$DEST/uploads-$STAMP.tar.gz" -C /opt/mall/public uploads
find "$DEST" -name '*-*.gz' -mtime +30 -delete
EOF
sudo chmod +x /opt/mall/backup.sh

( crontab -l 2>/dev/null; echo "0 3 * * * /opt/mall/backup.sh" ) | crontab -
```

**백업 파일은 반드시 서버 밖(구글 드라이브, 외장 하드 등)에도 옮겨 두십시오.**

---

## 6. 업데이트

```bash
cd /opt/mall
git pull
sudo systemctl restart mall
```

데이터베이스와 업로드된 사진은 그대로 유지됩니다.

---

## 7. 운영 전 점검표

- [ ] `ADMIN_PASSWORD` 를 기본값(`bmctvda2026`)에서 바꿨는가
- [ ] 공급처 3곳의 초기 비밀번호를 바꿔 각 공급처에 안전하게 전달했는가
- [ ] HTTPS로 접속되는가, `SECURE_COOKIE=1` 을 켰는가
- [ ] 운영자 화면 > 설정에 **입금 계좌**와 **사이트 주소**를 입력했는가
- [ ] 각 공급처의 **판매수수료율**을 운영자 화면 > 수수료 관리에서 입력했는가 (미확정이면 수수료가 0원으로 계산됩니다)
- [ ] 공급처가 상품에 공급가·권장판매가를 입력하고 승인을 받았는가
- [ ] 자동 백업이 도는지 확인했는가 (`ls /opt/mall/backups`)
- [ ] 통신판매업 신고, 개인정보 처리방침, 청약철회 안내 문구를 실제 운영 내용에 맞게 검토했는가

---

## 8. 서버리스(Vercel 등)에 올리려면

현재 구조는 서버가 계속 켜져 있고 **파일로 데이터베이스와 사진을 저장**하는 방식입니다.
서버리스에서는 파일이 유지되지 않으므로 두 가지를 바꿔야 합니다.

1. `src/db.js` → 외부 데이터베이스(Postgres 등)용으로 교체
   (다른 코드는 모두 `get / all / run / tx` 네 함수만 씁니다)
2. `src/lib/upload.js` → 오브젝트 스토리지(S3, Cloudflare R2 등)에 올리도록 교체
   (`saveDataUrl` 이 URL 문자열만 돌려주면 나머지 코드는 그대로 동작합니다)
