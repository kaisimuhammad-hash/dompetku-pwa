import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('sendBackup mengirim dokumen JSON dan mencatat waktu kirim', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dompetku-pglite-'));
  process.env.PGLITE_DIR = dir;

  const { initDb } = await import('../src/db/index.js');
  const { getSetting, setSetting } = await import('../src/services/settings.js');
  const { runBackupIfDue, sendBackup } = await import('../src/services/backup.js');

  await initDb();
  await setSetting('owner_chat_id', '12345');

  const sent = [];
  const bot = {
    telegram: {
      sendDocument: async (chatId, document, options) => {
        sent.push({ chatId, document, options });
      },
    },
  };

  const result = await sendBackup(bot);
  assert.equal(result.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, '12345');
  assert.match(sent[0].document.filename, /^dompetku-backup-\d{4}-\d{2}-\d{2}\.json$/);

  const payload = JSON.parse(sent[0].document.source.toString('utf8'));
  assert.equal(payload.app, 'Dompetku');
  assert.ok(Array.isArray(payload.accounts));
  assert.ok(Array.isArray(payload.transactions));
  assert.ok(await getSetting('backup_last_sent_at'));

  assert.deepEqual(await runBackupIfDue(bot), { sent: false, reason: 'belum-jatuh-tempo' });
});
