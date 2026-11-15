import { db, rowToTransaction } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { isValidDate, monthBounds, todayISO } from '../lib/format.js';
import { LIMITS } from '../config.js';

const KINDS = new Set(['expense', 'income', 'transfer']);

const SELECT_TRANSACTION = `
  SELECT t.*, a.name AS account_name, a.icon AS account_icon,
         ta.name AS to_account_name,
         c.name AS category_name, c.icon AS category_icon, c.color AS category_color
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts ta ON ta.id = t.to_account_id
  LEFT JOIN categories c ON c.id = t.category_id
`;

function normalizeAmount(value) {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Jumlah harus lebih dari 0');
  if (amount > LIMITS.amount) throw badRequest('Jumlah terlalu besar');
  return amount;
}

function normalizeNote(value) {
  return String(value || '').trim().slice(0, LIMITS.note);
}

async function validateReferences({ kind, accountId, toAccountId, categoryId }) {
  if (!KINDS.has(kind)) throw badRequest('Jenis transaksi tidak valid');

  const account = await db.query('SELECT id, archived FROM accounts WHERE id = $1', [accountId]);
  if (account.rows.length === 0) throw badRequest('Dompet tidak ditemukan');
  if (account.rows[0].archived) throw badRequest('Dompet sudah diarsipkan');

  if (kind === 'transfer') {
    if (!toAccountId) throw badRequest('Dompet tujuan wajib dipilih');
    if (Number(toAccountId) === Number(accountId)) throw badRequest('Dompet asal dan tujuan harus berbeda');
    const target = await db.query('SELECT id FROM accounts WHERE id = $1', [toAccountId]);
    if (target.rows.length === 0) throw badRequest('Dompet tujuan tidak ditemukan');
  }

  if (kind !== 'transfer' && categoryId) {
    const category = await db.query('SELECT id, kind FROM categories WHERE id = $1', [categoryId]);
    if (category.rows.length === 0) throw badRequest('Kategori tidak ditemukan');
    if (category.rows[0].kind !== kind) throw badRequest('Kategori tidak sesuai dengan jenis transaksi');
  }
}

export async function createTransaction(input, { source = 'web' } = {}) {
  const kind = String(input.kind || 'expense');
  const amount = normalizeAmount(input.amount);
  const accountId = Number(input.accountId ?? input.account_id);
  if (!Number.isInteger(accountId)) throw badRequest('Dompet wajib dipilih');
  const toAccountId = kind === 'transfer' ? Number(input.toAccountId ?? input.to_account_id) : null;
  const categoryId =
    kind === 'transfer' ? null : Number(input.categoryId ?? input.category_id) || null;

  const occurredOn = input.occurredOn || input.occurred_on || todayISO();
  if (!isValidDate(occurredOn)) throw badRequest('Tanggal tidak valid');

  await validateReferences({ kind, accountId, toAccountId, categoryId });

  const { rows } = await db.query(
    `INSERT INTO transactions (kind, amount, account_id, to_account_id, category_id, note, occurred_on, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [kind, amount, accountId, toAccountId, categoryId, normalizeNote(input.note), occurredOn, source],
  );
  return getTransaction(rows[0].id);
}

export async function getTransaction(id) {
  const { rows } = await db.query(`${SELECT_TRANSACTION} WHERE t.id = $1`, [id]);
  return rows.length > 0 ? rowToTransaction(rows[0]) : null;
}

export async function updateTransaction(id, input) {
  const current = await getTransaction(id);
  if (!current) throw notFound('Transaksi tidak ditemukan');

  const kind = String(input.kind ?? current.kind);
  const amount = input.amount !== undefined ? normalizeAmount(input.amount) : current.amount;
  const accountId = Number(input.accountId ?? input.account_id ?? current.accountId);
  const toAccountId =
    kind === 'transfer' ? Number(input.toAccountId ?? input.to_account_id ?? current.toAccountId) : null;
  const categoryInput = input.categoryId ?? input.category_id;
  const categoryId =
    kind === 'transfer' ? null : categoryInput !== undefined ? Number(categoryInput) || null : current.categoryId;
  const note = input.note !== undefined ? normalizeNote(input.note) : current.note;
  const occurredOn = input.occurredOn || input.occurred_on || current.occurredOn;
  if (!isValidDate(occurredOn)) throw badRequest('Tanggal tidak valid');

  await validateReferences({ kind, accountId, toAccountId, categoryId });

  await db.query(
    `UPDATE transactions
     SET kind = $1, amount = $2, account_id = $3, to_account_id = $4, category_id = $5, note = $6, occurred_on = $7
     WHERE id = $8`,
    [kind, amount, accountId, toAccountId, categoryId, note, occurredOn, id],
  );
  return getTransaction(id);
}

export async function deleteTransaction(id) {
  const current = await getTransaction(id);
  if (!current) throw notFound('Transaksi tidak ditemukan');
  await db.query('DELETE FROM transactions WHERE id = $1', [id]);
  return current;
}

function buildFilters(filters) {
  const params = [];
  const where = [];

  if (filters.month) {
    const { start, end } = monthBounds(filters.month);
    params.push(start, end);
    where.push(`t.occurred_on >= $${params.length - 1} AND t.occurred_on < $${params.length}`);
  } else {
    if (filters.from) {
      params.push(filters.from);
      where.push(`t.occurred_on >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      where.push(`t.occurred_on <= $${params.length}`);
    }
  }

  if (filters.accountId) {
    params.push(Number(filters.accountId));
    where.push(`(t.account_id = $${params.length} OR t.to_account_id = $${params.length})`);
  }
  if (filters.categoryId) {
    params.push(Number(filters.categoryId));
    where.push(`t.category_id = $${params.length}`);
  }
  if (filters.kind && KINDS.has(filters.kind)) {
    params.push(filters.kind);
    where.push(`t.kind = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${String(filters.q).trim()}%`);
    where.push(`(t.note ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
  }

  return { params, where };
}

export async function listTransactions(filters = {}) {
  const { params, where } = buildFilters(filters);
  const limit = Math.min(Math.max(Number(filters.limit) || 60, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  params.push(limit, offset);

  const { rows } = await db.query(
    `${SELECT_TRANSACTION}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.occurred_on DESC, t.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map(rowToTransaction);
}

export async function countTransactions(filters = {}) {
  const { params, where } = buildFilters(filters);
  const { rows } = await db.query(
    `SELECT count(*)::int AS c FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    params,
  );
  return rows[0].c;
}
