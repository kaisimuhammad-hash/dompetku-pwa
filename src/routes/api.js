import express from 'express';
import { config } from '../config.js';
import {
  SESSION_COOKIE,
  checkPasscode,
  createSessionToken,
  isAuthenticated,
  requireAuth,
} from '../lib/auth.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { currentMonth, isValidMonth, maskChatId, monthBounds } from '../lib/format.js';
import { createAccount, archiveAccount, listAccounts, restoreAccount, updateAccount } from '../services/accounts.js';
import {
  archiveCategory,
  createCategory,
  listCategories,
  restoreCategory,
  updateCategory,
} from '../services/categories.js';
import {
  copyBudgets,
  deleteBudget,
  listBudgets,
  upsertBudget,
} from '../services/budgets.js';
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  updateTransaction,
} from '../services/transactions.js';
import { cashflowMonths, monthSummary, overview } from '../services/reports.js';
import { allTransactions, backupJson, transactionsToCsv, transactionsToXlsx } from '../services/export.js';
import {
  deleteSetting,
  getDefaultAccountId,
  getOwnerChatId,
  getStoredBotToken,
  setDefaultAccountId,
  setStoredBotToken,
} from '../services/settings.js';
import { connectBot, getBotSource } from '../bot/index.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const loginAttempts = new Map();
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_LIMIT = 8;

function loginRateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count: 0, reset: now + LOGIN_WINDOW };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + LOGIN_WINDOW;
  }
  if (entry.count >= LOGIN_LIMIT) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' });
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
  next();
}

function idParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('ID tidak valid');
  return id;
}

function monthQuery(req) {
  const month = String(req.query.month || currentMonth());
  if (!isValidMonth(month)) throw badRequest('Format bulan harus YYYY-MM');
  return month;
}

function exportRange(req) {
  if (req.query.month) {
    const bounds = monthBounds(monthQuery(req));
    return { from: bounds.start, to: bounds.to };
  }
  return {
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
  };
}

