import express from 'express';
import { Markup, Telegraf } from 'telegraf';
import { config } from '../config.js';
import { ParseError, parseMessage } from '../lib/parse.js';
import {
  currentMonth,
  formatDateLong,
  formatIDR,
  isValidMonth,
  monthLabel,
  todayISO,
} from '../lib/format.js';
import { getAccount, listAccounts } from '../services/accounts.js';
import { fallbackCategory, listCategories } from '../services/categories.js';
import { budgetAlert, listBudgets } from '../services/budgets.js';
import { categoryBreakdown, monthSummary } from '../services/reports.js';
import { createTransaction, deleteTransaction } from '../services/transactions.js';
import { getDefaultAccountId, getOwnerChatId, setSetting } from '../services/settings.js';
import { sendBackup, startBackupScheduler } from '../services/backup.js';

const pendingDrafts = new Map();
const DRAFT_TTL = 30 * 60 * 1000;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function kindLabel(kind) {
  return { expense: 'Pengeluaran', income: 'Pemasukan', transfer: 'Transfer' }[kind] || kind;
}

function progressBar(percent, size = 10) {
  const filled = Math.max(0, Math.min(size, Math.round((percent / 100) * size)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(size - filled)}`;
}

function cleanupDrafts() {
  const now = Date.now();
  for (const [key, value] of pendingDrafts) {
    if (now - value.updatedAt > DRAFT_TTL) pendingDrafts.delete(key);
  }
}

async function renderDraft(draft) {
  const accounts = await listAccounts({ includeArchived: true });
  const categories = await listCategories({ includeArchived: true });
  const account = accounts.find((a) => a.id === draft.accountId);
  const toAccount = accounts.find((a) => a.id === draft.toAccountId);
  const category = categories.find((c) => c.id === draft.categoryId);

  const lines = ['<b>Draft transaksi</b>', ''];
  lines.push(`<b>${kindLabel(draft.kind)}</b> · ${formatIDR(draft.amount)}`);
  if (draft.kind === 'transfer') {
    lines.push(`Dompet: ${esc(account?.name || '-')} → ${esc(toAccount?.name || '-')}`);
  } else {
    lines.push(`Dompet: ${esc(account?.name || '-')}`);
    lines.push(`Kategori: ${category ? esc(category.name) : 'Tanpa kategori'}`);
  }
  if (draft.note) lines.push(`Catatan: ${esc(draft.note)}`);
  lines.push(`Tanggal: ${formatDateLong(draft.occurredOn)}`);
  lines.push('');
  lines.push('<i>Periksa dulu, lalu tekan Simpan.</i>');
  return lines.join('\n');
}

function draftKeyboard(draft) {
  const rows = [
    [Markup.button.callback('Simpan', 'save'), Markup.button.callback('Batal', 'cancel')],
  ];
  if (draft.kind === 'transfer') {
    rows.push([
      Markup.button.callback('Ubah dompet asal', 'pick-from'),
      Markup.button.callback('Ubah dompet tujuan', 'pick-to'),
    ]);
  } else {
    rows.push([
      Markup.button.callback('Ganti kategori', 'pick-category'),
      Markup.button.callback('Ganti dompet', 'pick-account'),
    ]);
  }
  return Markup.inlineKeyboard(rows);
}

async function renderCategoryMenu(draft) {
  const categories = (await listCategories()).filter((c) => c.kind === draft.kind);
  const rows = [];
  for (let i = 0; i < categories.length; i += 2) {
    rows.push(categories.slice(i, i + 2).map((c) => Markup.button.callback(c.name, `cat:${c.id}`)));
  }
  rows.push([Markup.button.callback('Kembali', 'back')]);
  return {
    text: `<b>Pilih kategori ${kindLabel(draft.kind).toLowerCase()}</b>`,
    keyboard: Markup.inlineKeyboard(rows),
  };
}

async function renderAccountMenu(draft, slot) {
  const accounts = await listAccounts();
  const rows = [];
  for (let i = 0; i < accounts.length; i += 2) {
    rows.push(
      accounts
        .slice(i, i + 2)
        .map((a) => Markup.button.callback(a.name, `${slot === 'to' ? 'a2' : 'a1'}:${a.id}`)),
    );
  }
  rows.push([Markup.button.callback('Kembali', 'back')]);
  return {
    text: slot === 'to' ? '<b>Pilih dompet tujuan</b>' : '<b>Pilih dompet</b>',
    keyboard: Markup.inlineKeyboard(rows),
  };
}

function helpText() {
  return [
    '<b>Dompetku</b> — catat keuangan langsung dari chat.',
    '',
    '<b>Contoh catat cepat</b>',
    '• <code>makan siang 25rb</code>',
    '• <code>gaji 5jt</code>',
    '• <code>transfer 100rb rekening ke e-wallet</code>',
    '• <code>kemarin kopi 18.000</code>',
    '',
    '<b>Perintah</b>',
    '/menu — buka menu tombol',
    '/start — tautkan chat dan buka menu',
    '/saldo — saldo semua dompet',
    '/laporan — ringkasan bulan ini',
    '/laporan 2026-10 — ringkasan bulan lain',
    '/anggaran — status anggaran',
    '/kategori — daftar kategori',
    '/batal — batalkan draft',
    '/backup — kirim backup data sekarang',
    '/help — bantuan ini',
    '',
    'Tombol menu juga tersedia di kiri kolom chat.',
    'Semua transaksi otomatis muncul di dashboard Dompetku.',
  ].join('\n');
}

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Saldo dompet', 'menu:saldo'), Markup.button.callback('Laporan', 'menu:laporan')],
    [Markup.button.callback('Anggaran', 'menu:anggaran'), Markup.button.callback('Kategori', 'menu:kategori')],
    [Markup.button.callback('Bantuan', 'menu:help')],
  ]);
}

function subMenuKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('Kembali ke menu', 'menu:main')]]);
}

function menuText() {
  return [
    '<b>Menu Dompetku</b>',
    '',
    'Pilih yang ingin dilihat, atau langsung kirim catatan seperti',
    '<code>makan siang 25rb</code>.',
  ].join('\n');
}

async function welcomeText(chatId) {
  const owner = await getOwnerChatId();
  if (!owner) {
    await setSetting('owner_chat_id', String(chatId));
    return [
      '<b>Berhasil tertaut.</b>',
      '',
      'Chat ini sekarang menjadi admin bot Dompetku.',
      'Buka tombol menu di kiri kolom chat, atau ketik /menu.',
      '',
      'Coba kirim: <code>makan siang 25rb</code>',
    ].join('\n');
  }
  return [
    '<b>Bot Dompetku siap dipakai.</b>',
    '',
    'Pilih menu di bawah, atau langsung kirim catatan seperti <code>kopi 18rb</code>.',
  ].join('\n');
}

async function summaryText(month) {
  const [summary, categories, accounts] = await Promise.all([
    monthSummary(month),
    categoryBreakdown(month, 'expense'),
    listAccounts(),
  ]);
  const total = accounts.reduce((acc, a) => acc + a.balance, 0);
  const lines = [
    `<b>Laporan ${monthLabel(month)}</b>`,
    '',
    `Pemasukan    <b>${formatIDR(summary.income)}</b>`,
    `Pengeluaran  <b>${formatIDR(summary.expense)}</b>`,
    `Selisih      <b>${summary.net >= 0 ? '+' : '-'}${formatIDR(Math.abs(summary.net))}</b>`,
  ];
  if (categories.length > 0) {
    lines.push('', '<b>Pengeluaran terbesar</b>');
    categories.slice(0, 5).forEach((c, index) => {
      lines.push(`${index + 1}. ${esc(c.name)} — ${formatIDR(c.amount)} (${c.percent}%)`);
    });
  }
  lines.push('', `Saldo total: <b>${formatIDR(total)}</b>`);
  return lines.join('\n');
}

async function budgetText(month) {
  const items = await listBudgets(month);
  if (items.length === 0) {
    return `<b>Anggaran ${monthLabel(month)}</b>\n\nBelum ada anggaran. Atur dari dashboard di menu Anggaran.`;
  }
  const lines = [`<b>Anggaran ${monthLabel(month)}</b>`, ''];
  for (const b of items) {
    lines.push(
      `<b>${esc(b.name)}</b>\n${formatIDR(b.spent)} / ${formatIDR(b.limit)} · ${b.percent}%`,
      `${progressBar(b.percent)}${b.status === 'over' ? ' (terlewati)' : b.status === 'warning' ? ' (mendekati batas)' : ''}`,
      '',
    );
  }
  const totalLimit = items.reduce((acc, b) => acc + b.limit, 0);
  const totalSpent = items.reduce((acc, b) => acc + b.spent, 0);
  lines.push(`Total: <b>${formatIDR(totalSpent)}</b> / ${formatIDR(totalLimit)}`);
  return lines.join('\n');
}

async function saldoText() {
  const accounts = await listAccounts();
  if (accounts.length === 0) {
    return 'Belum ada dompet. Tambahkan dompet dari dashboard Dompetku.';
  }
  const lines = ['<b>Saldo Dompet</b>', ''];
  let total = 0;
  for (const a of accounts) {
    total += a.balance;
    lines.push(`${esc(a.name)} — <b>${formatIDR(a.balance)}</b>`);
  }
  lines.push('', `Total: <b>${formatIDR(total)}</b>`);
  return lines.join('\n');
}

async function kategoriText() {
  const categories = await listCategories();
  const expense = categories.filter((c) => c.kind === 'expense');
  const income = categories.filter((c) => c.kind === 'income');
  const lines = ['<b>Kategori</b>', '', '<b>Pengeluaran</b>'];
  expense.forEach((c) => lines.push(`• ${esc(c.name)}`));
  lines.push('', '<b>Pemasukan</b>');
  income.forEach((c) => lines.push(`• ${esc(c.name)}`));
  lines.push('', 'Atur kategori dan kata kunci dari dashboard.');
  return lines.join('\n');
}

async function buildDraftFromText(text) {
  const [accounts, categories, defaultAccountId] = await Promise.all([
    listAccounts(),
    listCategories(),
    getDefaultAccountId(),
  ]);
  const draft = parseMessage(text, { accounts, categories, defaultAccountId, today: todayISO() });
  if (!draft.categoryId && draft.kind !== 'transfer') {
    const fallback = await fallbackCategory(draft.kind);
    if (fallback) {
      draft.categoryId = fallback.id;
      draft.categoryName = fallback.name;
    }
  }
  return draft;
}

async function sendDraft(ctx, chatId, draft) {
  draft.updatedAt = Date.now();
  pendingDrafts.set(String(chatId), draft);
  await ctx.replyWithHTML(await renderDraft(draft), draftKeyboard(draft));
}

export async function startBot(app) {
  if (!config.botToken) {
    console.warn('[bot] TELEGRAM_BOT_TOKEN belum diisi — bot Telegram nonaktif.');
    return null;
  }

  const bot = new Telegraf(config.botToken);
  bot.catch((err, ctx) => {
    console.error('[bot] error:', err.message);
    ctx.reply('Terjadi kesalahan. Coba lagi sebentar lagi.').catch(() => {});
  });

  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return next();
    const owner = await getOwnerChatId();
    if (!owner) {
      const text = ctx.message?.text || '';
      if (text.startsWith('/start')) return next();
      return ctx.reply('Halo! Kirim /start untuk menghubungkan chat ini dengan Dompetku.');
    }
    if (String(chatId) !== String(owner)) {
      return ctx.reply('Bot ini privat. Hubungi pemilik untuk mendapatkan akses.');
    }
    return next();
  });

  bot.start(async (ctx) => {
    const owner = await getOwnerChatId();
    if (owner && String(ctx.chat.id) !== String(owner)) {
      return ctx.reply('Bot ini sudah terhubung dengan pemilik lain.');
    }
    await ctx.replyWithHTML(await welcomeText(ctx.chat.id), mainMenuKeyboard());
  });

  bot.command('menu', (ctx) => ctx.replyWithHTML(menuText(), mainMenuKeyboard()));

  bot.help((ctx) => ctx.replyWithHTML(helpText()));

  bot.command('saldo', (ctx) => ctx.replyWithHTML(saldoText()));

  bot.command('laporan', async (ctx) => {
    const parts = (ctx.message.text || '').trim().split(/\s+/);
    let month = currentMonth();
    if (parts[1]) {
      if (!isValidMonth(parts[1])) return ctx.reply('Format bulan: /laporan 2026-10');
      month = parts[1];
    }
    await ctx.replyWithHTML(await summaryText(month));
  });

  bot.command('anggaran', async (ctx) => {
    const parts = (ctx.message.text || '').trim().split(/\s+/);
    let month = currentMonth();
    if (parts[1] && isValidMonth(parts[1])) month = parts[1];
    await ctx.replyWithHTML(await budgetText(month));
  });

  bot.command('kategori', (ctx) => ctx.replyWithHTML(kategoriText()));

  bot.command('batal', async (ctx) => {
    pendingDrafts.delete(String(ctx.chat.id));
    await ctx.reply('Draft dibatalkan.');
  });

  bot.command('backup', async (ctx) => {
    try {
      await sendBackup(bot);
    } catch (err) {
      console.error('[bot] gagal mengirim backup:', err.message);
      await ctx.reply('Backup gagal dikirim. Coba lagi sebentar lagi.');
    }
  });

  bot.on('text', async (ctx) => {
    const text = (ctx.message.text || '').trim();
    if (!text || text.startsWith('/')) return;
    if (text.toLowerCase() === 'menu') {
      await ctx.replyWithHTML(menuText(), mainMenuKeyboard());
      return;
    }
    try {
      await sendDraft(ctx, ctx.chat.id, await buildDraftFromText(text));
    } catch (err) {
      if (err instanceof ParseError) {
        await ctx.replyWithHTML(
          `${esc(err.message)}\n\nContoh:\n<code>makan siang 25rb</code>\n<code>gaji 5jt</code>\n<code>transfer 100rb tunai ke rekening</code>`,
        );
        return;
      }
      throw err;
    }
  });

  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery?.data || '';
    const chatId = String(ctx.chat?.id);
    const answer = (text) => ctx.answerCbQuery(text).catch(() => {});

    if (data.startsWith('undo:')) {
      const id = Number(data.split(':')[1]);
      try {
        await deleteTransaction(id);
        await ctx.editMessageText('<b>Transaksi dihapus.</b>', { parse_mode: 'HTML' });
        await answer('Dihapus');
      } catch {
        await answer('Transaksi sudah tidak ada');
      }
      return;
    }

    if (data.startsWith('menu:')) {
      const view = data.slice(5);
      try {
        if (view === 'saldo') {
          await ctx.editMessageText(await saldoText(), { parse_mode: 'HTML', ...subMenuKeyboard() });
        } else if (view === 'laporan') {
          await ctx.editMessageText(await summaryText(currentMonth()), {
            parse_mode: 'HTML',
            ...subMenuKeyboard(),
          });
        } else if (view === 'anggaran') {
          await ctx.editMessageText(await budgetText(currentMonth()), {
            parse_mode: 'HTML',
            ...subMenuKeyboard(),
          });
        } else if (view === 'kategori') {
          await ctx.editMessageText(await kategoriText(), { parse_mode: 'HTML', ...subMenuKeyboard() });
        } else if (view === 'help') {
          await ctx.editMessageText(helpText(), { parse_mode: 'HTML', ...subMenuKeyboard() });
        } else {
          await ctx.editMessageText(menuText(), { parse_mode: 'HTML', ...mainMenuKeyboard() });
        }
        await answer();
      } catch (err) {
        console.error('[bot] gagal membuka menu:', err.message);
        await answer('Menu gagal dibuka');
      }
      return;
    }

    const draft = pendingDrafts.get(chatId);
    if (!draft) {
      await answer('Draft sudah kedaluwarsa');
      await ctx.editMessageText('Draft sudah kedaluwarsa. Kirim ulang transaksinya ya.').catch(() => {});
      return;
    }

    if (data === 'cancel') {
      pendingDrafts.delete(chatId);
      await ctx.editMessageText('Draft dibatalkan.').catch(() => {});
      await answer('Dibatalkan');
      return;
    }

    if (data === 'save') {
      try {
        const transaction = await createTransaction(
          {
            kind: draft.kind,
            amount: draft.amount,
            accountId: draft.accountId,
            toAccountId: draft.toAccountId,
            categoryId: draft.categoryId,
            note: draft.note,
            occurredOn: draft.occurredOn,
          },
          { source: 'telegram' },
        );
        pendingDrafts.delete(chatId);

        const account = await getAccount(draft.accountId);
        const lines = ['<b>Tersimpan.</b>', ''];
        lines.push(`<b>${kindLabel(draft.kind)}</b> · ${formatIDR(draft.amount)}`);
        if (draft.kind === 'transfer') {
          lines.push(`Dompet: ${esc(draft.accountName)} → ${esc(draft.toAccountName)}`);
        } else {
          lines.push(`Kategori: ${esc(draft.categoryName || 'Tanpa kategori')}`);
        }
        if (draft.note) lines.push(`Catatan: ${esc(draft.note)}`);
        if (account) lines.push('', `Saldo ${esc(account.name)}: <b>${formatIDR(account.balance)}</b>`);

        if (draft.kind === 'expense' && draft.categoryId) {
          const alert = await budgetAlert(draft.categoryId, draft.occurredOn.slice(0, 7));
          if (alert) {
            lines.push('');
            if (alert.status === 'over') {
              lines.push(
                `<b>Anggaran ${esc(alert.name)} terlewati.</b> ${formatIDR(alert.spent)} dari ${formatIDR(alert.limit)}`,
              );
            } else {
              lines.push(
                `Anggaran ${esc(alert.name)} sudah ${alert.percent}% (${formatIDR(alert.spent)} / ${formatIDR(alert.limit)})`,
              );
            }
          }
        }

        await ctx.editMessageText(lines.join('\n'), {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('Urungkan', `undo:${transaction.id}`)]]),
        });
        await answer('Tersimpan');
      } catch (err) {
        console.error('[bot] gagal menyimpan:', err.message);
        await answer('Gagal menyimpan');
        await ctx.reply(err.message);
      }
      return;
    }

    if (data === 'pick-category') {
      const menu = await renderCategoryMenu(draft);
      await ctx.editMessageText(menu.text, { parse_mode: 'HTML', ...menu.keyboard });
      await answer();
      return;
    }

    if (data === 'pick-account') {
      const menu = await renderAccountMenu(draft, 'from');
      await ctx.editMessageText(menu.text, { parse_mode: 'HTML', ...menu.keyboard });
      await answer();
      return;
    }

    if (data === 'pick-from' || data === 'pick-to') {
      const menu = await renderAccountMenu(draft, data === 'pick-to' ? 'to' : 'from');
      await ctx.editMessageText(menu.text, { parse_mode: 'HTML', ...menu.keyboard });
      await answer();
      return;
    }

    if (data === 'back') {
      await ctx.editMessageText(await renderDraft(draft), {
        parse_mode: 'HTML',
        ...draftKeyboard(draft),
      });
      await answer();
      return;
    }

    if (data.startsWith('cat:')) {
      const id = Number(data.split(':')[1]);
      const category = (await listCategories()).find((c) => c.id === id);
      if (category) {
        draft.categoryId = category.id;
        draft.categoryName = category.name;
        draft.updatedAt = Date.now();
      }
      await ctx.editMessageText(await renderDraft(draft), {
        parse_mode: 'HTML',
        ...draftKeyboard(draft),
      });
      await answer('Kategori diperbarui');
      return;
    }

    if (data.startsWith('a1:') || data.startsWith('a2:')) {
      const slot = data.slice(0, 2);
      const id = Number(data.split(':')[1]);
      const account = (await listAccounts()).find((a) => a.id === id);
      if (account) {
        if (slot === 'a1') {
          if (draft.kind === 'transfer' && draft.toAccountId === account.id) {
            await answer('Dompet tujuan tidak boleh sama');
            return;
          }
          draft.accountId = account.id;
          draft.accountName = account.name;
        } else {
          if (draft.accountId === account.id) {
            await answer('Dompet asal tidak boleh sama');
            return;
          }
          draft.toAccountId = account.id;
          draft.toAccountName = account.name;
        }
        draft.updatedAt = Date.now();
      }
      await ctx.editMessageText(await renderDraft(draft), {
        parse_mode: 'HTML',
        ...draftKeyboard(draft),
      });
      await answer('Dompet diperbarui');
    }
  });

  setInterval(cleanupDrafts, 5 * 60 * 1000).unref();

  let me;
  try {
    me = await bot.telegram.getMe();
    bot.botInfo = me;
    console.log(`[bot] terhubung sebagai @${me.username}`);
  } catch (err) {
    console.error('[bot] token tidak valid:', err.message);
    return null;
  }

  await bot.telegram
    .setMyCommands([
      { command: 'start', description: 'Tautkan chat dan buka menu' },
      { command: 'menu', description: 'Buka menu utama' },
      { command: 'saldo', description: 'Lihat saldo semua dompet' },
      { command: 'laporan', description: 'Ringkasan bulan ini' },
      { command: 'anggaran', description: 'Status anggaran bulan ini' },
      { command: 'kategori', description: 'Daftar kategori' },
      { command: 'batal', description: 'Batalkan draft' },
      { command: 'backup', description: 'Kirim backup data sekarang' },
      { command: 'help', description: 'Bantuan' },
    ])
    .catch(() => {});

  await bot.telegram
    .setChatMenuButton({ menuButton: { type: 'commands' } })
    .catch(() => {});

  if (config.publicUrl) {
    const hookPath = '/api/telegram/webhook';
    await bot.telegram.setWebhook(`${config.publicUrl}${hookPath}`, {
      secret_token: config.webhookSecret,
      drop_pending_updates: true,
    });
    app.post(
      hookPath,
      express.json({ limit: '1mb' }),
      bot.webhookCallback(hookPath, { secretToken: config.webhookSecret }),
    );
    console.log(`[bot] mode webhook: ${config.publicUrl}${hookPath}`);
  } else {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
    bot.launch({ dropPendingUpdates: true }).catch((err) => {
      console.error('[bot] polling berhenti:', err.message);
    });
    console.log('[bot] mode polling aktif');
  }

  startBackupScheduler(bot);

  return bot;
}
