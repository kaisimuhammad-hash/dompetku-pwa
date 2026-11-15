import { db, toNumber } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getDefaultAccountId, setDefaultAccountId } from './settings.js';
import { LIMITS } from '../config.js';

const TYPES = new Set(['cash', 'bank', 'ewallet', 'other']);

const BALANCE_SQL = `
  a.initial_balance
  + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.kind = 'income' AND t.account_id = a.id), 0)
  - COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.kind = 'expense' AND t.account_id = a.id), 0)
  + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.kind = 'transfer' AND t.to_account_id = a.id), 0)
  - COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.kind = 'transfer' AND t.account_id = a.id), 0)
`;

function mapAccount(row) {
  return {
    id: toNumber(row.id),
    name: row.name,
    type: row.type,
    initialBalance: toNumber(row.initial_balance),
    balance: toNumber(row.balance),
    color: row.color,
    icon: row.icon,
    archived: row.archived,
    sort: toNumber(row.sort),
    isDefault: Boolean(row.is_default),
  };
}

export async function listAccounts({ includeArchived = false } = {}) {
  const defaultId = await getDefaultAccountId();
  const { rows } = await db.query(
    `SELECT a.*, ${BALANCE_SQL} AS balance
     FROM accounts a
     ${includeArchived ? '' : 'WHERE a.archived = FALSE'}
     ORDER BY a.archived, a.sort, a.id`,
  );
  return rows.map((row) => mapAccount({ ...row, is_default: toNumber(row.id) === defaultId }));
}

export async function getAccount(id) {
  const { rows } = await db.query(
    `SELECT a.*, ${BALANCE_SQL} AS balance FROM accounts a WHERE a.id = $1`,
    [id],
  );
  return rows.length > 0 ? mapAccount(rows[0]) : null;
}

export async function totalBalance() {
  const { rows } = await db.query(`SELECT COALESCE(SUM(${BALANCE_SQL}), 0) AS total FROM accounts a`);
  return toNumber(rows[0].total);
}

function normalizeAccountInput(input, existing = {}) {
  const name = String(input.name ?? existing.name ?? '').trim();
  if (!name) throw badRequest('Nama dompet wajib diisi');
  if (name.length > LIMITS.name) throw badRequest(`Nama dompet maksimal ${LIMITS.name} karakter`);

  const type = String(input.type ?? existing.type ?? 'cash');
  if (!TYPES.has(type)) throw badRequest('Jenis dompet tidak valid');

  const initial = input.initialBalance ?? input.initial_balance ?? existing.initial_balance ?? 0;
  const initialBalance = Math.round(Number(initial));
  if (!Number.isFinite(initialBalance) || Math.abs(initialBalance) > LIMITS.amount) {
    throw badRequest('Saldo awal tidak valid');
  }

  const color = String(input.color ?? existing.color ?? '#0f9d76');
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw badRequest('Warna tidak valid');

  const icon = String(input.icon ?? existing.icon ?? 'wallet');
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(icon)) throw badRequest('Ikon dompet tidak valid');

  return { name, type, initialBalance, color, icon };
}

export async function createAccount(input) {
  const data = normalizeAccountInput(input);
  const { rows } = await db.query(
    `INSERT INTO accounts (name, type, initial_balance, color, icon, sort)
     VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(sort), 0) + 1 FROM accounts))
     RETURNING id`,
    [data.name, data.type, data.initialBalance, data.color, data.icon],
  );
  const defaultId = await getDefaultAccountId();
  if (!defaultId) await setDefaultAccountId(rows[0].id);
  return getAccount(rows[0].id);
}

export async function updateAccount(id, input) {
  const current = await getAccount(id);
  if (!current) throw notFound('Dompet tidak ditemukan');
  const name = String(input.name ?? current.name).trim();
  const type = String(input.type ?? current.type);
  if (!name) throw badRequest('Nama dompet wajib diisi');
  if (name.length > LIMITS.name) throw badRequest(`Nama dompet maksimal ${LIMITS.name} karakter`);
  if (!TYPES.has(type)) throw badRequest('Jenis dompet tidak valid');

  const initialBalance =
    input.initialBalance !== undefined
      ? Math.round(Number(input.initialBalance))
      : input.initial_balance !== undefined
        ? Math.round(Number(input.initial_balance))
        : current.initialBalance;
  if (!Number.isFinite(initialBalance)) throw badRequest('Saldo awal tidak valid');

  const color = String(input.color ?? current.color);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw badRequest('Warna tidak valid');

  const icon = String(input.icon ?? current.icon);
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(icon)) throw badRequest('Ikon dompet tidak valid');
  const archived = input.archived !== undefined ? Boolean(input.archived) : current.archived;

  await db.query(
    `UPDATE accounts SET name = $1, type = $2, initial_balance = $3, color = $4, icon = $5, archived = $6
     WHERE id = $7`,
    [name, type, initialBalance, color, icon, archived, id],
  );
  return getAccount(id);
}

export async function archiveAccount(id) {
  const account = await getAccount(id);
  if (!account) throw notFound('Dompet tidak ditemukan');
  await db.query('UPDATE accounts SET archived = TRUE WHERE id = $1', [id]);
  const defaultId = await getDefaultAccountId();
  if (defaultId === Number(id)) {
    const { rows } = await db.query(
      'SELECT id FROM accounts WHERE archived = FALSE ORDER BY sort, id LIMIT 1',
    );
    await setDefaultAccountId(rows.length > 0 ? rows[0].id : null);
  }
  return { ok: true };
}

export async function restoreAccount(id) {
  const account = await getAccount(id);
  if (!account) throw notFound('Dompet tidak ditemukan');
  await db.query('UPDATE accounts SET archived = FALSE WHERE id = $1', [id]);
  return getAccount(id);
}
