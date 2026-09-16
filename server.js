'use strict';

/**
 * 보성군 농산물 직거래 자사몰 플랫폼 (BMCTVda) — 서버 진입점
 * 외부 의존성 없이 Node.js 표준 모듈(node:http, node:sqlite)만 사용한다.
 *   실행: npm start
 */

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const { sendJson, sendText, HttpError } = require('./src/lib/http');
const shopRoutes = require('./src/routes/shop');
const supplierRoutes = require('./src/routes/supplier');
const adminRoutes = require('./src/routes/admin');
const { seed } = require('./src/seed');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

seed();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel.endsWith('/')) rel += 'index.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) throw new HttpError(403, '접근할 수 없습니다.');

  let stat;
  try { stat = await fsp.stat(filePath); } catch { return false; }
  if (!stat.isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=600',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const ALIASES = { '/admin': '/admin.html', '/supplier': '/supplier.html', '/order': '/order.html' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    const match =
      shopRoutes.router.match(req.method, pathname) ||
      supplierRoutes.router.match(req.method, pathname) ||
      adminRoutes.router.match(req.method, pathname);

    if (match) {
      await match.handler(req, res, { params: match.params, query: url.searchParams, url });
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const alias = ALIASES[pathname.replace(/\/$/, '')];
      if (alias && await serveStatic(req, res, alias)) return;
      if (await serveStatic(req, res, pathname)) return;
    }

    if (pathname.startsWith('/api/')) throw new HttpError(404, '요청하신 API 경로를 찾을 수 없습니다.');
    if (await serveStatic(req, res, '/index.html')) return;
    throw new HttpError(404, '페이지를 찾을 수 없습니다.');
  } catch (err) {
    if (res.headersSent) return;
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error('[error]', req.method, pathname, err);
    if (pathname.startsWith('/api/')) sendJson(res, status, { error: err.message || '서버 오류가 발생했습니다.' });
    else sendText(res, status, err.message || '서버 오류가 발생했습니다.');
  }
});

server.listen(PORT, HOST, () => {
  console.log('────────────────────────────────────────────────');
  console.log(' BMCTVda 보성 농산물 직거래 자사몰 플랫폼');
  console.log(` 소비자 쇼핑몰 : http://localhost:${PORT}/`);
  console.log(` 공급처 화면   : http://localhost:${PORT}/supplier`);
  console.log(` 관리자 화면   : http://localhost:${PORT}/admin`);
  console.log(` 관리자 비밀번호: ${process.env.ADMIN_PASSWORD ? '(환경변수 ADMIN_PASSWORD 적용됨)' : 'bmctvda2026 (기본값 — 운영 전 반드시 변경)'}`);
  console.log('────────────────────────────────────────────────');
});

module.exports = server;
