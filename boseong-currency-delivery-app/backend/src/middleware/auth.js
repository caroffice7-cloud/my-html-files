const jwt = require('jsonwebtoken');

function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = { username: payload.username };
    next();
  } catch (err) {
    return res.status(401).json({ error: '유효하지 않거나 만료된 인증입니다.' });
  }
}

module.exports = { requireAdminAuth };
