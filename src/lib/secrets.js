import crypto from 'node:crypto';
import { config } from '../config.js';

const KEY = crypto.scryptSync(config.sessionSecret, 'dompetku-bot-token', 32);
const PREFIX = 'v1';

export function encryptSecret(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  return [
    PREFIX,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload) {
  try {
    const [version, iv, tag, data] = String(payload).split(':');
    if (version !== PREFIX || !iv || !tag || !data) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function maskToken(token) {
  const text = String(token || '');
  const [id, secret] = text.split(':');
  if (!id || !secret) return '••••';
  return `${id}:••••••••`;
}
