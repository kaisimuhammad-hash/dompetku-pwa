import { db, initDb } from '../src/db/index.js';
import { ensureSeed } from '../src/db/seed.js';
import { currentMonth, daysInMonth, shiftMonth, todayISO } from '../src/lib/format.js';
import { upsertBudget } from '../src/services/budgets.js';
import { createTransaction } from '../src/services/transactions.js';

const TEMPLATE = [
  { day: 2, kind: 'expense', amount: 28000, category: 'Makan & Minum', note: 'sarapan bubur', account: 'Tunai' },
  { day: 3, kind: 'expense', amount: 22000, category: 'Transportasi', note: 'ojol ke kantor', account: 'E-Wallet' },
  { day: 4, kind: 'expense', amount: 85000, category: 'Belanja', note: 'belanja mingguan', account: 'Rekening' },
  { day: 5, kind: 'transfer', amount: 750000, note: 'isi saldo e-wallet', account: 'Rekening', toAccount: 'E-Wallet' },
  { day: 6, kind: 'expense', amount: 45000, category: 'Makan & Minum', note: 'makan siang tim', account: 'E-Wallet' },
  { day: 8, kind: 'expense', amount: 350000, category: 'Tagihan & Utilitas', note: 'token listrik', account: 'Rekening' },
  { day: 9, kind: 'expense', amount: 60000, category: 'Transportasi', note: 'bensin', account: 'Tunai' },
  { day: 11, kind: 'expense', amount: 25000, category: 'Makan & Minum', note: 'kopi pagi', account: 'E-Wallet' },
  { day: 12, kind: 'expense', amount: 149000, category: 'Hiburan', note: 'langganan streaming', account: 'Rekening' },
  { day: 13, kind: 'expense', amount: 72000, category: 'Rumah Tangga', note: 'sabun dan galon', account: 'Tunai' },
  { day: 15, kind: 'expense', amount: 185000, category: 'Belanja', note: 'skincare', account: 'E-Wallet' },
  { day: 16, kind: 'expense', amount: 32000, category: 'Makan & Minum', note: 'makan malam', account: 'Tunai' },
  { day: 18, kind: 'expense', amount: 120000, category: 'Kesehatan', note: 'vitamin bulanan', account: 'Rekening' },
  { day: 20, kind: 'expense', amount: 40000, category: 'Transportasi', note: 'parkir dan tol', account: 'Tunai' },
  { day: 21, kind: 'transfer', amount: 300000, note: 'tarik tunai', account: 'Rekening', toAccount: 'Tunai' },
  { day: 22, kind: 'expense', amount: 95000, category: 'Makan & Minum', note: 'makan bareng teman', account: 'E-Wallet' },
  { day: 24, kind: 'expense', amount: 210000, category: 'Pendidikan', note: 'buku dan kursus', account: 'Rekening' },
  { day: 26, kind: 'expense', amount: 65000, category: 'Tagihan & Utilitas', note: 'paket data', account: 'E-Wallet' },
  { day: 27, kind: 'expense', amount: 48000, category: 'Makan & Minum', note: 'beli buah', account: 'Tunai' },
];

const INCOMES = [
  { day: 1, amount: 8500000, category: 'Gaji', note: 'gaji bulanan', account: 'Rekening' },
  { day: 15, amount: 750000, category: 'Bonus & Tunjangan', note: 'insentif proyek', account: 'Rekening' },
  { day: 25, amount: 125000, category: 'Investasi', note: 'dividen reksadana', account: 'Rekening' },
];

const BUDGETS = [
  { category: 'Makan & Minum', amount: 1500000 },
  { category: 'Transportasi', amount: 500000 },
  { category: 'Belanja', amount: 750000 },
  { category: 'Tagihan & Utilitas', amount: 900000 },
  { category: 'Hiburan', amount: 300000 },
];

function isoFor(month, day) {
  const maxDay = daysInMonth(month);
  return `${month}-${String(Math.min(day, maxDay)).padStart(2, '0')}`;
}

async function main() {
  await initDb();
  await ensureSeed();

  const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM transactions');
  if (Number(rows[0].count) > 0) {
    console.log('[seed:demo] Database sudah berisi transaksi. Demo tidak dimasukkan agar datamu aman.');
    return;
  }

  const accounts = (await db.query('SELECT id, name FROM accounts')).rows;
  const categories = (await db.query('SELECT id, name, kind FROM categories')).rows;
  const accountId = (name) => accounts.find((item) => item.name === name)?.id;
  const categoryId = (name) => categories.find((item) => item.name === name)?.id;

  await db.query('UPDATE accounts SET initial_balance = $1 WHERE name = $2', [650000, 'Tunai']);
  await db.query('UPDATE accounts SET initial_balance = $1 WHERE name = $2', [12500000, 'Rekening']);
  await db.query('UPDATE accounts SET initial_balance = $1 WHERE name = $2', [450000, 'E-Wallet']);

  const today = todayISO();
  const months = [shiftMonth(currentMonth(), -1), currentMonth()];
  const todayDay = Number(today.slice(8, 10));
  let created = 0;

  for (const [index, month] of months.entries()) {
    const thisMonth = index === 1;
    for (const entry of INCOMES) {
      if (thisMonth && entry.day > todayDay) continue;
      await createTransaction(
        {
          kind: 'income',
          amount: entry.amount,
          accountId: accountId(entry.account),
          categoryId: categoryId(entry.category),
          note: entry.note,
          occurredOn: isoFor(month, entry.day),
        },
        { source: 'telegram' },
      );
      created += 1;
    }

    for (const entry of TEMPLATE) {
      if (thisMonth && entry.day > todayDay) continue;
      const payload = {
        kind: entry.kind,
        amount: thisMonth ? entry.amount : Math.round(entry.amount * 0.92),
        accountId: accountId(entry.account),
        note: entry.note,
        occurredOn: isoFor(month, entry.day),
      };
      if (entry.kind === 'transfer') payload.toAccountId = accountId(entry.toAccount);
      else payload.categoryId = categoryId(entry.category);
      await createTransaction(payload, { source: thisMonth ? 'web' : 'telegram' });
      created += 1;
    }
  }

  for (const budget of BUDGETS) {
    await upsertBudget({
      categoryId: categoryId(budget.category),
      month: currentMonth(),
      amount: budget.amount,
    });
  }

  console.log(`[seed:demo] ${created} transaksi contoh dan ${BUDGETS.length} anggaran dibuat.`);
}

main().catch((error) => {
  console.error('[seed:demo] gagal:', error.message);
  process.exit(1);
});
