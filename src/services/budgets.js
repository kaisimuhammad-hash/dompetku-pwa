import { db, toNumber } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { isValidMonth, monthBounds } from '../lib/format.js';
import { LIMITS } from '../config.js';

function mapBudget(row) {
  const limit = toNumber(row.amount);
  const spent = toNumber(row.spent);
  const percent = limit > 0 ? Math.round((spent / limit) * 100) : 0;
  return {
    id: toNumber(row.id),
    categoryId: toNumber(row.category_id),
    name: row.name,
    icon: row.icon,
    color: row.color,
    limit,
    spent,
    remaining: limit - spent,
    percent,
    status: percent >= 100 ? 'over' : percent >= 80 ? 'warning' : 'ok',
  };
}

export async function listBudgets(month) {
  if (!isValidMonth(month)) throw badRequest('Bulan tidak valid');
  const { start, end } = monthBounds(month);
  const { rows } = await db.query(
    `SELECT b.*, c.name, c.icon, c.color,
       COALESCE((
         SELECT SUM(t.amount) FROM transactions t
         WHERE t.kind = 'expense' AND t.category_id = b.category_id
           AND t.occurred_on >= $2 AND t.occurred_on < $3
       ), 0) AS spent
     FROM budgets b
     JOIN categories c ON c.id = b.category_id
     WHERE b.month = $1
     ORDER BY c.sort, c.id`,
    [month, start, end],
  );
  return rows.map(mapBudget);
}

export async function budgetSummary(month) {
  const budgets = await listBudgets(month);
  const totalLimit = budgets.reduce((acc, b) => acc + b.limit, 0);
  const totalSpent = budgets.reduce((acc, b) => acc + b.spent, 0);
  return {
    items: budgets,
    totalLimit,
    totalSpent,
    totalRemaining: totalLimit - totalSpent,
    percent: totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 100) : 0,
  };
}

export async function upsertBudget({ categoryId, month, amount }) {
  if (!isValidMonth(month)) throw badRequest('Bulan tidak valid');
  const id = Number(categoryId);
  const value = Math.round(Number(amount));
  if (!Number.isInteger(id)) throw badRequest('Kategori wajib dipilih');
  if (!Number.isFinite(value) || value <= 0) throw badRequest('Batas anggaran harus lebih dari 0');
  if (value > LIMITS.amount) throw badRequest('Batas anggaran terlalu besar');

  const category = await db.query('SELECT id, kind FROM categories WHERE id = $1', [id]);
  if (category.rows.length === 0) throw badRequest('Kategori tidak ditemukan');
  if (category.rows[0].kind !== 'expense') throw badRequest('Anggaran hanya untuk kategori pengeluaran');

  await db.query(
    `INSERT INTO budgets (category_id, month, amount) VALUES ($1, $2, $3)
     ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount`,
    [id, month, value],
  );

  const rows = await listBudgets(month);
  return rows.find((b) => b.categoryId === id);
}

export async function deleteBudget(id) {
  const { rows } = await db.query('DELETE FROM budgets WHERE id = $1 RETURNING id', [id]);
  if (rows.length === 0) throw notFound('Anggaran tidak ditemukan');
  return { ok: true };
}

export async function copyBudgets(fromMonth, toMonth) {
  if (!isValidMonth(fromMonth) || !isValidMonth(toMonth)) throw badRequest('Bulan tidak valid');
  if (fromMonth === toMonth) throw badRequest('Bulan asal dan tujuan harus berbeda');
  const { rows } = await db.query(
    `INSERT INTO budgets (category_id, month, amount)
     SELECT category_id, $2, amount FROM budgets WHERE month = $1
     ON CONFLICT (category_id, month) DO NOTHING
     RETURNING id`,
    [fromMonth, toMonth],
  );
  return { copied: rows.length };
}

export async function budgetAlert(categoryId, month) {
  if (!categoryId) return null;
  const budgets = await listBudgets(month);
  const budget = budgets.find((b) => b.categoryId === Number(categoryId));
  if (!budget) return null;
  if (budget.percent < 80) return null;
  return budget;
}
