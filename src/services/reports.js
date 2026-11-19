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

export async function monthSummary(month = currentMonth(), accountId = null) {
  assertMonth(month);
  const { start, end } = monthBounds(month);
  const params = [start, end];
  let filter = '';
  if (accountId) {
    params.push(Number(accountId));
    filter = ' AND account_id = $3';
  }
  const { rows } = await db.query(
    `SELECT kind, COALESCE(SUM(amount), 0) AS total, count(*)::int AS count
     FROM transactions
     WHERE occurred_on >= $1 AND occurred_on < $2 AND kind IN ('expense', 'income')${filter}
     GROUP BY kind`,
    params,
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

export async function dailySeries(month = currentMonth(), accountId = null) {
  assertMonth(month);
  const { start, end } = monthBounds(month);
  const params = [start, end];
  let filter = '';
  if (accountId) {
    params.push(Number(accountId));
    filter = ' AND account_id = $3';
  }
  const { rows } = await db.query(
    `SELECT occurred_on, kind, COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE occurred_on >= $1 AND occurred_on < $2 AND kind IN ('expense', 'income')${filter}
     GROUP BY occurred_on, kind`,
    params,
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

export async function categoryBreakdown(month = currentMonth(), kind = 'expense', accountId = null) {
  assertMonth(month);
  const { start, end } = monthBounds(month);
  const params = [start, end, kind];
  let filter = '';
  if (accountId) {
    params.push(Number(accountId));
    filter = ' AND t.account_id = $4';
  }
  const { rows } = await db.query(
    `SELECT t.category_id, c.name, c.icon, c.color,
            COALESCE(SUM(t.amount), 0) AS total, count(*)::int AS count
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.kind = $3 AND t.occurred_on >= $1 AND t.occurred_on < $2${filter}
     GROUP BY t.category_id, c.name, c.icon, c.color
     ORDER BY total DESC`,
    params,
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

export async function overview(month = currentMonth(), accountId = null) {
  assertMonth(month);
  const previousMonth = shiftMonth(month, -1);
  const [summary, previous, daily, categories, previousCategories, budgets, accounts, balance, recent] =
    await Promise.all([
      monthSummary(month, accountId),
      monthSummary(previousMonth, accountId),
      dailySeries(month, accountId),
      categoryBreakdown(month, 'expense', accountId),
      categoryBreakdown(previousMonth, 'expense', accountId),
      listBudgets(month),
      listAccounts(),
      totalBalance(),
      listTransactions({ limit: 8, accountId: accountId || undefined }),
    ]);

  const change = (current, prev) => {
    if (!prev) return current > 0 ? 100 : 0;
    return Math.round(((current - prev) / prev) * 100);
  };

  const totalLimit = budgets.reduce((acc, b) => acc + b.limit, 0);
  const totalSpent = budgets.reduce((acc, b) => acc + b.spent, 0);

  // 50/30/20 Budgeting Rule mapping
  const isNeeds = (name) =>
    /makan|minum|tagihan|utilitas|listrik|air|pdam|internet|wifi|sewa|kos|rumah|transport|bensin|bbm|kesehatan|obat|dokter|pendidikan|buku|sekolah|kuliah|popok|pokok|belanja bulanan/i.test(
      name,
    );
  const isSavings = (name) =>
    /investasi|tabungan|reksadana|saham|crypto|darurat|deposito|rutin/i.test(name);

  let needsSpent = 0;
  let wantsSpent = 0;
  let savingsAllocated = 0;

  for (const cat of categories) {
    if (isSavings(cat.name)) {
      savingsAllocated += cat.amount;
      cat.budgetGroup = 'savings';
    } else if (isNeeds(cat.name)) {
      needsSpent += cat.amount;
      cat.budgetGroup = 'needs';
    } else {
      wantsSpent += cat.amount;
      cat.budgetGroup = 'wants';
    }
  }

  const targetNeeds = Math.round(summary.income * 0.5);
  const targetWants = Math.round(summary.income * 0.3);
  const targetSavings = Math.round(summary.income * 0.2);

  const budget503020 = {
    income: summary.income,
    needs: {
      target: targetNeeds,
      spent: needsSpent,
      remaining: targetNeeds - needsSpent,
      percent: targetNeeds > 0 ? Math.round((needsSpent / targetNeeds) * 100) : 0,
    },
    wants: {
      target: targetWants,
      spent: wantsSpent,
      remaining: targetWants - wantsSpent,
      percent: targetWants > 0 ? Math.round((wantsSpent / targetWants) * 100) : 0,
    },
    savings: {
      target: targetSavings,
      allocated: savingsAllocated,
      remaining: targetSavings - savingsAllocated,
      percent: targetSavings > 0 ? Math.round((savingsAllocated / targetSavings) * 100) : 0,
    },
  };

  // Compare Bulan ini vs Bulan Lalu per category
  const prevCatMap = new Map(previousCategories.map((c) => [c.name, c.amount]));
  const allCategoryNames = Array.from(
    new Set([...categories.map((c) => c.name), ...previousCategories.map((c) => c.name)]),
  );

  const categoriesComparison = [];
  for (const name of allCategoryNames) {
    const cur = categories.find((c) => c.name === name);
    const prevAmount = prevCatMap.get(name) || 0;
    const curAmount = cur ? cur.amount : 0;
    if (curAmount === 0 && prevAmount === 0) continue;

    let pctChange = 0;
    if (prevAmount === 0) {
      pctChange = curAmount > 0 ? 100 : 0;
    } else {
      pctChange = Math.round(((curAmount - prevAmount) / prevAmount) * 100);
    }

    categoriesComparison.push({
      name,
      icon: cur?.icon || 'tag',
      color: cur?.color || '#94a3b8',
      currentAmount: curAmount,
      previousAmount: prevAmount,
      diff: curAmount - prevAmount,
      percentChange: pctChange,
    });
  }
  categoriesComparison.sort((a, b) => b.currentAmount - a.currentAmount);

  // Mini Report Narrative
  let miniReport = '';
  const diffNet = summary.net - previous.net;
  const netChangePct =
    previous.net !== 0
      ? Math.round(((summary.net - previous.net) / Math.abs(previous.net)) * 100)
      : 0;

  if (diffNet < 0) {
    miniReport = `Hmm, sisa uangmu Rp ${Math.abs(summary.net).toLocaleString('id-ID')} lebih sedikit Rp ${Math.abs(diffNet).toLocaleString('id-ID')} dari bulan lalu, turun sekitar ${netChangePct}%. Ada pengeluaran tak terduga atau perlu evaluasi budget?`;
  } else if (diffNet > 0) {
    miniReport = `Bagus sekali! Sisa uangmu Rp ${summary.net.toLocaleString('id-ID')} meningkat Rp ${diffNet.toLocaleString('id-ID')} (+${netChangePct}%) dari bulan lalu. Pertahankan pola pengeluaran sehat ini!`;
  } else {
    miniReport = `Sisa uangmu bulan ini seimbang dengan bulan lalu sebesar Rp ${summary.net.toLocaleString('id-ID')}. Kondisi keuanganmu stabil!`;
  }

  return {
    month,
    previousMonth,
    selectedAccountId: accountId ? Number(accountId) : null,
    totalBalance: balance,
    accounts,
    summary,
    previous: {
      income: previous.income,
      expense: previous.expense,
      net: previous.net,
      count: previous.count,
    },
    expenseChange: change(summary.expense, previous.expense),
    incomeChange: change(summary.income, previous.income),
    netChange: change(summary.net, previous.net),
    countChange: change(summary.count, previous.count),
    daily,
    categories,
    categoriesComparison,
    budget503020,
    miniReport,
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
