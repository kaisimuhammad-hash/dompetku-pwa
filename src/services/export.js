import ExcelJS from 'exceljs';
import { db, rowToTransaction } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { isValidDate, formatDateID } from '../lib/format.js';

const KIND_LABEL = { expense: 'Pengeluaran', income: 'Pemasukan', transfer: 'Transfer' };

export async function allTransactions({ from, to } = {}) {
  if (from && !isValidDate(from)) throw badRequest('Tanggal awal tidak valid');
  if (to && !isValidDate(to)) throw badRequest('Tanggal akhir tidak valid');
  const params = [];
  const where = [];
  if (from) {
    params.push(from);
    where.push(`t.occurred_on >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`t.occurred_on <= $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT t.*, a.name AS account_name, a.icon AS account_icon,
            ta.name AS to_account_name,
            c.name AS category_name, c.icon AS category_icon, c.color AS category_color
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN accounts ta ON ta.id = t.to_account_id
     LEFT JOIN categories c ON c.id = t.category_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.occurred_on ASC, t.id ASC`,
    params,
  );
  return rows.map(rowToTransaction);
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function transactionsToCsv(rows) {
  const header = ['Tanggal', 'Jenis', 'Dompet', 'Dompet Tujuan', 'Kategori', 'Catatan', 'Jumlah'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.occurredOn,
        KIND_LABEL[row.kind] || row.kind,
        row.accountName || '',
        row.toAccountName || '',
        row.categoryName || '',
        row.note || '',
        row.amount,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n');
}

export async function transactionsToXlsx(rows, { from, to } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Dompetku';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Transaksi', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = [
    { header: 'Tanggal', key: 'date', width: 14 },
    { header: 'Jenis', key: 'kind', width: 14 },
    { header: 'Dompet', key: 'account', width: 18 },
    { header: 'Dompet Tujuan', key: 'toAccount', width: 16 },
    { header: 'Kategori', key: 'category', width: 22 },
    { header: 'Catatan', key: 'note', width: 34 },
    { header: 'Jumlah', key: 'amount', width: 18 },
    { header: 'Sumber', key: 'source', width: 12 },
  ];

  for (const row of rows) {
    sheet.addRow({
      date: row.occurredOn,
      kind: KIND_LABEL[row.kind] || row.kind,
      account: row.accountName || '',
      toAccount: row.toAccountName || '',
      category: row.categoryName || '',
      note: row.note || '',
      amount: row.amount,
      source: row.source === 'telegram' ? 'Telegram' : 'Dashboard',
    });
  }

  sheet.getColumn('amount').numFmt = '"Rp" #,##0';
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F9D76' },
  };
  sheet.getRow(1).height = 24;
  sheet.getRow(1).alignment = { vertical: 'middle' };
  sheet.autoFilter = { from: 'A1', to: 'H1' };
  sheet.eachRow((row, index) => {
    if (index > 1) row.alignment = { vertical: 'top' };
  });

  const summary = workbook.addWorksheet('Ringkasan');
  summary.columns = [
    { header: 'Kategori', key: 'category', width: 26 },
    { header: 'Jenis', key: 'kind', width: 16 },
    { header: 'Total', key: 'total', width: 18 },
    { header: 'Transaksi', key: 'count', width: 12 },
  ];
  const grouped = new Map();
  for (const row of rows) {
    if (row.kind === 'transfer') continue;
    const key = `${row.kind}:${row.categoryName || 'Tanpa kategori'}`;
    const entry = grouped.get(key) || {
      category: row.categoryName || 'Tanpa kategori',
      kind: KIND_LABEL[row.kind],
      total: 0,
      count: 0,
    };
    entry.total += row.amount;
    entry.count += 1;
    grouped.set(key, entry);
  }
  for (const entry of [...grouped.values()].sort((a, b) => b.total - a.total)) {
    summary.addRow(entry);
  }
  summary.getColumn('total').numFmt = '"Rp" #,##0';
  summary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summary.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F9D76' },
  };

  if (from || to) {
    summary.addRow([]);
    summary.addRow({
      category: `Periode: ${from ? formatDateID(from) : 'awal'} – ${to ? formatDateID(to) : 'akhir'}`,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function backupJson() {
  const [accounts, categories, transactions, budgets] = await Promise.all([
    db.query('SELECT * FROM accounts ORDER BY id'),
    db.query('SELECT * FROM categories ORDER BY id'),
    db.query('SELECT * FROM transactions ORDER BY id'),
    db.query('SELECT * FROM budgets ORDER BY id'),
  ]);
  return {
    app: 'Dompetku',
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts: accounts.rows,
    categories: categories.rows,
    transactions: transactions.rows,
    budgets: budgets.rows,
  };
}
