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

export function donutChartWithLegend(items, total) {
  const r = 46;
  const circumference = 2 * Math.PI * r;
  const visible = items.filter((item) => item.amount > 0);
  let offset = 0;
  const segments = [];

  visible.forEach((item) => {
    const fraction = total > 0 ? item.amount / total : 0;
    const length = Math.max(fraction * circumference - 2, 0);
    segments.push(
      `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${item.color}" stroke-width="16" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" stroke-linecap="round"><title>${item.name}: ${fmtIDR(item.amount)} (${item.percent}%)</title></circle>`,
    );
    offset += fraction * circumference;
  });

  const svg = `<svg viewBox="0 0 120 120" class="donut-chart-svg" role="img" aria-label="Alokasi Pengeluaran">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="16"/>
    ${segments.join('')}
  </svg>`;

  const legend = visible.slice(0, 9).map((item) => `
    <div class="donut-legend-item">
      <span class="donut-legend-dot" style="background-color: ${item.color}"></span>
      <span class="donut-legend-name" title="${item.name}">${item.name}</span>
      <span class="donut-legend-pct">${item.percent}%</span>
    </div>
  `).join('');

  return { svg, legend };
}

export function dailyExpenseLineChart(days) {
  const W = 820;
  const H = 270;
  const pad = { top: 38, right: 24, bottom: 32, left: 48 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const values = days.map((d) => d.expense);
  const maxVal = Math.max(...values, 50_000);
  const max = niceMax(maxVal);

  const step = plotW / Math.max(days.length - 1, 1);
  const points = days.map((d, index) => {
    const x = pad.left + step * index;
    const y = pad.top + plotH - (d.expense / max) * plotH;
    return { x, y, day: d.day, expense: d.expense, date: d.date };
  });

  const sorted = [...values].sort((a, b) => b - a);
  const topThreshold = sorted[Math.min(5, Math.floor(sorted.length * 0.25))] || max * 0.25;

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${(pad.top + plotH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(pad.top + plotH).toFixed(1)} Z`;

  const parts = [];
  for (let i = 0; i <= 3; i += 1) {
    const y = pad.top + plotH - (plotH * i) / 3;
    const val = (max * i) / 3;
    parts.push(
      `<line class="grid-line" x1="${pad.left}" y1="${y.toFixed(1)}" x2="${W - pad.right}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-dasharray="3 3"/>`,
      `<text x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="10">${fmtCompact(val)}</text>`,
    );
  }

  points.forEach((p) => {
    if (p.day === 1 || p.day % 2 === 0 || p.day === days.length) {
      parts.push(
        `<line x1="${p.x.toFixed(1)}" y1="${pad.top}" x2="${p.x.toFixed(1)}" y2="${(pad.top + plotH).toFixed(1)}" stroke="var(--border)" stroke-opacity="0.3"/>`,
        `<text x="${p.x.toFixed(1)}" y="${H - 12}" text-anchor="middle" fill="var(--muted)" font-size="10">${p.day}</text>`,
      );
    }
  });

  parts.push(
    `<defs>
      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#475569" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="#475569" stop-opacity="0.02"/>
      </linearGradient>
    </defs>`,
    `<path d="${areaD}" fill="url(#areaGrad)"/>`,
    `<path d="${pathD}" fill="none" stroke="#334155" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`,
  );

  points.forEach((p) => {
    const isHigh = p.expense >= topThreshold && p.expense > 0;
    parts.push(
      `<g class="chart-point" tabindex="0">
        <title>Tanggal ${p.day}: ${fmtIDR(p.expense)}</title>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isHigh ? 4.5 : 3}" fill="${isHigh ? '#0f172a' : '#64748b'}" stroke="#ffffff" stroke-width="1.5"/>`,
    );

    if (isHigh) {
      const tagText = fmtCompact(p.expense);
      const tagW = Math.max(tagText.length * 7 + 10, 42);
      const tagY = Math.max(p.y - 12, 14);
      parts.push(
        `<rect x="${(p.x - tagW / 2).toFixed(1)}" y="${(tagY - 11).toFixed(1)}" width="${tagW}" height="14" rx="3" fill="#ffffff" stroke="#94a3b8" stroke-width="0.8"/>
        <text x="${p.x.toFixed(1)}" y="${tagY.toFixed(1)}" text-anchor="middle" font-size="9" font-weight="600" fill="#1e293b">${tagText}</text>`,
      );
    }
    parts.push('</g>');
  });

  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg daily-line-chart" role="img" aria-label="Grafik pengeluaran harian">${parts.join('')}</svg>`;
}

export function totalLabel(value) {
  return fmtNumber(value);
}
