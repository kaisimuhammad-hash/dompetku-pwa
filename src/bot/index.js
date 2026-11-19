import { Markup, Telegraf } from 'telegraf';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { ParseError, findAmount, parseMessage } from '../lib/parse.js';
import {
  currentMonth,
  formatDateLong,
  formatIDR,
  isValidDate,
  isValidMonth,
  monthLabel,
  shiftDate,
  todayISO,
} from '../lib/format.js';
import { getAccount, listAccounts } from '../services/accounts.js';
import { fallbackCategory, listCategories } from '../services/categories.js';
import { budgetAlert, listBudgets } from '../services/budgets.js';
import { categoryBreakdown, monthSummary } from '../services/reports.js';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
} from '../services/transactions.js';
import { getDefaultAccountId, getOwnerChatId, getStoredBotToken, setSetting } from '../services/settings.js';
import { sendBackup } from '../services/backup.js';

const pendingDrafts = new Map();
const pendingEdits = new Map();
const DRAFT_TTL = 30 * 60 * 1000;
const EDIT_TTL = 15 * 60 * 1000;

export const TELEGRAM_WEBHOOK_PATH = '/api/telegram/webhook';

let activeBot = null;
let activeWebhook = null;
let activeSource = null;

export function getActiveBot() {
  return activeBot;
}

export function getBotSource() {
  return activeSource;
}

setInterval(cleanupDrafts, 5 * 60 * 1000).unref();

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
  for (const [key, value] of pendingEdits) {
    if (now - value.updatedAt > EDIT_TTL) pendingEdits.delete(key);
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
    '/transaksi — lihat dan edit riwayat transaksi',
    '/batal — batalkan draft atau mode edit',
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
    [Markup.button.callback('📋 Riwayat & Edit Transaksi', 'menu:transaksi')],
    [Markup.button.callback('Bantuan', 'menu:help')],
  ]);
}

function subMenuKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('Kembali ke menu', 'menu:main')]]);
}

async function renderTransactionList(limit = 6) {
  const transactions = await listTransactions({ limit });
  if (transactions.length === 0) {
    return {
      text: '<b>Belum ada transaksi yang tercatat.</b>\n\nKirim pesan seperti <code>makan 25rb</code> atau <code>gaji 5jt</code> untuk mulai mencatat.',
      keyboard: subMenuKeyboard(),
    };
  }

  const lines = ['<b>📋 Riwayat Transaksi Terakhir</b>', 'Pilih transaksi yang ingin diedit atau dihapus:', ''];
  const rows = [];

  transactions.forEach((t) => {
    const symbol = t.kind === 'income' ? '🟢' : t.kind === 'expense' ? '🔴' : '🔄';
    const noteStr = t.note ? ` • <i>${esc(t.note)}</i>` : '';
    const catStr = t.categoryName ? esc(t.categoryName) : 'Tanpa Kategori';
    lines.push(
      `${symbol} <b>#${t.id}</b> · ${formatIDR(t.amount)} (${kindLabel(t.kind)})`,
      `   🏷 ${catStr} · 💳 ${esc(t.accountName)} · 📅 ${t.occurredOn}${noteStr}`,
      '',
    );

    rows.push([
      Markup.button.callback(`✏️ Edit #${t.id}`, `tx_edit:${t.id}`),
      Markup.button.callback(`🗑 Hapus #${t.id}`, `tx_del:${t.id}`),
    ]);
  });

  rows.push([Markup.button.callback('Kembali ke menu', 'menu:main')]);

  return {
    text: lines.join('\n'),
    keyboard: Markup.inlineKeyboard(rows),
  };
}

