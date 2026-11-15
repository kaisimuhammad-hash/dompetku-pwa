import { db, toNumber } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import {
  currentMonth,
  daysInMonth,
  isValidMonth,
  monthBounds,
  shiftMonth,
} from '../lib/format.js';
import { listBudgets } from './budgets.js';
import { listAccounts, totalBalance } from './accounts.js';
import { listTransactions } from './transactions.js';

function dateString(value) {
  if (value instanceof Date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  }
  return String(value).slice(0, 10);
}

function assertMonth(month) {
  if (!isValidMonth(month)) throw badRequest('Format bulan harus YYYY-MM');
}

export async function monthSummary(month = currentMonth()) {
  assertMonth(month);
  const { start, end } = monthBounds(month);
  const { rows } = await db.query(
    `SELECT kind, COALESCE(SUM(amount), 0) AS total, count(*)::int AS count
     FROM transactions
     WHERE occurred_on >= $1 AND occurred_on < $2 AND kind IN ('expense', 'income')
     GROUP BY kind`,
    [start, end],
  );
  let income = 0;
  let expense = 0;
  let count = 0;
  for (const row of rows) {
    if (row.kind === 'income') income = toNumber(row.total);
    if (row.kind === 'expense') expense = toNumber(row.total);
    count += Number(row.count);
  }
  return {
    month,
    income,
    expense,
    net: income - expense,
    count,
    savingsRate: income > 0 ? Math.round(((income - expense) / income) * 100) : 0,
  };
}

export async function dailySeries(month = currentMonth()) {
  assertMonth(month);
  const { start, end } = monthBounds(month);
  const { rows } = await db.query(
    `SELECT occurred_on, kind, COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE occurred_on >= $1 AND occurred_on < $2 AND kind IN ('expense', 'income')
     GROUP BY occurred_on, kind`,
    [start, end],
  );
  const total = daysInMonth(month);
  const days = Array.from({ length: total }, (_, i) => ({
    day: i + 1,
    date: `${month}-${String(i + 1).padStart(2, '0')}`,
    income: 0,
    expense: 0,
  }));
  for (const row of rows) {
    const key = dateString(row.occurred_on);
    const day = Number(key.slice(8, 10));
    const entry = days[day - 1];
    if (!entry) continue;
    if (row.kind === 'income') entry.income = toNumber(row.total);
    if (row.kind === 'expense') entry.expense = toNumber(row.total);
  }
  return days;
}

export async function categoryBreakdown(month = currentMonth(), kind = 'expense') {
  assertMonth(month);
  const { start, end } = monthBounds(month);
  const { rows } = await db.query(
    `SELECT t.category_id, c.name, c.icon, c.color,
            COALESCE(SUM(t.amount), 0) AS total, count(*)::int AS count
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.kind = $3 AND t.occurred_on >= $1 AND t.occurred_on < $2
     GROUP BY t.category_id, c.name, c.icon, c.color
     ORDER BY total DESC`,
    [start, end, kind],
  );
  const total = rows.reduce((acc, row) => acc + toNumber(row.total), 0);
  return rows.map((row) => {
    const amount = toNumber(row.total);
    return {
      categoryId: row.category_id === null ? null : toNumber(row.category_id),
      name: row.name || 'Tanpa kategori',
      icon: row.icon || 'box',
      color: row.color || '#94a3b8',
      amount,
      count: Number(row.count),
      percent: total > 0 ? Math.round((amount / total) * 100) : 0,
    };
  });
}

export async function overview(month = currentMonth()) {
  assertMonth(month);
  const previousMonth = shiftMonth(month, -1);
  const [summary, previous, daily, categories, budgets, accounts, balance, recent] = await Promise.all([
    monthSummary(month),
    monthSummary(previousMonth),
    dailySeries(month),
    categoryBreakdown(month, 'expense'),
    listBudgets(month),
    listAccounts(),
    totalBalance(),
    listTransactions({ limit: 6 }),
  ]);

  const change = (current, prev) => {
    if (!prev) return current > 0 ? 100 : null;
    return Math.round(((current - prev) / prev) * 100);
  };

  const totalLimit = budgets.reduce((acc, b) => acc + b.limit, 0);
  const totalSpent = budgets.reduce((acc, b) => acc + b.spent, 0);

  return {
    month,
    previousMonth,
    totalBalance: balance,
    accounts,
    summary,
    previous: { income: previous.income, expense: previous.expense },
    expenseChange: change(summary.expense, previous.expense),
    incomeChange: change(summary.income, previous.income),
    daily,
    categories,
    budgets: {
      items: budgets,
      totalLimit,
      totalSpent,
      percent: totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 100) : 0,
    },
    recent,
  };
}

export async function cashflowMonths(months = 6, endMonth = currentMonth()) {
  const list = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const month = shiftMonth(endMonth, -i);
    const summary = await monthSummary(month);
    list.push({ month, income: summary.income, expense: summary.expense, net: summary.net });
  }
  return list;
}
