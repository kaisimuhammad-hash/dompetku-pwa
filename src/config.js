import process from 'node:process';

const koyebDomain = (process.env.KOYEB_PUBLIC_DOMAIN || '').trim();
const railwayDomain = (process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL || '').trim();
const publicUrl = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  (railwayDomain ? (railwayDomain.startsWith('http') ? railwayDomain : `https://${railwayDomain}`) : '') ||
  (koyebDomain ? `https://${koyebDomain}` : '')
)
  .trim()
  .replace(/\/+$/, '');
const isProd = process.env.NODE_ENV === 'production';
const backupIntervalDays = Number(process.env.BACKUP_INTERVAL_DAYS || 7);

export const config = {
  port: Number(process.env.PORT || 3000),
  host: (process.env.HOST || process.env.IP || '0.0.0.0').trim(),
  appPasscode: process.env.APP_PASSCODE || '12345678',
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