async function renderTransactionDetail(id, prefix = '') {
  const tx = await getTransaction(id);
  if (!tx) {
    return {
      text: 'Transaksi tidak ditemukan atau sudah dihapus.',
      keyboard: Markup.inlineKeyboard([[Markup.button.callback('Kembali ke riwayat', 'menu:transaksi')]]),
    };
  }

  const lines = [];
  if (prefix) {
    lines.push(prefix, '');
  }
  lines.push(`<b>Detail Transaksi #${tx.id}</b>`, '');
  lines.push(`Jenis: <b>${kindLabel(tx.kind)}</b>`);
  lines.push(`Nominal: <b>${formatIDR(tx.amount)}</b>`);
  lines.push(`Dompet: <b>${esc(tx.accountName || '-')}</b>`);
  if (tx.kind === 'transfer') {
    lines.push(`Tujuan: <b>${esc(tx.toAccountName || '-')}</b>`);
  } else {
    lines.push(`Kategori: <b>${esc(tx.categoryName || 'Tanpa Kategori')}</b>`);
  }
  lines.push(`Catatan: <b>${esc(tx.note || '-')}</b>`);
  lines.push(`Tanggal: <b>${formatDateLong(tx.occurredOn)}</b>`);
  lines.push('', '<i>Pilih data yang ingin Anda ubah:</i>');

  const rows = [
    [Markup.button.callback('💰 Ubah Nominal', `tx_amt:${tx.id}`), Markup.button.callback('🏷 Ganti Kategori', `tx_cat:${tx.id}`)],
    [Markup.button.callback('💳 Ganti Dompet', `tx_acc:${tx.id}`), Markup.button.callback('📝 Ubah Catatan', `tx_note:${tx.id}`)],
    [Markup.button.callback('📅 Ubah Tanggal', `tx_date:${tx.id}`), Markup.button.callback('🔄 Tukar Jenis', `tx_toggle_kind:${tx.id}`)],
    [Markup.button.callback('🗑 Hapus Transaksi', `tx_del:${tx.id}`)],
    [Markup.button.callback('◀️ Kembali ke Riwayat', 'menu:transaksi')],
  ];

  return {
    text: lines.join('\n'),
    keyboard: Markup.inlineKeyboard(rows),
  };
}

async function renderEditCategoryMenu(id) {
  const tx = await getTransaction(id);
  if (!tx) return { text: 'Transaksi tidak ditemukan.', keyboard: subMenuKeyboard() };
  const categories = (await listCategories()).filter((c) => c.kind === tx.kind);
  const rows = [];
  for (let i = 0; i < categories.length; i += 2) {
    rows.push(categories.slice(i, i + 2).map((c) => Markup.button.callback(c.name, `tx_set_cat:${tx.id}:${c.id}`)));
  }
  rows.push([Markup.button.callback('Batal / Kembali', `tx_edit:${tx.id}`)]);
  return {
    text: `<b>Pilih Kategori Baru untuk Transaksi #${tx.id} (${kindLabel(tx.kind)})</b>`,
    keyboard: Markup.inlineKeyboard(rows),
  };
}

async function renderEditAccountMenu(id) {
  const tx = await getTransaction(id);
  if (!tx) return { text: 'Transaksi tidak ditemukan.', keyboard: subMenuKeyboard() };
  const accounts = await listAccounts();
  const rows = [];
  for (let i = 0; i < accounts.length; i += 2) {
    rows.push(accounts.slice(i, i + 2).map((a) => Markup.button.callback(a.name, `tx_set_acc:${tx.id}:${a.id}`)));
  }
  rows.push([Markup.button.callback('Batal / Kembali', `tx_edit:${tx.id}`)]);
  return {
    text: `<b>Pilih Dompet Baru untuk Transaksi #${tx.id}</b>`,
    keyboard: Markup.inlineKeyboard(rows),
  };
}

