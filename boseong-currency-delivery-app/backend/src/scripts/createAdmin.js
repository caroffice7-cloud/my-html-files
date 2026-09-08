require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

// 사용법: node src/scripts/createAdmin.js <아이디> <비밀번호>
const [, , username, password] = process.argv;

if (!username || !password) {
  console.error('사용법: node src/scripts/createAdmin.js <아이디> <비밀번호>');
  process.exit(1);
}

if (password.length < 8) {
  console.error('비밀번호는 8자 이상이어야 합니다.');
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(password, 12);
const now = new Date().toISOString();

try {
  db.prepare(
    'INSERT INTO admin_users (username, password_hash, created_at) VALUES (?, ?, ?)'
  ).run(username, passwordHash, now);
  console.log(`관리자 계정 '${username}'이(가) 생성되었습니다.`);
} catch (err) {
  if (String(err.message).includes('UNIQUE')) {
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?').run(passwordHash, username);
    console.log(`관리자 계정 '${username}'의 비밀번호가 갱신되었습니다.`);
  } else {
    console.error(err);
    process.exit(1);
  }
}
