import { isValidDate, shiftDate, todayISO } from './format.js';
import { matchCategory } from '../services/categories.js';

export class ParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ParseError';
  }
}

const UNIT_MULTIPLIER = {
  ribu: 1_000,
  rb: 1_000,
  k: 1_000,
  juta: 1_000_000,
  jt: 1_000_000,
  miliar: 1_000_000_000,
  milyar: 1_000_000_000,
};

const NUMBER_RE = /(?:rp\.?\s*)?(\d+(?:[.,]\d+)*)\s*(ribu|rb|juta|jt|miliar|milyar|k\b)?/gi;

const INCOME_RE =
  /\b(gaji|gajian|payroll|salary|upah|bonus|thr|tunjangan|komisi|insentif|masuk|terima|diterima|jual|refund|cashback|dividen|bunga|profit|hadiah|pendapatan|pemasukan)\b/i;
const TRANSFER_RE = /\b(transfer|pindah|mutasi)\b/i;
const EXPENSE_RE = /\b(pengeluaran|keluar|bayar|beli|belanja)\b/i;
const NOISE_WORDS_RE =
  /\b(transfer|pindah|mutasi|pengeluaran|pemasukan|keluar|masuk|untuk|buat|dari|ke|di|sebesar|seharga|rp)\b/gi;
const DATE_WORDS_RE = /\b(kemarin|hari ini|tadi|tanggal|tgl)\b/gi;

function splitNumberToken(token) {
  const hasComma = token.includes(',');
  const hasDot = token.includes('.');
  if (hasComma && hasDot) {
    return Number(token.replace(/\./g, '').replace(',', '.'));
  }
  if (hasComma) {
    const parts = token.split(',');
    if (parts.length === 2 && parts[1].length === 3) return Number(parts.join(''));
    return Number(token.replace(',', '.'));
  }
  if (hasDot) {
    const parts = token.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      return Number(parts.join(''));
    }
  }
  return Number(token.replace(/[.,]/g, ''));
}

export function findAmount(text) {
  const matches = [];
  let match;
  NUMBER_RE.lastIndex = 0;
  while ((match = NUMBER_RE.exec(text)) !== null) {
    const raw = match[1];
    const unit = (match[2] || '').toLowerCase();
    const value = splitNumberToken(raw);
    if (!Number.isFinite(value) || value <= 0) continue;
    const hasThousands = /[.,]\d{3}(\D|$)/.test(raw) && !/^\d+[.,]\d{1,2}$/.test(raw);
    const score =
      (unit ? 4 : 0) +
      (hasThousands ? 2 : 0) +
      (/rp/i.test(match[0]) ? 3 : 0) +
      Math.min(match.index + raw.length, 9999) / 100000;
    matches.push({
      value: Math.round(value * (UNIT_MULTIPLIER[unit] || 1)),
      start: match.index,
      end: match.index + match[0].length,
      score,
    });
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.score - a.score || b.value - a.value);
  return matches[0];
}

function detectAccount(text, accounts) {
  const haystack = ` ${text.toLowerCase()} `;
  const found = [];
  for (const account of accounts) {
    const name = String(account.name || '').toLowerCase().trim();
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
    const match = re.exec(haystack);
    if (match) {
      found.push({ account, index: match.index, length: match[0].length, name });
    }
  }
  found.sort((a, b) => a.index - b.index || b.length - a.length);
  return found.map((f) => f.account);
}

function detectDate(text, today) {
  const lower = text.toLowerCase();
  if (/\bkemarin lusa\b/.test(lower)) return shiftDate(today, -2);
  if (/\bkemarin\b/.test(lower)) return shiftDate(today, -1);
  const dayMatch = lower.match(/\b(?:tanggal|tgl)\s+(\d{1,2})\b/);
  if (dayMatch) {
    const day = Number(dayMatch[1]);
    const candidate = `${today.slice(0, 7)}-${String(day).padStart(2, '0')}`;
    if (isValidDate(candidate)) return candidate;
  }
  return today;
}

function cleanNote(text, amount, accounts, kind) {
  let note = text;
  if (amount) note = note.slice(0, amount.start) + ' ' + note.slice(amount.end);
  for (const account of accounts) {
    const escaped = String(account.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    note = note.replace(new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'gi'), ' ');
  }
  note = note
    .replace(DATE_WORDS_RE, ' ')
    .replace(NOISE_WORDS_RE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:!-]+|[\s,.;:!-]+$/g, '')
    .trim();
  if (kind === 'income' || kind === 'expense') {
    note = note.replace(/^(pengeluaran|pemasukan|keluar|masuk)\s+/i, '').trim();
  }
  return note.slice(0, 140);
}

export function parseMessage(text, { accounts = [], categories = [], defaultAccountId = null, today = todayISO() } = {}) {
  const raw = String(text || '').trim();
  if (!raw) throw new ParseError('Tulis transaksinya, contoh: makan 25rb');
  if (raw.length > 500) throw new ParseError('Pesan terlalu panjang');

  const amount = findAmount(raw);
  if (!amount) throw new ParseError('Jumlahnya belum ketemu. Contoh: makan 25rb atau gaji 5jt');
  if (amount.value > 1_000_000_000_000) throw new ParseError('Jumlah terlalu besar');

  const isTransfer = TRANSFER_RE.test(raw);
  const isIncome = !isTransfer && (INCOME_RE.test(raw) || raw.trim().startsWith('+'));
  const kind = isTransfer ? 'transfer' : isIncome ? 'income' : 'expense';

  const mentioned = detectAccount(raw, accounts.filter((a) => !a.archived));
  const activeAccounts = accounts.filter((a) => !a.archived);
  const fallbackAccount =
    activeAccounts.find((a) => a.id === Number(defaultAccountId)) || activeAccounts[0] || null;

  let account = null;
  let toAccount = null;

  if (kind === 'transfer') {
    if (activeAccounts.length < 2) {
      throw new ParseError('Butuh minimal 2 dompet untuk transfer. Tambah dompet dulu di dashboard.');
    }
    if (mentioned.length >= 2) {
      account = mentioned[0];
      toAccount = mentioned[1];
    } else if (mentioned.length === 1) {
      if (fallbackAccount && mentioned[0].id === fallbackAccount.id) {
        account = mentioned[0];
        toAccount = activeAccounts.find((a) => a.id !== mentioned[0].id);
      } else {
        account = fallbackAccount;
        toAccount = mentioned[0];
      }
    } else {
      account = fallbackAccount;
      toAccount = activeAccounts.find((a) => a.id !== fallbackAccount.id);
    }
  } else {
    account = mentioned[0] || fallbackAccount;
  }

  if (!account) throw new ParseError('Dompet belum ada. Tambah dompet dulu di dashboard.');

  const note = cleanNote(raw, amount, mentioned, kind);
  const occurredOn = detectDate(raw, today);
  let category = null;
  if (kind !== 'transfer') {
    category = matchCategory(categories, `${note} ${raw}`, kind);
  }

  return {
    kind,
    amount: amount.value,
    accountId: account.id,
    accountName: account.name,
    toAccountId: toAccount ? toAccount.id : null,
    toAccountName: toAccount ? toAccount.name : null,
    categoryId: category ? category.id : null,
    categoryName: category ? category.name : null,
    note,
    occurredOn,
    raw,
  };
}
