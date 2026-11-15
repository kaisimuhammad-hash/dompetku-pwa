import { config } from '../config.js';

const numberFmt = new Intl.NumberFormat('id-ID');
const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DAYS_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

export function formatNumber(n) {
  return numberFmt.format(Math.round(Number(n) || 0));
}

export function formatIDR(n) {
  return `Rp ${formatNumber(n)}`;
}

export function formatIDRCompact(n) {
  const value = Math.abs(Number(n) || 0);
  if (value >= 1_000_000_000) return `Rp ${trimDecimal(value / 1_000_000_000)} M`;
  if (value >= 1_000_000) return `Rp ${trimDecimal(value / 1_000_000)} jt`;
  if (value >= 10_000) return `Rp ${trimDecimal(value / 1_000)} rb`;
  return formatIDR(n);
}

function trimDecimal(n) {
  return numberFmt.format(Number(n.toFixed(1)));
}

export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function currentMonth(now = new Date()) {
  return todayISO(now).slice(0, 7);
}

export function isValidMonth(month) {
  return typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export function isValidDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function monthBounds(month) {
  const [year, mon] = month.split('-').map(Number);
  const start = `${month}-01`;
  const next = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, '0')}-01`;
  return { start, end: next };
}

export function shiftMonth(month, delta) {
  const [year, mon] = month.split('-').map(Number);
  const zero = year * 12 + (mon - 1) + delta;
  const nextYear = Math.floor(zero / 12);
  const nextMon = (zero % 12 + 12) % 12 + 1;
  return `${nextYear}-${String(nextMon).padStart(2, '0')}`;
}

export function monthLabel(month, short = false) {
  const [year, mon] = month.split('-').map(Number);
  return `${(short ? MONTHS_SHORT : MONTHS)[mon - 1]} ${year}`;
}

export function formatDateID(dateISO) {
  const [year, mon, day] = dateISO.split('-').map(Number);
  return `${day} ${MONTHS_SHORT[mon - 1]} ${year}`;
}

export function formatDateLong(dateISO) {
  const [year, mon, day] = dateISO.split('-').map(Number);
  const dow = new Date(Date.UTC(year, mon - 1, day)).getUTCDay();
  return `${DAYS_SHORT[dow]}, ${day} ${MONTHS[mon - 1]} ${year}`;
}

export function formatDayLabel(dateISO, today = todayISO()) {
  if (dateISO === today) return 'Hari ini';
  const yesterday = shiftDate(today, -1);
  if (dateISO === yesterday) return 'Kemarin';
  return formatDateID(dateISO);
}

export function shiftDate(dateISO, delta) {
  const [year, mon, day] = dateISO.split('-').map(Number);
  const d = new Date(Date.UTC(year, mon - 1, day));
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function daysInMonth(month) {
  const [year, mon] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

export function maskChatId(id) {
  const str = String(id);
  if (str.length <= 4) return '••••';
  return `${'•'.repeat(Math.max(0, str.length - 4))}${str.slice(-4)}`;
}