function renderEditDateMenu(id) {
  const yesterday = shiftDate(todayISO(), -1);
  return {
    text: `<b>Pilih Tanggal Baru untuk Transaksi #${id}</b>`,
    keyboard: Markup.inlineKeyboard([
      [Markup.button.callback('Hari Ini', `tx_set_date:${id}:${todayISO()}`), Markup.button.callback('Kemarin', `tx_set_date:${id}:${yesterday}`)],
      [Markup.button.callback('Ketik Tanggal Manual', `tx_manual_date:${id}`)],
      [Markup.button.callback('Batal / Kembali', `tx_edit:${id}`)],
    ]),
  };
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

export function buildBot(token) {
  const bot = new Telegraf(token);
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

  bot.command('transaksi', async (ctx) => {
    const list = await renderTransactionList(6);
    await ctx.replyWithHTML(list.text, list.keyboard);
  });

  bot.command('riwayat', async (ctx) => {
    const list = await renderTransactionList(6);
    await ctx.replyWithHTML(list.text, list.keyboard);
  });

  bot.command('batal', async (ctx) => {
    pendingDrafts.delete(String(ctx.chat.id));
    pendingEdits.delete(String(ctx.chat.id));
    await ctx.reply('Draft dan mode edit berhasil dibatalkan.');
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
    const chatId = String(ctx.chat?.id);

    // Cek apakah user sedang dalam proses edit field transaksi
    const edit = pendingEdits.get(chatId);
    if (edit) {
      if (edit.step === 'amount') {
        const amounts = findAmount(text);
        if (amounts.length > 0 && amounts[0] > 0) {
          try {
            await updateTransaction(edit.transactionId, { amount: amounts[0] });
            pendingEdits.delete(chatId);
            const detail = await renderTransactionDetail(
              edit.transactionId,
              `✅ <b>Nominal berhasil diubah menjadi ${formatIDR(amounts[0])}!</b>`,
            );
            await ctx.replyWithHTML(detail.text, detail.keyboard);
            return;
          } catch (err) {
            await ctx.reply(`Gagal memperbarui nominal: ${err.message}`);
            return;
          }
        } else {
          await ctx.replyWithHTML(
            'Nominal tidak valid. Silakan ketik angka seperti <code>50rb</code>, <code>75000</code>, atau kirim /batal.',
          );
          return;
        }
      }

      if (edit.step === 'note') {
        const newNote = text === '-' ? '' : text.slice(0, 100);
        try {
          await updateTransaction(edit.transactionId, { note: newNote });
          pendingEdits.delete(chatId);
          const detail = await renderTransactionDetail(edit.transactionId, '✅ <b>Catatan berhasil diperbarui!</b>');
          await ctx.replyWithHTML(detail.text, detail.keyboard);
          return;
        } catch (err) {
          await ctx.reply(`Gagal memperbarui catatan: ${err.message}`);
          return;
        }
      }

      if (edit.step === 'date') {
        if (isValidDate(text)) {
          try {
            await updateTransaction(edit.transactionId, { occurredOn: text });
            pendingEdits.delete(chatId);
            const detail = await renderTransactionDetail(
              edit.transactionId,
              `✅ <b>Tanggal transaksi berhasil diubah menjadi ${formatDateLong(text)}!</b>`,
            );
            await ctx.replyWithHTML(detail.text, detail.keyboard);
            return;
          } catch (err) {
            await ctx.reply(`Gagal memperbarui tanggal: ${err.message}`);
            return;
          }
        } else {
          await ctx.replyWithHTML(
            'Format tanggal harus YYYY-MM-DD (contoh: <code>2026-11-19</code>) atau kirim /batal.',
          );
          return;
        }
      }
    }

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
        } else if (view === 'transaksi') {
          const list = await renderTransactionList(6);
          await ctx.editMessageText(list.text, { parse_mode: 'HTML', ...list.keyboard });
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

    // Callback Actions untuk Edit & Kelola Transaksi
    if (data.startsWith('tx_edit:')) {
      const id = Number(data.split(':')[1]);
      try {
        const detail = await renderTransactionDetail(id);
        await ctx.editMessageText(detail.text, { parse_mode: 'HTML', ...detail.keyboard });
        await answer();
      } catch (err) {
        console.error('[bot] gagal edit transaksi:', err.message);
        await answer('Gagal memuat transaksi');
      }
      return;
    }

    if (data.startsWith('tx_del:')) {
      const id = Number(data.split(':')[1]);
      try {
        await deleteTransaction(id);
        await ctx.editMessageText(`<b>Transaksi #${id} berhasil dihapus.</b>`, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('◀️ Kembali ke Riwayat', 'menu:transaksi')]]),
        });
        await answer('Berhasil dihapus');
      } catch (err) {
        console.error('[bot] gagal hapus transaksi:', err.message);
        await answer('Gagal menghapus transaksi');
      }
      return;
    }

    if (data.startsWith('tx_amt:')) {
      const id = Number(data.split(':')[1]);
      const tx = await getTransaction(id);
      if (!tx) {
        await answer('Transaksi tidak ditemukan');
        return;
      }
      pendingEdits.set(chatId, { step: 'amount', transactionId: id, updatedAt: Date.now() });
      await ctx.editMessageText(
        `<b>Ubah Nominal Transaksi #${id}</b>\n\nNominal saat ini: <b>${formatIDR(tx.amount)}</b>\n\nSilakan ketik nominal baru di chat ini (contoh: <code>50rb</code>, <code>75000</code>, atau <code>1.5jt</code>).\nKetik /batal untuk membatalkan.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('Batal / Kembali', `tx_edit:${id}`)]]),
        },
      );
      await answer();
      return;
    }

    if (data.startsWith('tx_note:')) {
      const id = Number(data.split(':')[1]);
      const tx = await getTransaction(id);
      if (!tx) {
        await answer('Transaksi tidak ditemukan');
        return;
      }
      pendingEdits.set(chatId, { step: 'note', transactionId: id, updatedAt: Date.now() });
      await ctx.editMessageText(
        `<b>Ubah Catatan Transaksi #${id}</b>\n\nCatatan saat ini: <b>${esc(tx.note || '-')}</b>\n\nSilakan ketik catatan baru di chat ini (atau ketik <code>-</code> untuk menghapus catatan).\nKetik /batal untuk membatalkan.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('Batal / Kembali', `tx_edit:${id}`)]]),
        },
      );
      await answer();
      return;
    }

    if (data.startsWith('tx_cat:')) {
      const id = Number(data.split(':')[1]);
      const menu = await renderEditCategoryMenu(id);
      await ctx.editMessageText(menu.text, { parse_mode: 'HTML', ...menu.keyboard });
      await answer();
      return;
    }

    if (data.startsWith('tx_set_cat:')) {
      const parts = data.split(':');
      const id = Number(parts[1]);
      const catId = Number(parts[2]);
      try {
        await updateTransaction(id, { categoryId: catId });
        const detail = await renderTransactionDetail(id, '✅ <b>Kategori berhasil diubah!</b>');
        await ctx.editMessageText(detail.text, { parse_mode: 'HTML', ...detail.keyboard });
        await answer('Kategori diperbarui');
      } catch (err) {
        console.error('[bot] gagal ubah kategori:', err.message);
        await answer('Gagal mengubah kategori');
      }
      return;
    }

    if (data.startsWith('tx_acc:')) {
      const id = Number(data.split(':')[1]);
      const menu = await renderEditAccountMenu(id);
      await ctx.editMessageText(menu.text, { parse_mode: 'HTML', ...menu.keyboard });
      await answer();
      return;
    }

    if (data.startsWith('tx_set_acc:')) {
      const parts = data.split(':');
      const id = Number(parts[1]);
      const accId = Number(parts[2]);
      try {
        await updateTransaction(id, { accountId: accId });
        const detail = await renderTransactionDetail(id, '✅ <b>Dompet berhasil diubah!</b>');
        await ctx.editMessageText(detail.text, { parse_mode: 'HTML', ...detail.keyboard });
        await answer('Dompet diperbarui');
      } catch (err) {
        console.error('[bot] gagal ubah dompet:', err.message);
        await answer('Gagal mengubah dompet');
      }
      return;
    }

    if (data.startsWith('tx_date:')) {
      const id = Number(data.split(':')[1]);
      const menu = renderEditDateMenu(id);
      await ctx.editMessageText(menu.text, { parse_mode: 'HTML', ...menu.keyboard });
      await answer();
      return;
    }

    if (data.startsWith('tx_set_date:')) {
      const parts = data.split(':');
      const id = Number(parts[1]);
      const dateVal = parts[2];
      try {
        await updateTransaction(id, { occurredOn: dateVal });
        const detail = await renderTransactionDetail(id, `✅ <b>Tanggal diubah menjadi ${formatDateLong(dateVal)}!</b>`);
        await ctx.editMessageText(detail.text, { parse_mode: 'HTML', ...detail.keyboard });
        await answer('Tanggal diperbarui');
      } catch (err) {
        console.error('[bot] gagal ubah tanggal:', err.message);
        await answer('Gagal mengubah tanggal');
      }
      return;
    }

    if (data.startsWith('tx_manual_date:')) {
      const id = Number(data.split(':')[1]);
      pendingEdits.set(chatId, { step: 'date', transactionId: id, updatedAt: Date.now() });
      await ctx.editMessageText(
        `<b>Ubah Tanggal Transaksi #${id}</b>\n\nKetik tanggal baru dengan format <code>YYYY-MM-DD</code> (contoh: <code>2026-11-19</code>).\nKetik /batal untuk membatalkan.`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('Batal / Kembali', `tx_edit:${id}`)]]),
        },
      );
      await answer();
      return;
    }

    if (data.startsWith('tx_toggle_kind:')) {
      const id = Number(data.split(':')[1]);
      try {
        const tx = await getTransaction(id);
        if (!tx || tx.kind === 'transfer') {
          await answer('Tidak dapat mengubah jenis transaksi ini');
          return;
        }
        const newKind = tx.kind === 'expense' ? 'income' : 'expense';
        const fallback = await fallbackCategory(newKind);
        await updateTransaction(id, { kind: newKind, categoryId: fallback ? fallback.id : null });
        const detail = await renderTransactionDetail(id, `✅ <b>Jenis transaksi diubah menjadi ${kindLabel(newKind)}!</b>`);
        await ctx.editMessageText(detail.text, { parse_mode: 'HTML', ...detail.keyboard });
        await answer(`Diubah ke ${kindLabel(newKind)}`);
      } catch (err) {
        console.error('[bot] gagal toggle kind:', err.message);
        await answer('Gagal mengubah jenis transaksi');
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
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✏️ Edit Transaksi', `tx_edit:${transaction.id}`),
              Markup.button.callback('Urungkan / Hapus', `undo:${transaction.id}`),
            ],
            [Markup.button.callback('📋 Riwayat Transaksi', 'menu:transaksi')],
          ]),
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

  return bot;
}

