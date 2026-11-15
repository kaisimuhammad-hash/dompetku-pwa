import assert from 'node:assert/strict';
import test from 'node:test';
import { findAmount, parseMessage, ParseError } from '../src/lib/parse.js';

const accounts = [
  { id: 1, name: 'Tunai', archived: false },
  { id: 2, name: 'Rekening', archived: false },
  { id: 3, name: 'E-Wallet', archived: false },
];

const categories = [
  { id: 1, name: 'Makan & Minum', kind: 'expense', keywords: ['makan', 'kopi', 'nasi'] },
  { id: 2, name: 'Transportasi', kind: 'expense', keywords: ['bensin', 'ojol'] },
  { id: 10, name: 'Gaji', kind: 'income', keywords: ['gaji', 'payroll'] },
];

const parse = (text, extra = {}) =>
  parseMessage(text, { accounts, categories, defaultAccountId: 1, today: '2026-11-15', ...extra });

test('findAmount membaca satuan ribu dan juta', () => {
  assert.equal(findAmount('makan 25rb').value, 25_000);
  assert.equal(findAmount('kopi 25 ribu').value, 25_000);
  assert.equal(findAmount('gaji 5jt').value, 5_000_000);
  assert.equal(findAmount('bayar 1,5 juta').value, 1_500_000);
});

test('findAmount membaca format rupiah dan pemisah ribuan', () => {
  assert.equal(findAmount('bayar Rp 25.000').value, 25_000);
  assert.equal(findAmount('belanja 100.000').value, 100_000);
  assert.equal(findAmount('transfer 1.250.000').value, 1_250_000);
});

test('pengeluaran dengan catatan dan kategori otomatis', () => {
  const result = parse('kopi susu 25rb');
  assert.equal(result.kind, 'expense');
  assert.equal(result.amount, 25_000);
  assert.equal(result.accountId, 1);
  assert.equal(result.categoryId, 1);
  assert.equal(result.note, 'kopi susu');
  assert.equal(result.occurredOn, '2026-11-15');
});

test('pemasukan terdeteksi dari kata kunci', () => {
  const result = parse('gaji November 5jt');
  assert.equal(result.kind, 'income');
  assert.equal(result.categoryId, 10);
  assert.equal(result.amount, 5_000_000);
});

test('transfer memakai dompet asal dan tujuan', () => {
  const result = parse('transfer 100rb dari Tunai ke Rekening');
  assert.equal(result.kind, 'transfer');
  assert.equal(result.amount, 100_000);
  assert.equal(result.accountId, 1);
  assert.equal(result.toAccountId, 2);
  assert.equal(result.categoryId, null);
});

test('transfer satu dompet memakai dompet default sebagai lawan', () => {
  const result = parse('transfer 50rb ke E-Wallet');
  assert.equal(result.kind, 'transfer');
  assert.equal(result.accountId, 1);
  assert.equal(result.toAccountId, 3);
});

test('dompet disebut di pesan dipilih sebagai sumber', () => {
  const result = parse('bensin 30rb Rekening');
  assert.equal(result.accountId, 2);
  assert.equal(result.categoryId, 2);
  assert.equal(result.note, 'bensin');
});

test('tanggal kemarin dan tanggal eksplisit', () => {
  assert.equal(parse('makan 20rb kemarin').occurredOn, '2026-11-14');
  assert.equal(parse('makan 20rb tanggal 3').occurredOn, '2026-11-03');
});

test('pesan tanpa jumlah ditolak dengan pesan jelas', () => {
  assert.throws(() => parse('makan siang'), ParseError);
});

test('jumlah terlalu besar ditolak', () => {
  assert.throws(() => parse('beli 9.999 miliar'), ParseError);
});

test('transfer butuh minimal dua dompet', () => {
  assert.throws(
    () => parseMessage('transfer 50rb', { accounts: [accounts[0]], categories, today: '2026-11-15' }),
    ParseError,
  );
});
