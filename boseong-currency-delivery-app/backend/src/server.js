require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const applicationsRouter = require('./routes/applications');
const adminRouter = require('./routes/admin');

const app = express();

app.use(helmet());
app.use(express.json({ limit: '2mb' }));

const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS로 차단된 요청입니다.'));
    },
  })
);

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/applications', applicationsRouter);
app.use('/api/admin', adminRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || '서버 오류가 발생했습니다.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`자연사랑 생활장터 접수 서버가 ${PORT}번 포트에서 실행 중입니다.`);
});

module.exports = app;