const BOT_COMMANDS = [
  { command: 'start', description: 'Tautkan chat dan buka menu' },
  { command: 'menu', description: 'Buka menu utama' },
  { command: 'transaksi', description: 'Lihat dan edit transaksi' },
  { command: 'saldo', description: 'Lihat saldo semua dompet' },
  { command: 'laporan', description: 'Ringkasan bulan ini' },
  { command: 'anggaran', description: 'Status anggaran bulan ini' },
  { command: 'kategori', description: 'Daftar kategori' },
  { command: 'batal', description: 'Batalkan draft atau mode edit' },
  { command: 'backup', description: 'Kirim backup data sekarang' },
  { command: 'help', description: 'Bantuan' },
];

async function stopBot(bot, { dropWebhook = true } = {}) {
  if (!bot) return;
  if (dropWebhook) {
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    } catch {}
  }
  try {
    await bot.stop('SIGTERM');
  } catch {}
}

export async function connectBot(token, { source = 'dashboard' } = {}) {
  const cleanToken = String(token || '').trim();
  const bot = buildBot(cleanToken);

  let me;
  try {
    me = await bot.telegram.getMe();
  } catch {
    throw new AppError('Token bot tidak valid atau sudah dicabut. Salin ulang dari @BotFather.', 400);
  }
  bot.botInfo = me;

  await bot.telegram.setMyCommands(BOT_COMMANDS).catch(() => {});
  await bot.telegram.setChatMenuButton({ menuButton: { type: 'commands' } }).catch(() => {});

  const webhook = bot.webhookCallback(TELEGRAM_WEBHOOK_PATH, {
    secretToken: config.webhookSecret,
  });

  if (config.publicUrl) {
    await bot.telegram.setWebhook(`${config.publicUrl}${TELEGRAM_WEBHOOK_PATH}`, {
      secret_token: config.webhookSecret,
      drop_pending_updates: true,
    });
    console.log(`[bot] mode webhook: ${config.publicUrl}${TELEGRAM_WEBHOOK_PATH}`);
  } else {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
    bot.launch({ dropPendingUpdates: true }).catch((err) => {
      console.error('[bot] polling berhenti:', err.message);
    });
    console.log('[bot] mode polling aktif');
  }

  const previousBot = activeBot;
  activeBot = bot;
  activeWebhook = webhook;
  activeSource = source;
  console.log(`[bot] terhubung sebagai @${me.username} (${source})`);

  if (previousBot && previousBot !== bot) {
    const sameToken = previousBot.telegram.token === bot.telegram.token;
    await stopBot(previousBot, { dropWebhook: !sameToken });
  }

  return bot;
}

export async function disconnectBot() {
  const bot = activeBot;
  activeBot = null;
  activeWebhook = null;
  activeSource = null;
  await stopBot(bot);
  return Boolean(bot);
}

export function telegramWebhookHandler(req, res, next) {
  if (!activeWebhook) {
    return res.status(503).json({ ok: false, error: 'Bot Telegram belum aktif' });
  }
  return activeWebhook(req, res, next);
}

export async function startBot() {
  const stored = await getStoredBotToken().catch(() => null);
  const candidates = [
    stored ? { token: stored, source: 'dashboard' } : null,
    config.botToken ? { token: config.botToken, source: 'env' } : null,
  ].filter(Boolean);

  if (candidates.length === 0) {
    console.log('[bot] belum ada token. Tempel token dari dashboard → Pengaturan.');
    return null;
  }

  for (const candidate of candidates) {
    try {
      return await connectBot(candidate.token, { source: candidate.source });
    } catch (err) {
      console.error(`[bot] gagal memakai token ${candidate.source}:`, err.message);
    }
  }
  return null;
}
