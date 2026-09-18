'use strict';

/**
 * 상품 사진 업로드.
 * 브라우저에서 FileReader 로 읽은 data URL 을 JSON 으로 받아 파일로 저장한다.
 * (외부 의존성 없이 다중 업로드를 지원하기 위한 방식)
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { HttpError } = require('./http');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
const MAX_BYTES = 4 * 1024 * 1024; // 4MB
const EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function saveDataUrl(dataUrl) {
  const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!match) throw new HttpError(400, '이미지 형식을 읽을 수 없습니다.');
  const [, mime, b64] = match;
  const ext = EXT[mime.toLowerCase()];
  if (!ext) throw new HttpError(400, 'JPG, PNG, WEBP, GIF 이미지만 올릴 수 있습니다.');

  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new HttpError(400, '빈 이미지입니다.');
  if (buf.length > MAX_BYTES) throw new HttpError(413, '이미지 한 장의 크기는 4MB 이하여야 합니다.');

  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return `/uploads/${name}`;
}

function removeUpload(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const file = path.join(UPLOAD_DIR, path.basename(url));
  if (file.startsWith(UPLOAD_DIR)) fs.rm(file, { force: true }, () => {});
}

module.exports = { saveDataUrl, removeUpload, UPLOAD_DIR, MAX_BYTES };