function filenameFor(ext) {
  return `dompetku-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

export function createApiRouter({ getBot }) {
  const router = express.Router();
  router.use(express.json({ limit: '200kb' }));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  router.get('/session', (req, res) => {
    res.json({ authenticated: isAuthenticated(req), demoPasscode: !config.isProd && config.appPasscode === 'dompetku' });
  });

  router.post(
    '/auth/login',
    loginRateLimit,
    wrap(async (req, res) => {
      const passcode = String(req.body?.passcode || '');
      if (!checkPasscode(passcode)) {
        throw new AppError('Kode akses salah', 401);
      }
      loginAttempts.delete(req.ip || 'unknown');
      res.cookie(SESSION_COOKIE, createSessionToken(), {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/',
      });
      res.json({ ok: true });
    }),
  );

  router.post('/auth/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  router.use(requireAuth);

  router.get(
    '/overview',
    wrap(async (req, res) => {
      res.json(await overview(monthQuery(req)));
    }),
  );

  router.get(
    '/cashflow',
    wrap(async (req, res) => {
      const months = Math.min(Math.max(Number(req.query.months) || 6, 2), 12);
      res.json({ items: await cashflowMonths(months, monthQuery(req)) });
    }),
  );

  router.get(
    '/transactions',
    wrap(async (req, res) => {
      const items = await listTransactions({
        month: req.query.month ? monthQuery(req) : undefined,
        from: req.query.from,
        to: req.query.to,
        accountId: req.query.accountId,
        categoryId: req.query.categoryId,
        kind: req.query.kind,
        q: req.query.q,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      res.json({ items });
    }),
  );

  router.post(
    '/transactions',
    wrap(async (req, res) => {
      const transaction = await createTransaction(req.body, { source: 'web' });
      res.status(201).json(transaction);
    }),
  );

  router.patch(
    '/transactions/:id',
    wrap(async (req, res) => {
      res.json(await updateTransaction(idParam(req), req.body));
    }),
  );

  router.delete(
    '/transactions/:id',
    wrap(async (req, res) => {
      res.json(await deleteTransaction(idParam(req)));
    }),
  );

  router.get(
    '/accounts',
    wrap(async (req, res) => {
      res.json({ items: await listAccounts({ includeArchived: req.query.includeArchived === '1' }) });
    }),
  );

  router.post(
    '/accounts',
    wrap(async (req, res) => {
      res.status(201).json(await createAccount(req.body));
    }),
  );

  router.patch(
    '/accounts/:id',
    wrap(async (req, res) => {
      res.json(await updateAccount(idParam(req), req.body));
    }),
  );

  router.delete(
    '/accounts/:id',
    wrap(async (req, res) => {
      res.json(await archiveAccount(idParam(req)));
    }),
  );

  router.post(
    '/accounts/:id/restore',
    wrap(async (req, res) => {
      res.json(await restoreAccount(idParam(req)));
    }),
  );

  router.get(
    '/categories',
    wrap(async (req, res) => {
      res.json({
        items: await listCategories({
          includeArchived: req.query.includeArchived === '1',
          kind: req.query.kind,
        }),
      });
    }),
  );

  router.post(
    '/categories',
    wrap(async (req, res) => {
      res.status(201).json(await createCategory(req.body));
    }),
  );

  router.patch(
    '/categories/:id',
    wrap(async (req, res) => {
      res.json(await updateCategory(idParam(req), req.body));
    }),
  );

  router.delete(
    '/categories/:id',
    wrap(async (req, res) => {
      res.json(await archiveCategory(idParam(req)));
    }),
  );

  router.post(
    '/categories/:id/restore',
    wrap(async (req, res) => {
      res.json(await restoreCategory(idParam(req)));
    }),
  );

  router.get(
    '/budgets',
    wrap(async (req, res) => {
      res.json({ items: await listBudgets(monthQuery(req)) });
    }),
  );

  router.put(
    '/budgets',
    wrap(async (req, res) => {
      const { categoryId, month, amount } = req.body || {};
      res.json(
        await upsertBudget({
          categoryId,
          month: month || currentMonth(),
          amount,
        }),
      );
    }),
  );

  router.delete(
    '/budgets/:id',
    wrap(async (req, res) => {
      res.json(await deleteBudget(idParam(req)));
    }),
  );

  router.post(
    '/budgets/copy',
    wrap(async (req, res) => {
      const { from, to } = req.body || {};
      res.json(await copyBudgets(from, to));
    }),
  );

  router.post(
    '/settings/default-account',
    wrap(async (req, res) => {
      const accountId = Number(req.body?.accountId);
      const accounts = await listAccounts();
      if (!accounts.some((a) => a.id === accountId)) throw badRequest('Dompet tidak ditemukan');
      await setDefaultAccountId(accountId);
      res.json({ ok: true, defaultAccountId: accountId });
    }),
  );

  router.get(
    '/settings',
    wrap(async (req, res) => {
      res.json({ defaultAccountId: await getDefaultAccountId() });
    }),
  );

  router.get(
    '/bot/status',
    wrap(async (req, res) => {
      const bot = getBot();
      const ownerChatId = await getOwnerChatId();
      const storedToken = await getStoredBotToken().catch(() => null);
      res.json({
        enabled: Boolean(bot),
        running: Boolean(bot),
        hasStoredToken: Boolean(storedToken),
        source: getBotSource(),
        username: bot?.botInfo?.username || null,
        connected: Boolean(ownerChatId),
        ownerChatId: ownerChatId ? maskChatId(ownerChatId) : null,
        mode: config.publicUrl ? 'webhook' : 'polling',
      });
    }),
  );

  router.post(
    '/bot/token',
    wrap(async (req, res) => {
      const token = String(req.body?.token || '').trim();
      if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
        throw badRequest(
          'Format token tidak valid. Salin ulang dari @BotFather (contoh: 123456789:AA...).',
        );
      }
      const bot = await connectBot(token, { source: 'dashboard' });
      await setStoredBotToken(token);
      res.json({
        ok: true,
        username: bot.botInfo?.username || null,
        mode: config.publicUrl ? 'webhook' : 'polling',
      });
    }),
  );

  router.post(
    '/bot/test',
    wrap(async (req, res) => {
      const bot = getBot();
      if (!bot) throw new AppError('Bot belum aktif. Tempel token bot di Pengaturan.', 503);
      const ownerChatId = await getOwnerChatId();
      if (!ownerChatId) throw badRequest('Bot belum terhubung. Buka Telegram lalu kirim /start ke bot kamu.');
      await bot.telegram.sendMessage(
        ownerChatId,
        '✅ <b>Uji koneksi berhasil!</b>\nDashboard Dompetku terhubung ke bot ini.',
        { parse_mode: 'HTML' },
      );
      res.json({ ok: true });
    }),
  );

  router.post(
    '/bot/disconnect',
    wrap(async (req, res) => {
      await deleteSetting('owner_chat_id');
      await deleteSetting('allowed_chat_ids');
      res.json({ ok: true });
    }),
  );

  router.get(
    '/report/month',
    wrap(async (req, res) => {
      res.json(await monthSummary(monthQuery(req)));
    }),
  );

  router.get(
    '/export/csv',
    wrap(async (req, res) => {
      const rows = await allTransactions(exportRange(req));
      const csv = transactionsToCsv(rows);
      res
        .type('text/csv; charset=utf-8')
        .setHeader('Content-Disposition', `attachment; filename="${filenameFor('csv')}"`)
        .send(`\ufeff${csv}`);
    }),
  );

  router.get(
    '/export/xlsx',
    wrap(async (req, res) => {
      const range = exportRange(req);
      const rows = await allTransactions(range);
      const buffer = await transactionsToXlsx(rows, range);
      res
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .setHeader('Content-Disposition', `attachment; filename="${filenameFor('xlsx')}"`)
        .send(buffer);
    }),
  );

  router.get(
    '/backup',
    wrap(async (req, res) => {
      const data = await backupJson();
      res
        .type('application/json')
        .setHeader('Content-Disposition', `attachment; filename="${filenameFor('json')}"`)
        .send(JSON.stringify(data, null, 2));
    }),
  );

  router.use((req, res, next) => next(notFound('Endpoint tidak ditemukan')));

  return router;
}
