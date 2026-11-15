import { fmtCompact, fmtIDR, fmtNumber } from './format.js';

function niceMax(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.pow(10, Math.floor(Math.log10(value)));
  const fraction = value / exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * exponent;
}

export function flowChart(days) {
  const W = 760;
  const H = 236;
  const pad = { top: 16, right: 12, bottom: 26, left: 56 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(...days.flatMap((d) => [d.income, d.expense]), 1));
  const step = plotW / days.length;
  const barW = Math.min(11, Math.max(3, step * 0.27));
  const parts = [];

  for (let i = 0; i <= 3; i += 1) {
    const y = pad.top + plotH - (plotH * i) / 3;
    const value = (max * i) / 3;
    parts.push(
      `<line class="grid-line" x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}"/>`,
      `<text x="${pad.left - 10}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fmtCompact(value)}</text>`,
    );
  }

  days.forEach((day, index) => {
    const cx = pad.left + step * (index + 0.5);
    const incomeH = day.income > 0 ? Math.max(2.5, (day.income / max) * plotH) : 0;
    const expenseH = day.expense > 0 ? Math.max(2.5, (day.expense / max) * plotH) : 0;
    const radius = Math.min(3, barW / 2);

    parts.push(
      `<g><title>Tanggal ${day.day}: masuk ${fmtIDR(day.income)}, keluar ${fmtIDR(day.expense)}</title>`,
    );
    if (incomeH) {
      parts.push(
        `<rect class="bar bar-income" x="${(cx - barW - 1).toFixed(1)}" y="${(pad.top + plotH - incomeH).toFixed(1)}" width="${barW.toFixed(1)}" height="${incomeH.toFixed(1)}" rx="${radius}"/>`,
      );
    }
    if (expenseH) {
      parts.push(
        `<rect class="bar bar-expense" x="${(cx + 1).toFixed(1)}" y="${(pad.top + plotH - expenseH).toFixed(1)}" width="${barW.toFixed(1)}" height="${expenseH.toFixed(1)}" rx="${radius}"/>`,
      );
    }
    parts.push('</g>');

    if (day.day === 1 || day.day % 5 === 0) {
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${day.day}</text>`,
      );
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Grafik arus kas harian">${parts.join('')}</svg>`;
}

export function donutChart(items, total) {
  const r = 46;
  const circumference = 2 * Math.PI * r;
  const visible = items.filter((item) => item.amount > 0);
  let offset = 0;
  const segments = [];

  visible.forEach((item) => {
    const fraction = total > 0 ? item.amount / total : 0;
    const length = Math.max(fraction * circumference - 4, 0);
    segments.push(
      `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${item.color}" stroke-width="14" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" stroke-linecap="round"/>`,
    );
    offset += fraction * circumference;
  });

  return `<svg viewBox="0 0 120 120" role="img" aria-label="Komposisi pengeluaran per kategori">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="14"/>
    ${segments.join('')}
  </svg>`;
}

let sparkId = 0;

export function sparkline(values) {
  const W = 600;
  const H = 90;
  if (!values.length) return '';
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * W;
    const y = H - 10 - ((value - min) / range) * (H - 24);
    return [x, y];
  });
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  sparkId += 1;
  const id = `spark-${sparkId}`;

  return `<svg class="hero-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.26"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/>
    <path d="${line}" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

export function totalLabel(value) {
  return fmtNumber(value);
}
