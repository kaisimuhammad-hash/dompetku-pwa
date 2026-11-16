import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import { config } from './config.js';
import { initDb } from './db/index.js';
import { ensureSeed } from './db/seed.js';
import { createApiRouter } from './routes/api.js';
import { TELEGRAM_WEBHOOK_PATH, getActiveBot, startBot, telegramWebhookHandler } from './bot/index.js';
import { startBackupScheduler } from './services/backup.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

async function main() {
  await initDb();
  await ensureSeed();

  if (config.isProd && config.appPasscode === 'dompetku') {
    console.warn('[security] APP_PASSCODE masih default. Ganti sebelum dipakai online!');
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cookieParser());

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "img-src 'self' data:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "script-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    if (config.cookieSecure) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
  });

  const apiRouter = createApiRouter({ getBot: getActiveBot });

  await startBot();
  startBackupScheduler(getActiveBot);

  app.post(TELEGRAM_WEBHOOK_PATH, express.json({ limit: '1mb' }), telegramWebhookHandler);

  app.use(
    '/api',
    (req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
    apiRouter,
  );

  app.use(
    express.static(publicDir, {
      maxAge: '1h',
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        if (name === 'index.html' || name === 'sw.js' || name === 'manifest.webmanifest') {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Tidak ditemukan' });
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    if (status >= 500) console.error('[api]', err);
    res.status(status).json({ error: err.message || 'Terjadi kesalahan pada server' });
  });

  const server = app.listen(config.port, config.host, () => {
    console.log(`[server] Dompetku berjalan di http://localhost:${config.port}`);
    if (config.publicUrl) console.log(`[server] URL publik: ${config.publicUrl}`);
  });

  const shutdown = (signal) => {
    console.log(`[server] ${signal} diterima, menutup...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] gagal start:', err);
  process.exit(1);
});
