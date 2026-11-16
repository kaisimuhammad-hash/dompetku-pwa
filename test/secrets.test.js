import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptSecret, encryptSecret, maskToken } from '../src/lib/secrets.js';

const TOKEN = '123456789:AAHrandomTokenValueForTesting12345';

test('token bot bisa dienkripsi dan dibuka kembali', () => {
  const encrypted = encryptSecret(TOKEN);
  assert.notEqual(encrypted, TOKEN);
  assert.match(encrypted, /^v1:/);
  assert.equal(decryptSecret(encrypted), TOKEN);
});

test('enkripsi memakai IV acak sehingga hasil berbeda', () => {
  assert.notEqual(encryptSecret(TOKEN), encryptSecret(TOKEN));
});

test('payload rusak atau dimodifikasi ditolak', () => {
  assert.equal(decryptSecret('bukan-payload'), null);
  assert.equal(decryptSecret('v1:aaa:bbb:ccc'), null);
  const encrypted = encryptSecret(TOKEN);
  const parts = encrypted.split(':');
  parts[3] = Buffer.from('token-palsu').toString('base64');
  assert.equal(decryptSecret(parts.join(':')), null);
});

test('token yang ditampilkan disamarkan', () => {
  assert.equal(maskToken(TOKEN), '123456789:••••••••');
  assert.equal(maskToken('tanpa-titik-dua'), '••••');
  assert.equal(maskToken(''), '••••');
});
