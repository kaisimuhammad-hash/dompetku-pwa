import assert from 'node:assert/strict';
import test from 'node:test';
import { backupFilename, isBackupDue } from '../src/services/backup.js';

const DAY = 24 * 60 * 60 * 1000;

test('isBackupDue menganggap belum pernah backup sebagai jatuh tempo', () => {
  assert.equal(isBackupDue(null), true);
  assert.equal(isBackupDue(''), true);
});

test('isBackupDue memakai interval 7 hari secara default', () => {
  const now = Date.parse('2026-11-16T10:00:00.000Z');
  assert.equal(isBackupDue(new Date(now - 6 * DAY).toISOString(), now), false);
  assert.equal(isBackupDue(new Date(now - 7 * DAY).toISOString(), now), true);
  assert.equal(isBackupDue(new Date(now - 30 * DAY).toISOString(), now), true);
});

test('isBackupDue menerima interval khusus', () => {
  const now = Date.parse('2026-11-16T10:00:00.000Z');
  assert.equal(isBackupDue(new Date(now - 2 * DAY).toISOString(), now, 3), false);
  assert.equal(isBackupDue(new Date(now - 3 * DAY).toISOString(), now, 3), true);
});

test('isBackupDue mengabaikan nilai tanggal rusak', () => {
  assert.equal(isBackupDue('bukan-tanggal'), true);
});

test('backupFilename memakai tanggal zona Asia/Jakarta', () => {
  assert.equal(backupFilename(new Date('2026-11-15T18:30:00.000Z')), 'dompetku-backup-2026-11-16.json');
  assert.equal(backupFilename(new Date('2026-11-16T16:59:00.000Z')), 'dompetku-backup-2026-11-16.json');
});
