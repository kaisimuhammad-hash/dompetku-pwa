import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function startFakeTelegram(calls) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const method = url.pathname.split('/').pop();
      const payload = body ? JSON.parse(body) : {};
      calls.push({ method, payload });

      let result = true;
      if (method === 'getMe') {
        result = {
          id: 123456789,
          is_bot: true,
          first_name: 'Dompetku Test',
          username: 'dompetku_test_bot',
          can_join_groups: true,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
        };
      } else if (method === 'sendMessage' || method === 'editMessageText') {
        result = {
          message_id: payload.message_id || calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: payload.chat_id, type: 'private' },
          text: payload.text || '',
        };
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('pesan Telegram menyimpan pengeluaran dan pemasukan', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dompetku-telegram-'));
  process.env.PGLITE_DIR = dir;

  const calls = [];
  const server = await startFakeTelegram(calls);

  try {
    const { initDb } = await import('../src/db/index.js');
    const { ensureSeed } = await import('../src/db/seed.js');
    const { setSetting } = await import('../src/services/settings.js');
    const { listTransactions } = await import('../src/services/transactions.js');
    const { buildBot } = await import('../src/bot/index.js');

    await initDb();
    await ensureSeed();
    await setSetting('owner_chat_id', '555');

    const bot = buildBot('123456789:AAHdummyTokenForTesting1234567890');
    bot.telegram.options.apiRoot = `http://127.0.0.1:${server.address().port}/`;
    bot.telegram.options.agent = undefined;

    const chat = { id: 555, type: 'private' };
    const from = { id: 555, is_bot: false, first_name: 'Tester' };
    let updateId = 0;

    const sendText = (text) =>
      bot.handleUpdate({
        update_id: ++updateId,
        message: {
          message_id: updateId + 10,
          date: Math.floor(Date.now() / 1000),
          chat,
          from,
          text,
        },
      });

    const pressSave = () =>
      bot.handleUpdate({
        update_id: ++updateId,
        callback_query: {
          id: `cb-${updateId}`,
          from,
          chat_instance: '123',
          data: 'save',
          message: {
            message_id: 12,
            date: Math.floor(Date.now() / 1000),
            chat,
            text: 'Draft transaksi',
          },
        },
      });

    await sendText('makan siang 25rb');
    const draftCall = calls.find(
      (call) => call.method === 'sendMessage' && /Draft transaksi/.test(call.payload.text || ''),
    );
    assert.ok(draftCall, 'bot harus membalas dengan draft');
    assert.match(draftCall.payload.text, /Pengeluaran/);
    assert.match(draftCall.payload.text, /Rp 25\.000/);
    assert.ok(
      draftCall.payload.reply_markup.inline_keyboard
        .flat()
        .some((button) => button.callback_data === 'save'),
    );

    await pressSave();
    assert.ok(
      calls.some(
        (call) => call.method === 'editMessageText' && /Tersimpan/.test(call.payload.text || ''),
      ),
      'bot harus mengonfirmasi transaksi tersimpan',
    );

    await sendText('gaji 5jt');
    const incomeDraft = calls.findLast(
      (call) => call.method === 'sendMessage' && /Draft transaksi/.test(call.payload.text || ''),
    );
    assert.match(incomeDraft.payload.text, /Pemasukan/);
    assert.match(incomeDraft.payload.text, /Rp 5\.000\.000/);

    await pressSave();

    const items = await listTransactions({});
    assert.equal(items.length, 2);
    const expense = items.find((item) => item.kind === 'expense');
    const income = items.find((item) => item.kind === 'income');
    assert.equal(expense.amount, 25000);
    assert.equal(income.amount, 5000000);
    assert.equal(expense.source, 'telegram');
    assert.equal(income.source, 'telegram');
  } finally {
    server.close();
  }
});
