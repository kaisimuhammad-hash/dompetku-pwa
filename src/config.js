import process from 'node:process';

const publicUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '')
  .trim()
  .replace(/\/+$/, '');
const isProd = process.env.NODE_ENV === 'production';
const backupIntervalDays = Number(process.env.BACKUP_INTERVAL_DAYS || 7);

export const config = {
  port: Number(process.env.PORT || 3000),
  appPasscode: process.env.APP_PASSCODE || 'dompetku',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-jangan-dipakai-di-produksi',
  databaseUrl: (process.env.DATABASE_URL || '').trim(),
  botToken: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
  publicUrl,
  webhookSecret: process.env.WEBHOOK_SECRET || 'dompetku-webhook',
  backupIntervalDays:
    Number.isFinite(backupIntervalDays) && backupIntervalDays > 0 ? backupIntervalDays : 7,
  timezone: process.env.TZ || 'Asia/Jakarta',
  cookieSecure:
    process.env.COOKIE_SECURE === 'true' ||
    publicUrl.startsWith('https://') ||
    (isProd && process.env.COOKIE_SECURE !== 'false'),
  isProd,
};

export const LIMITS = {
  amount: 1_000_000_000_000, // Rp 1 triliun
  note: 280,
  name: 40,
};
