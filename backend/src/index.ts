import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { downloadRouter } from './routes/download.js';
import { extractRouter } from './routes/extract.js';

const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';

const app = express();

app.use(
  cors({
    origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map((o) => o.trim()),
  }),
);
app.use(express.json({ limit: '16kb' }));

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a moment.' },
  }),
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'zeroads-backend' });
});

app.use('/api/extract', extractRouter);
app.use('/api/download', downloadRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ZeroAds backend listening on http://0.0.0.0:${PORT}`);
});
