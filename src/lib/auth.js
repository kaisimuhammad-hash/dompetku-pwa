import crypto from 'node:crypto';
import { config } from '../config.js';
import { unauthorized } from './errors.js';

export const SESSION_COOKIE = 'dpk_session';
const SESSION_DAYS = 30;

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function checkPasscode(input) {
  const expected = crypto.createHash('sha256').update(String(config.appPasscode)).digest();
  const actual = crypto.createHash('sha256').update(String(input || '')).digest();
  return crypto.timingSafeEqual(expected, actual);
}

export function createSessionToken() {
  const payload = Buffer.from(
    JSON.stringify({ sub: 'owner', exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 }),
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySessionToken(token) {
  if (!token || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  const expected = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payload)
    .digest('base64url');
  if (!safeEqual(signature, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now();
  } catch {
    return false;
  }
}

export function isAuthenticated(req) {
  return verifySessionToken(req.cookies?.[SESSION_COOKIE]);
}

export function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) return next(unauthorized());
  next();
}
