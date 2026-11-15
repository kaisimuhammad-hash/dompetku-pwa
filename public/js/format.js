const nf = new Intl.NumberFormat('id-ID');
const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function fmtNumber(n) {
  return nf.format(Math.round(Number(n) || 0));
}

export function fmtIDR(n) {
  return `Rp ${fmtNumber(n)}`;
}

export function fmtCompact(n) {
  const value = Math.abs(Number(n) || 0);
  if (value >= 1_000_000_000) return `${trim(value / 1_000_000_000)} M`;
  if (value >= 1_000_000) return `${trim(value / 1_000_000)} jt`;
  if (value >= 1_000) return `${trim(value / 1_000)} rb`;
  return fmtNumber(value);
}

function trim(n) {
  return nf.format(Number(n.toFixed(1)));
}

export function fmtSigned(n) {
  const value = Number(n) || 0;
  return `${value < 0 ? '-' : '+'}${fmtIDR(Math.abs(value))}`;
}

export function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function currentMonth() {
  return todayISO().slice(0, 7);
}

export function shiftMonth(month, delta) {
  const [year, mon] = month.split('-').map(Number);
  const zero = year * 12 + (mon - 1) + delta;
  const y = Math.floor(zero / 12);
  const m = ((zero % 12) + 12) % 12 + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function monthLabel(month) {
  const [year, mon] = month.split('-').map(Number);
  return `${MONTHS[mon - 1]} ${year}`;
}

export function monthLabelShort(month) {
  const [year, mon] = month.split('-').map(Number);
  return `${MONTHS_SHORT[mon - 1]} ${year}`;
}

export function formatDateID(dateISO) {
  if (!dateISO) return '';
  const [year, mon, day] = dateISO.split('-').map(Number);
  return `${day} ${MONTHS_SHORT[mon - 1]} ${year}`;
}

export function formatDateLong(dateISO) {
  if (!dateISO) return '';
  const [year, mon, day] = dateISO.split('-').map(Number);
  const dow = new Date(Date.UTC(year, mon - 1, day)).getUTCDay();
  return `${DAYS[dow]}, ${day} ${MONTHS[mon - 1]} ${year}`;
}

export function formatDayGroup(dateISO) {
  const today = todayISO();
  if (dateISO === today) return 'Hari ini';
  const y = new Date(new Date(`${today}T00:00:00`).getTime() - 86400000);
  const yesterday = new Date(y.getTime() - y.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (dateISO === yesterday) return 'Kemarin';
  return formatDateLong(dateISO);
}

export function greeting() {
  const hour = new Date().getHours();
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function typeLabel(type) {
  return (
    {
      cash: 'Tunai',
      bank: 'Bank',
      ewallet: 'E-wallet',
      other: 'Lainnya',
    }[type] || type
  );
}

export function kindLabel(kind) {
  return { expense: 'Pengeluaran', income: 'Pemasukan', transfer: 'Transfer' }[kind] || kind;
}

export function debounce(fn, wait = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
