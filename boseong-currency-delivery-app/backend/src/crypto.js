const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function loadKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY 환경변수가 설정되지 않았거나 길이가 올바르지 않습니다 (64자리 hex 필요).'
    );
  }
  return Buffer.from(hex, 'hex');
}

// 필드 단위 암호화: iv:authTag:ciphertext 를 base64 조각으로 이어붙여 저장한다.
function encryptField(plainText) {
  if (plainText === null || plainText === undefined) return null;
  const key = loadKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}

function decryptField(payload) {
  if (payload === null || payload === undefined) return null;
  const key = loadKey();
  const [ivB64, tagB64, dataB64] = String(payload).split(':');
  if (!ivB64 || !tagB64 || !dataB64) return null;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

// 관리자 목록 화면 등에서 원문 노출 없이 신원 확인이 가능하도록 하는 마스킹 유틸
function maskPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.length < 7) return '****';
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

function maskName(name) {
  if (!name) return '';
  if (name.length <= 1) return name;
  if (name.length === 2) return `${name[0]}*`;
  return `${name[0]}${'*'.repeat(name.length - 2)}${name[name.length - 1]}`;
}

module.exports = { encryptField, decryptField, maskPhone, maskName };
