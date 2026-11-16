import { config } from '../config.js';
import { backupJson } from './export.js';
import { getOwnerChatId, getSetting, setSetting } from './settings.js';

const LAST_SENT_KEY = 'backup_last_sent_at';
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

export function isBackupDue(lastSentAt, now = Date.now(), intervalDays = config.backupIntervalDays) {
  if (!lastSentAt) return true;
  const last = Date.parse(lastSentAt);
  if (Number.isNaN(last)) return true;
  return now - last >= intervalDays * DAY_MS;
}

export function backupFilename(date = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(date);
  return `dompetku-backup-${day}.json`;
}

export async function sendBackup(bot) {
  const ownerChatId = await getOwnerChatId();
  if (!ownerChatId) return { sent: false, reason: 'belum-tertaut' };

  const data = await backupJson();
  const payload = Buffer.from(JSON.stringify(data, null, 2));
  await bot.telegram.sendDocument(
    ownerChatId,
    { source: payload, filename: backupFilename() },
    {
      caption: [
        '<b>Backup Dompetku</b>',
        `${data.transactions.length} transaksi · ${data.accounts.length} dompet · ${data.categories.length} kategori · ${data.budgets.length} anggaran`,
        'Simpan file ini di tempat aman.',
      ].join('\n'),
      parse_mode: 'HTML',
    },
  );

  const at = new Date().toISOString();
  await setSetting(LAST_SENT_KEY, at);
  return { sent: true, at, bytes: payload.length };
}

export async function runBackupIfDue(bot, now = Date.now()) {
  const lastSentAt = await getSetting(LAST_SENT_KEY);
  if (!isBackupDue(lastSentAt, now)) return { sent: false, reason: 'belum-jatuh-tempo' };
  return sendBackup(bot);
}

export function startBackupScheduler(getBot, { intervalMs = CHECK_INTERVAL_MS } = {}) {
  let running = false;

  const tick = async () => {
    if (running) return;
    const bot = typeof getBot === 'function' ? getBot() : getBot;
    if (!bot) return;
    running = true;
    try {
      const result = await runBackupIfDue(bot);
      if (result.sent) console.log(`[backup] terkirim (${result.bytes} byte)`);
    } catch (err) {
      console.error('[backup] gagal:', err.message);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return timer;
}
