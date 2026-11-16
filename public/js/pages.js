import { api } from './api.js';
import { donutChart, flowChart, sparkline } from './charts.js';
import {
  currentMonth,
  debounce,
  esc,
  fmtCompact,
  fmtIDR,
  fmtNumber,
  fmtSigned,
  formatDateLong,
  formatDayGroup,
  greeting,
  kindLabel,
  monthLabel,
  monthLabelShort,
  shiftMonth,
  todayISO,
  typeLabel,
} from './format.js';
import { icon } from './icons.js';
import {
  confirmAction,
  emptyState,
  loadingScreen,
  mountMoneyInput,
  openModal,
  setButtonBusy,
  showModalError,
  toast,
} from './ui.js';

const COLORS = [
  '#0f9d76', '#3b82f6', '#8b5cf6', '#f97316', '#ec4899', '#0ea5e9',
  '#ef4444', '#a855f7', '#14b8a6', '#eab308', '#64748b', '#94a3b8',
];
const ACCOUNT_ICONS = ['wallet', 'banknote', 'bank', 'phone', 'briefcase', 'coins', 'star'];
const CATEGORY_ICONS = [
  'tag', 'food', 'car', 'shopping-bag', 'receipt', 'heart-pulse', 'gamepad',
  'book', 'home', 'box', 'banknote', 'gift', 'trending-up', 'coins', 'briefcase', 'wallet',
];

let basicsCache = null;

export async function loadBasics(force = false) {
  if (!basicsCache || force) {
    const [accounts, categories] = await Promise.all([
      api.accounts(true),
      api.categories(true),
    ]);
    basicsCache = { accounts: accounts.items, categories: categories.items };
  }
  return basicsCache;
}

export function invalidateBasics() {
  basicsCache = null;
}

function monthNavHTML(month) {
  return `<div class="month-nav">
    <button class="icon-btn" data-month="${shiftMonth(month, -1)}" aria-label="Bulan sebelumnya">${icon('chevron-left')}</button>
    <span class="month-label">${monthLabelShort(month)}</span>
    <button class="icon-btn" data-month="${shiftMonth(month, 1)}" aria-label="Bulan berikutnya">${icon('chevron-right')}</button>
  </div>`;
}

function bindMonthNav(root, handler) {
  root.querySelectorAll('[data-month]').forEach((button) => {
    button.addEventListener('click', () => handler(button.dataset.month));
  });
}

function deltaHTML(change, positiveIsGood) {
  if (change === null || change === undefined) return '';
  const good = positiveIsGood ? change >= 0 : change <= 0;
  const cls = change === 0 ? 'flat' : good ? 'down' : 'up';
  const arrow = change >= 0 ? 'arrow-up-right' : 'arrow-down-left';
  return `<span class="delta ${cls}">${icon(arrow)}${Math.abs(change)}%</span>`;
}

function txRowHTML(tx) {
  const isTransfer = tx.kind === 'transfer';
  const tint = isTransfer ? '#64748b' : tx.categoryColor || (tx.kind === 'income' ? '#0f9d76' : '#94a3b8');
  const iconName = isTransfer ? 'transfer' : tx.categoryIcon || 'tag';
  const title = tx.note || tx.categoryName || (isTransfer ? 'Transfer' : kindLabel(tx.kind));
  const sub = isTransfer
    ? `${esc(tx.accountName)} → ${esc(tx.toAccountName)}`
    : `${esc(tx.accountName)} <span class="sep">·</span> ${esc(tx.categoryName || 'Tanpa kategori')}`;
  const source = tx.source === 'telegram' ? icon('bot', 'tx-source') : '';
  const cls = isTransfer ? 'transfer' : tx.kind === 'income' ? 'pos' : 'neg';
  const prefix = tx.kind === 'income' ? '+' : tx.kind === 'expense' ? '-' : '';

  return `<button type="button" class="tx-row" data-tx-id="${tx.id}">
    <span class="tx-icon" style="--tint:${esc(tint)}">${icon(iconName)}</span>
    <span class="tx-main">
      <span class="tx-title">${esc(title)}</span>
      <span class="tx-sub">${sub}${source}</span>
    </span>
    <span class="tx-amount ${cls}">${prefix}${fmtIDR(tx.amount)}</span>
  </button>`;
}

function groupTransactions(items) {
  const map = new Map();
  for (const tx of items) {
    if (!map.has(tx.occurredOn)) map.set(tx.occurredOn, []);
    map.get(tx.occurredOn).push(tx);
  }
  return [...map.entries()].map(([date, rows]) => {
    let income = 0;
    let expense = 0;
    for (const row of rows) {
      if (row.kind === 'income') income += row.amount;
      if (row.kind === 'expense') expense += row.amount;
    }
    return { date, rows, net: income - expense };
  });
}

function transactionsListHTML(items, emptyAction = true) {
  if (!items.length) {
    return emptyState({
      iconName: 'list',
      title: 'Belum ada transaksi',
      description: 'Catat lewat bot Telegram atau tambahkan langsung dari dashboard.',
      action: emptyAction
        ? `<button class="btn soft" data-add>${icon('plus')} Catat transaksi</button>`
        : '',
    });
  }

  return groupTransactions(items)
    .map(
      (group) => `
      <div class="tx-group-label">
        <span>${esc(formatDayGroup(group.date))}</span>
        <span>${group.net === 0 ? '' : fmtSigned(group.net)}</span>
      </div>
      <div>${group.rows.map(txRowHTML).join('')}</div>`,
    )
    .join('');
}

function bindTxRows(root, items, ctx, onSaved) {
  root.querySelectorAll('[data-tx-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const tx = items.find((item) => item.id === Number(button.dataset.txId));
      if (tx) openTransactionModal(ctx, tx, { onSaved });
    });
  });
}

function budgetRowHTML(budget) {
  const pct = Math.min(budget.percent, 100);
  const status = budget.status === 'over' ? 'over' : budget.status === 'warning' ? 'warn' : '';
  return `<button type="button" class="budget-row" data-budget-id="${budget.id}" style="width:100%;text-align:left">
    <span class="budget-head">
      <span class="budget-name">
        <span class="dot-icon" style="--tint:${esc(budget.color)}">${icon(budget.icon)}</span>
        ${esc(budget.name)}
      </span>
      <span class="budget-pct ${status}">${budget.percent}%</span>
    </span>
    <span class="budget-nums">
      <strong>${fmtIDR(budget.spent)}</strong> dari ${fmtIDR(budget.limit)}
    </span>
    <span class="progress ${status}"><span style="width:${pct}%"></span></span>
  </button>`;
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export async function dashboardPage(ctx) {
  const month = ctx.query.month || currentMonth();
  const data = await api.overview(month);
  const { summary, budgets } = data;

  let running = 0;
  const cumulative = data.daily.map((day) => {
    running += day.income - day.expense;
    return running;
  });
  const hasFlow = summary.income > 0 || summary.expense > 0;
  const hasHistory = summary.count > 0 || data.recent.length > 0;

  const top = data.categories.slice(0, 5);
  const rest = data.categories.slice(5).reduce((acc, item) => acc + item.amount, 0);
  const donutItems = [...top];
  if (rest > 0) donutItems.push({ name: 'Lainnya', amount: rest, color: '#94a3b8' });

  const priorityBudgets = [...budgets.items].sort((a, b) => b.percent - a.percent).slice(0, 4);

  ctx.view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Ringkasan</p>
        <h1 class="page-title">${greeting()}</h1>
        <p class="page-sub">${formatDateLong(todayISO())}</p>
      </div>
      <div class="head-actions">
        ${monthNavHTML(month)}
        <button class="btn primary" data-add>${icon('plus')} Catat</button>
      </div>
    </div>

    <section class="hero">
      <div class="hero-top">
        <span class="hero-label">Total saldo · ${data.accounts.length} dompet</span>
        <button class="hero-eye" data-privacy aria-label="Sembunyikan saldo">${icon('eye')}</button>
      </div>
      <div class="hero-amount">${fmtIDR(data.totalBalance)}</div>
      <div class="hero-meta">
        <span class="hero-badge ${summary.net >= 0 ? 'pos' : ''}">${summary.net >= 0 ? 'Surplus' : 'Defisit'} bulan ini</span>
        <span>${fmtSigned(summary.net)}</span>
      </div>
      <div class="hero-metrics">
        <div class="hero-metric"><span>Pemasukan</span><strong>${fmtIDR(summary.income)}</strong></div>
        <div class="hero-metric"><span>Pengeluaran</span><strong>${fmtIDR(summary.expense)}</strong></div>
      </div>
      ${hasFlow ? sparkline(cumulative) : ''}
    </section>

    <div class="stats-grid">
      <div class="stat">
        <span class="stat-icon in">${icon('arrow-down-left')}</span>
        <div>
          <div class="stat-label">Pemasukan ${monthLabelShort(month)}</div>
          <div class="stat-value">${fmtIDR(summary.income)}</div>
          <div class="stat-sub">${deltaHTML(data.incomeChange, true) || '<span>Bulan ini</span>'}</div>
        </div>
      </div>
      <div class="stat">
        <span class="stat-icon out">${icon('arrow-up-right')}</span>
        <div>
          <div class="stat-label">Pengeluaran ${monthLabelShort(month)}</div>
          <div class="stat-value">${fmtIDR(summary.expense)}</div>
          <div class="stat-sub">${deltaHTML(data.expenseChange, false) || '<span>Bulan ini</span>'}</div>
        </div>
      </div>
    </div>

    ${
      hasHistory
        ? ''
        : `<section class="card card-pad mt-16">
            <div class="row-between">
              <div>
                <h2 class="section-title">Mulai catat dalam 2 langkah</h2>
                <p class="section-sub">Data keuanganmu akan otomatis rapi dan bisa dilihat dari mana saja.</p>
              </div>
            </div>
            <div class="steps">
              <div class="step"><span class="step-num">1</span><span>Hubungkan bot Telegram di menu <strong>Pengaturan</strong>, lalu kirim <code>/start</code> ke bot kamu.</span></div>
              <div class="step"><span class="step-num">2</span><span>Kirim pesan seperti <code>makan siang 25rb</code> — transaksi langsung tercatat.</span></div>
              <div class="step"><span class="step-num">3</span><span>Atur anggaran bulanan supaya pengeluaran tetap terkendali.</span></div>
            </div>
          </section>`
    }

    <section class="card mt-16">
      <div class="card-head">
        <div>
          <h2 class="section-title">Arus kas harian</h2>
          <p class="section-sub">${monthLabel(month)}</p>
        </div>
        <div class="chart-legend">
          <span><i class="legend-dot" style="background:var(--income)"></i>Masuk</span>
          <span><i class="legend-dot" style="background:var(--expense)"></i>Keluar</span>
        </div>
      </div>
      <div class="card-body chart-wrap">
        ${
          hasFlow
            ? flowChart(data.daily)
            : emptyState({
                iconName: 'trending-up',
                title: 'Belum ada arus kas',
                description: 'Grafik muncul setelah ada pemasukan atau pengeluaran bulan ini.',
              })
        }
      </div>
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-head">
          <div>
            <h2 class="section-title">Pengeluaran</h2>
            <p class="section-sub">Per kategori · ${monthLabelShort(month)}</p>
          </div>
          <a class="link-btn" href="#/transaksi?kind=expense">Detail ${icon('chevron-right')}</a>
        </div>
        <div class="card-body">
          ${
            summary.expense === 0
              ? emptyState({
                  iconName: 'shopping-bag',
                  title: 'Belum ada pengeluaran',
                  description: 'Pengeluaran bulan ini akan terbagi otomatis per kategori.',
                })
              : `<div class="donut-layout">
                  <div class="donut-wrap">
                    ${donutChart(donutItems, summary.expense)}
                    <div class="donut-center">
                      <span>Total keluar</span>
                      <strong>${fmtCompact(summary.expense)}</strong>
                    </div>
                  </div>
                  <div class="donut-legend">
                    ${donutItems
                      .map(
                        (item) => `<div class="donut-item">
                          <i class="legend-dot" style="background:${item.color}"></i>
                          <span class="name">${esc(item.name)}</span>
                          <span class="value">${Math.round((item.amount / summary.expense) * 100)}%</span>
                        </div>`,
                      )
                      .join('')}
                  </div>
                </div>`
          }
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2 class="section-title">Anggaran</h2>
            <p class="section-sub">${budgets.items.length > 0 ? `${fmtIDR(budgets.totalSpent)} dari ${fmtIDR(budgets.totalLimit)}` : 'Belum diatur'}</p>
          </div>
          <a class="link-btn" href="#/anggaran">Atur ${icon('chevron-right')}</a>
        </div>
        <div class="card-body">
          ${
            priorityBudgets.length === 0
              ? emptyState({
                  iconName: 'target',
                  title: 'Belum ada anggaran',
                  description: 'Tetapkan batas belanja per kategori agar lebih terkendali.',
                  action: `<a class="btn soft small" href="#/anggaran">Buat anggaran</a>`,
                })
              : `<div class="budget-list">${priorityBudgets.map(budgetRowHTML).join('')}</div>
                 <div class="mt-16"><a class="link-btn" href="#/anggaran">Lihat semua anggaran ${icon('chevron-right')}</a></div>`
          }
        </div>
      </section>
    </div>

    <section class="card mt-16">
      <div class="card-head">
        <div>
          <h2 class="section-title">Aktivitas terakhir</h2>
          <p class="section-sub">Transaksi terbaru dari semua dompet</p>
        </div>
        <a class="link-btn" href="#/transaksi">Lihat semua ${icon('chevron-right')}</a>
      </div>
      <div class="card-body">
        ${
          data.recent.length === 0
            ? emptyState({
                iconName: 'receipt',
                title: 'Belum ada aktivitas',
                description: 'Transaksi pertama kamu akan muncul di sini.',
                action: `<button class="btn soft small" data-add>${icon('plus')} Catat sekarang</button>`,
              })
            : `<div class="tx-list">${data.recent.map(txRowHTML).join('')}</div>`
        }
      </div>
    </section>`;

  ctx.view.querySelectorAll('[data-add]').forEach((button) => {
    button.addEventListener('click', () => openTransactionModal(ctx, null, { onSaved: ctx.refresh }));
  });
  bindMonthNav(ctx.view, (next) => ctx.navigate('/', { month: next }));
  bindTxRows(ctx.view, data.recent, ctx, ctx.refresh);

  const hero = ctx.view.querySelector('.hero');
  const privacyButton = ctx.view.querySelector('[data-privacy]');
  let hidden = localStorage.getItem('dpk_privacy') === '1';
  const applyPrivacy = () => {
    hero.classList.toggle('balance-hidden', hidden);
    privacyButton.innerHTML = icon(hidden ? 'eye-off' : 'eye');
    privacyButton.setAttribute('aria-label', hidden ? 'Tampilkan saldo' : 'Sembunyikan saldo');
  };
  privacyButton.addEventListener('click', () => {
    hidden = !hidden;
    localStorage.setItem('dpk_privacy', hidden ? '1' : '0');
    applyPrivacy();
  });
  applyPrivacy();
}

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

export async function transactionsPage(ctx) {
  const { accounts } = await loadBasics();
  const activeAccounts = accounts.filter((account) => !account.archived);
  const filters = {
    month: ctx.query.month || currentMonth(),
    account: ctx.query.account || '',
    kind: ctx.query.kind || '',
    q: ctx.query.q || '',
  };

  const syncHash = () => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value && !(key === 'month' && value === currentMonth())) params.set(key, value);
    });
    const text = params.toString();
    history.replaceState(null, '', `#/transaksi${text ? `?${text}` : ''}`);
  };

  ctx.view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Transaksi</p>
        <h1 class="page-title">Semua catatan</h1>
        <p class="page-sub">Cari, saring, dan perbaiki transaksi kamu.</p>
      </div>
      <div class="head-actions">
        <button class="btn primary" data-add>${icon('plus')} Catat</button>
      </div>
    </div>

    <div class="filter-bar">
      ${monthNavHTML(filters.month)}
      <select class="select compact" id="filter-account" aria-label="Filter dompet">
        <option value="">Semua dompet</option>
        ${activeAccounts.map((a) => `<option value="${a.id}" ${String(a.id) === filters.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
      </select>
      <select class="select compact" id="filter-kind" aria-label="Filter jenis">
        <option value="">Semua jenis</option>
        <option value="expense" ${filters.kind === 'expense' ? 'selected' : ''}>Pengeluaran</option>
        <option value="income" ${filters.kind === 'income' ? 'selected' : ''}>Pemasukan</option>
        <option value="transfer" ${filters.kind === 'transfer' ? 'selected' : ''}>Transfer</option>
      </select>
      <div class="search-box">
        ${icon('search')}
        <input class="input" id="filter-search" placeholder="Cari catatan atau kategori…" value="${esc(filters.q)}" autocomplete="off" />
      </div>
    </div>

    <section class="card mt-16">
      <div class="card-head">
        <div>
          <h2 class="section-title" id="tx-month">${monthLabel(filters.month)}</h2>
          <p class="section-sub" id="tx-count">Memuat…</p>
        </div>
      </div>
      <div class="card-body" id="tx-results">${loadingScreen()}</div>
    </section>`;

  let items = [];

  const renderList = () => {
    const container = ctx.view.querySelector('#tx-results');
    container.innerHTML = transactionsListHTML(items);
    ctx.view.querySelector('#tx-month').textContent = monthLabel(filters.month);
    ctx.view.querySelector('#tx-count').textContent = `${fmtNumber(items.length)} transaksi`;
  };

  const load = async () => {
    const data = await api.transactions({ ...filters, limit: 300 });
    items = data.items;
    renderList();
    syncHash();
  };

  ctx.view.querySelectorAll('[data-add]').forEach((button) => {
    button.addEventListener('click', () => openTransactionModal(ctx, null, { onSaved: ctx.refresh }));
  });

  bindMonthNav(ctx.view, (next) => {
    filters.month = next;
    load();
  });

  ctx.view.querySelector('#filter-account').addEventListener('change', (event) => {
    filters.account = event.target.value;
    load();
  });
  ctx.view.querySelector('#filter-kind').addEventListener('change', (event) => {
    filters.kind = event.target.value;
    load();
  });
  ctx.view.querySelector('#filter-search').addEventListener(
    'input',
    debounce((event) => {
      filters.q = event.target.value.trim();
      load();
    }, 320),
  );

  ctx.view.querySelector('#tx-results').addEventListener('click', (event) => {
    const add = event.target.closest('[data-add]');
    if (add) {
      openTransactionModal(ctx, null, { onSaved: ctx.refresh });
      return;
    }
    const row = event.target.closest('[data-tx-id]');
    if (row) {
      const tx = items.find((item) => item.id === Number(row.dataset.txId));
      if (tx) openTransactionModal(ctx, tx, { onSaved: ctx.refresh });
    }
  });

  await load();
}

/* ------------------------------------------------------------------ */
/* Wallets                                                             */
/* ------------------------------------------------------------------ */

function walletCardHTML(account) {
  return `<article class="wallet-card ${account.isDefault ? 'is-default' : ''} ${account.archived ? 'archived' : ''}">
    <div class="wallet-top">
      <span class="wallet-avatar" style="--tint:${esc(account.color)}">${icon(account.icon)}</span>
      <div style="flex:1;min-width:0">
        <div class="wallet-name">${esc(account.name)}</div>
        <div class="wallet-type">${typeLabel(account.type)}</div>
      </div>
      ${account.isDefault ? '<span class="badge green">Utama</span>' : account.archived ? '<span class="badge">Arsip</span>' : ''}
    </div>
    <div>
      <div class="wallet-balance-label">Saldo saat ini</div>
      <div class="wallet-balance">${fmtIDR(account.balance)}</div>
    </div>
    <div class="wallet-foot">
      <span class="text-sm muted">Saldo awal ${fmtIDR(account.initialBalance)}</span>
      <div class="wallet-actions">
        ${
          account.archived
            ? `<button class="icon-btn bordered" data-wallet-restore="${account.id}" aria-label="Pulihkan dompet">${icon('refresh')}</button>`
            : `${
                !account.isDefault
                  ? `<button class="icon-btn bordered" data-wallet-default="${account.id}" aria-label="Jadikan dompet utama">${icon('star')}</button>`
                  : ''
              }
              <button class="icon-btn bordered" data-wallet-edit="${account.id}" aria-label="Ubah dompet">${icon('pencil')}</button>`
        }
      </div>
    </div>
  </article>`;
}

export async function walletsPage(ctx) {
  const [{ items }, settings] = await Promise.all([api.accounts(true), api.settings()]);
  const active = items.map((account) => ({ ...account, isDefault: account.id === settings.defaultAccountId }));
  const opened = active.filter((account) => !account.archived);
  const archived = active.filter((account) => account.archived);
  const total = active.reduce((sum, account) => sum + account.balance, 0);

  ctx.view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Dompet</p>
        <h1 class="page-title">Sumber dana</h1>
        <p class="page-sub">Kelola tunai, rekening bank, dan e-wallet kamu.</p>
      </div>
      <div class="head-actions">
        <button class="btn ghost" data-transfer>${icon('transfer')} Transfer</button>
        <button class="btn primary" data-add>${icon('plus')} Tambah dompet</button>
      </div>
    </div>

    <section class="card card-pad">
      <div class="row-between">
        <div>
          <p class="eyebrow">Total saldo</p>
          <div style="font-size:30px;font-weight:800;letter-spacing:-.03em;margin-top:4px">${fmtIDR(total)}</div>
          <p class="page-sub">${opened.length} dompet aktif${archived.length ? ` · ${archived.length} diarsipkan` : ''}</p>
        </div>
        <span class="badge green">${icon('shield')} Data tersimpan aman</span>
      </div>
    </section>

    <div class="wallet-grid">
      ${opened.map(walletCardHTML).join('')}
      <button class="wallet-card" data-add style="align-items:center;justify-content:center;min-height:196px;border-style:dashed;color:var(--muted)">
        <span class="empty-icon" style="margin:0">${icon('plus')}</span>
        <span style="font-weight:700;font-size:13.5px">Tambah dompet baru</span>
      </button>
    </div>

    ${
      archived.length
        ? `<div class="mt-20">
            <p class="eyebrow" style="margin-bottom:10px">Diarsipkan</p>
            <div class="wallet-grid">${archived.map(walletCardHTML).join('')}</div>
          </div>`
        : ''
    }`;

  const refresh = ctx.refresh;

  ctx.view.querySelectorAll('[data-add]').forEach((button) => {
    button.addEventListener('click', () => openWalletModal(ctx, null, { onSaved: refresh }));
  });
  ctx.view.querySelector('[data-transfer]').addEventListener('click', () => {
    openTransactionModal(ctx, null, { initialKind: 'transfer', onSaved: refresh });
  });

  ctx.view.querySelectorAll('[data-wallet-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const account = active.find((item) => item.id === Number(button.dataset.walletEdit));
      if (account) openWalletModal(ctx, account, { onSaved: refresh });
    });
  });

  ctx.view.querySelectorAll('[data-wallet-default]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api.setDefaultAccount(Number(button.dataset.walletDefault));
        toast('Dompet utama diperbarui');
        ctx.refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });

  ctx.view.querySelectorAll('[data-wallet-restore]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api.restoreAccount(Number(button.dataset.walletRestore));
        toast('Dompet dipulihkan');
        invalidateBasics();
        ctx.refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

export async function budgetsPage(ctx) {
  const month = ctx.query.month || currentMonth();
  const [{ items }, { categories }] = await Promise.all([api.budgets(month), loadBasics()]);
  const previous = shiftMonth(month, -1);
  const totalLimit = items.reduce((sum, item) => sum + item.limit, 0);
  const totalSpent = items.reduce((sum, item) => sum + item.spent, 0);
  const percent = totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 100) : 0;
  const expenseCategories = categories.filter((category) => category.kind === 'expense' && !category.archived);

  ctx.view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Anggaran</p>
        <h1 class="page-title">Kendali belanja</h1>
        <p class="page-sub">Tetapkan batas pengeluaran per kategori setiap bulan.</p>
      </div>
      <div class="head-actions">
        ${monthNavHTML(month)}
        <button class="btn primary" data-add>${icon('plus')} Buat anggaran</button>
      </div>
    </div>

    ${
      items.length === 0
        ? `<section class="card">${emptyState({
            iconName: 'target',
            title: 'Belum ada anggaran bulan ini',
            description: 'Mulai dengan menetapkan batas untuk kategori yang paling sering kamu pakai.',
            action: `<button class="btn primary" data-add>${icon('plus')} Buat anggaran</button>`,
          })}</section>`
        : `<section class="card card-pad">
            <div class="row-between">
              <div>
                <p class="eyebrow">Total anggaran ${monthLabelShort(month)}</p>
                <div style="font-size:26px;font-weight:800;letter-spacing:-.03em;margin-top:4px">${fmtIDR(totalLimit)}</div>
                <p class="page-sub">Terpakai ${fmtIDR(totalSpent)} · sisa ${fmtIDR(Math.max(totalLimit - totalSpent, 0))}</p>
              </div>
              <span class="badge ${percent >= 100 ? 'red' : percent >= 80 ? 'amber' : 'green'}">${percent}% terpakai</span>
            </div>
            <div class="progress ${percent >= 100 ? 'over' : percent >= 80 ? 'warn' : ''} mt-16" style="height:10px">
              <span style="width:${Math.min(percent, 100)}%"></span>
            </div>
          </section>

          <section class="card mt-16">
            <div class="card-head">
              <div>
                <h2 class="section-title">Anggaran per kategori</h2>
                <p class="section-sub">${items.length} kategori dipantau</p>
              </div>
              <button class="btn ghost small" data-copy>${icon('refresh')} Salin bulan lalu</button>
            </div>
            <div class="card-body">
              <div class="budget-list">
                ${items
                  .map(
                    (item) => `<div data-budget-open="${item.id}" style="cursor:pointer">${budgetRowHTML(item)}</div>`,
                  )
                  .join('')}
              </div>
            </div>
          </section>`
    }`;

  const refresh = ctx.refresh;
  bindMonthNav(ctx.view, (next) => ctx.navigate('/anggaran', { month: next }));

  ctx.view.querySelectorAll('[data-add]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!expenseCategories.length) {
        toast('Tambah kategori pengeluaran dulu di Pengaturan', 'error');
        return;
      }
      openBudgetModal(ctx, { month, items, categories: expenseCategories, onSaved: refresh });
    });
  });

  ctx.view.querySelectorAll('[data-budget-open]').forEach((button) => {
    button.addEventListener('click', () => {
      const budget = items.find((item) => item.id === Number(button.dataset.budgetOpen));
      if (budget) openBudgetModal(ctx, { month, budget, items, categories: expenseCategories, onSaved: refresh });
    });
  });

  const copyButton = ctx.view.querySelector('[data-copy]');
  if (copyButton) {
    copyButton.addEventListener('click', async () => {
      try {
        const result = await api.copyBudgets(previous, month);
        toast(result.copied > 0 ? `${result.copied} anggaran disalin` : 'Tidak ada anggaran baru untuk disalin', result.copied > 0 ? 'success' : 'error');
        if (result.copied > 0) ctx.refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export async function settingsPage(ctx) {
  const [bot, { categories }] = await Promise.all([
    api.botStatus().catch(() => ({ enabled: false, running: false, connected: false })),
    loadBasics(true),
  ]);
  const theme = localStorage.getItem('dpk_theme') || 'system';
  const expenseCats = categories.filter((category) => category.kind === 'expense' && !category.archived);
  const incomeCats = categories.filter((category) => category.kind === 'income' && !category.archived);

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    window.navigator.standalone === true;
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isFirefox = /Firefox\/|FxiOS/i.test(ua);
  const canInstall = document.documentElement.dataset.canInstall === '1';
  const deviceLabel = isIOS ? 'iPhone/iPad' : isAndroid ? 'Android' : 'laptop';
  const installSteps = isIOS
    ? [
        'Buka Dompetku di Safari.',
        'Ketuk tombol Bagikan.',
        'Pilih “Tambahkan ke Layar Utama”, lalu ketuk “Tambah”.',
      ]
    : isAndroid
      ? [
          'Buka Dompetku di Chrome.',
          'Ketuk menu ⋮ di kanan atas.',
          'Pilih “Instal aplikasi” atau “Tambahkan ke layar utama”.',
        ]
      : isFirefox
        ? [
            'Firefox desktop belum mendukung pemasangan PWA.',
            'Buka Dompetku di Chrome atau Edge.',
            'Klik ikon instal di address bar, atau menu ⋮ → “Instal Dompetku”.',
          ]
        : [
            'Buka Dompetku di Chrome atau Edge.',
            'Klik ikon instal di address bar (ikon monitor dengan panah).',
            'Atau menu ⋮ → “Instal Dompetku”. Di Edge: menu … → Aplikasi → Instal situs ini.',
          ];

  const tokenForm = `
    <form class="mt-16" data-bot-token-form>
      <label class="label" for="bot-token">Token bot dari @BotFather</label>
      <input class="input" id="bot-token" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="123456789:AA..." />
      <p class="hint" style="margin:6px 0 10px">Tempel token dari @BotFather. Disimpan terenkripsi dan langsung aktif tanpa restart server.</p>
      <button class="btn primary small" type="submit" data-bot-save>Simpan &amp; hubungkan</button>
    </form>`;

  const botCard = `
    <section class="card card-pad">
      <div class="row-between">
        <div>
          <h2 class="section-title">Bot Telegram</h2>
          <p class="section-sub">Catat transaksi langsung dari chat.</p>
        </div>
        <span class="badge ${bot.connected ? 'green' : bot.enabled ? 'amber' : 'red'}">
          ${bot.connected ? 'Terhubung' : bot.enabled ? 'Menunggu' : 'Nonaktif'}
        </span>
      </div>
      ${
        bot.connected
          ? `<div class="setting-row mt-12">
              <span class="setting-icon">${icon('bot')}</span>
              <div class="setting-main">
                <div class="setting-title">${bot.username ? `@${esc(bot.username)}` : 'Bot aktif'}</div>
                <div class="setting-desc">Chat ${esc(bot.ownerChatId || '')} · ${bot.mode === 'webhook' ? 'webhook' : 'polling'}</div>
              </div>
            </div>
            <div class="row-between mt-16">
              <button class="btn ghost small" data-bot-test>Kirim pesan uji</button>
              <button class="btn danger small" data-bot-disconnect>Putuskan</button>
            </div>
            ${bot.username ? `<p class="hint mt-12">Buka <a class="link-btn" href="https://t.me/${esc(bot.username)}" target="_blank" rel="noopener">t.me/${esc(bot.username)}</a> — menu bot ada di kiri kolom chat.</p>` : ''}
            <details class="mt-16">
              <summary class="link-btn">Ganti token bot</summary>
              ${tokenForm}
            </details>`
          : `<div class="steps mt-12">
              <div class="step"><span class="step-num">1</span><span>Buat bot lewat <strong>@BotFather</strong> di Telegram, kirim <code>/newbot</code>, lalu salin token.</span></div>
              <div class="step"><span class="step-num">2</span><span>Tempel token di kolom bawah, lalu tekan <strong>Simpan &amp; hubungkan</strong>.</span></div>
              <div class="step"><span class="step-num">3</span><span>Buka bot kamu dan kirim <code>/start</code>. Chat langsung terhubung.</span></div>
            </div>
            ${bot.username ? `<p class="hint mt-12">Bot: <a class="link-btn" href="https://t.me/${esc(bot.username)}" target="_blank" rel="noopener">t.me/${esc(bot.username)}</a></p>` : ''}
            ${bot.enabled ? `<button class="btn ghost small mt-12" data-bot-test>Kirim pesan uji</button>` : ''}
            ${tokenForm}`
      }
    </section>`;

  ctx.view.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Pengaturan</p>
        <h1 class="page-title">Preferensi</h1>
        <p class="page-sub">Kelola integrasi, tampilan, data, dan kategori.</p>
      </div>
    </div>

    <div class="settings-grid">
      ${botCard}

      <section class="card card-pad">
        <h2 class="section-title">Tampilan</h2>
        <p class="section-sub">Pilih tema yang paling nyaman.</p>
        <div class="theme-seg mt-16">
          <button data-theme-set="light" class="${theme === 'light' ? 'active' : ''}">Terang</button>
          <button data-theme-set="dark" class="${theme === 'dark' ? 'active' : ''}">Gelap</button>
          <button data-theme-set="system" class="${theme === 'system' ? 'active' : ''}">Ikuti sistem</button>
        </div>
        <div class="divider"></div>
        <div class="setting-row">
          <span class="setting-icon">${icon('smartphone')}</span>
          <div class="setting-main">
            <div class="setting-title">Pasang di HP & laptop</div>
            <div class="setting-desc">${
              standalone
                ? 'Dompetku sudah berjalan sebagai aplikasi.'
                : `Buka layar penuh tanpa browser di ${deviceLabel}.`
            }</div>
          </div>
          ${
            standalone
              ? '<span class="badge green">Terpasang</span>'
              : `<button class="btn ${canInstall ? 'soft' : 'ghost'} small" data-install>${canInstall ? 'Pasang' : 'Cara pasang'}</button>`
          }
        </div>
        ${
          standalone
            ? ''
            : `<details class="install-help">
                <summary>Langkah memasang di ${deviceLabel}</summary>
                <ol>${installSteps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>
                ${isIOS ? '<p class="hint">Di iPhone/iPad wajib lewat Safari; Chrome belum bisa memasang PWA.</p>' : ''}
                <p class="hint">Tombol pasang muncul otomatis jika situs dibuka lewat HTTPS.</p>
              </details>`
        }
        <div class="setting-row">
          <span class="setting-icon">${icon('shield')}</span>
          <div class="setting-main">
            <div class="setting-title">Sesi aman</div>
            <div class="setting-desc">Akses dashboard memakai kode akses pribadi.</div>
          </div>
          <button class="btn danger small" data-logout>Keluar</button>
        </div>
      </section>

      <section class="card card-pad">
        <h2 class="section-title">Ekspor data</h2>
        <p class="section-sub">Cadangkan atau olah datamu di spreadsheet.</p>
        <div class="setting-row mt-12">
          <span class="setting-icon">${icon('file')}</span>
          <div class="setting-main">
            <div class="setting-title">Excel (.xlsx)</div>
            <div class="setting-desc">Transaksi + ringkasan per kategori.</div>
          </div>
          <a class="btn ghost small" href="/api/export/xlsx" download>Unduh</a>
        </div>
        <div class="setting-row">
          <span class="setting-icon">${icon('download')}</span>
          <div class="setting-main">
            <div class="setting-title">CSV</div>
            <div class="setting-desc">Kompatibel dengan Excel & Google Sheets.</div>
          </div>
          <a class="btn ghost small" href="/api/export/csv" download>Unduh</a>
        </div>
        <div class="setting-row">
          <span class="setting-icon">${icon('shield')}</span>
          <div class="setting-main">
            <div class="setting-title">Backup lengkap</div>
            <div class="setting-desc">Semua data dalam satu berkas JSON.</div>
          </div>
          <a class="btn ghost small" href="/api/backup" download>Unduh</a>
        </div>
      </section>
    </div>

    <section class="card card-pad mt-16">
      <div class="row-between">
        <div>
          <h2 class="section-title">Kategori</h2>
          <p class="section-sub">Kata kunci dipakai bot untuk menebak kategori otomatis.</p>
        </div>
        <button class="btn soft small" data-category-add="expense">${icon('plus')} Kategori baru</button>
      </div>

      <div class="mt-20">
        <p class="eyebrow" style="margin-bottom:6px">Pengeluaran</p>
        ${expenseCats
          .map(
            (category) => `<button type="button" class="setting-row" data-category-edit="${category.id}" style="width:100%;text-align:left">
              <span class="setting-icon" style="color:${esc(category.color)};background:color-mix(in srgb, ${esc(category.color)} 14%, transparent)">${icon(category.icon)}</span>
              <span class="setting-main">
                <span class="setting-title">${esc(category.name)}</span>
                <span class="setting-desc">${category.keywords.length ? esc(category.keywords.slice(0, 4).join(', ')) : 'Belum ada kata kunci'}</span>
              </span>
              ${icon('chevron-right')}
            </button>`,
          )
          .join('')}
      </div>

      <div class="mt-20">
        <div class="row-between">
          <p class="eyebrow" style="margin-bottom:6px">Pemasukan</p>
          <button class="link-btn" data-category-add="income">Tambah ${icon('plus')}</button>
        </div>
        ${incomeCats
          .map(
            (category) => `<button type="button" class="setting-row" data-category-edit="${category.id}" style="width:100%;text-align:left">
              <span class="setting-icon" style="color:${esc(category.color)};background:color-mix(in srgb, ${esc(category.color)} 14%, transparent)">${icon(category.icon)}</span>
              <span class="setting-main">
                <span class="setting-title">${esc(category.name)}</span>
                <span class="setting-desc">${category.keywords.length ? esc(category.keywords.slice(0, 4).join(', ')) : 'Belum ada kata kunci'}</span>
              </span>
              ${icon('chevron-right')}
            </button>`,
          )
          .join('')}
      </div>
    </section>

    <p class="login-note">Dompetku · PWA + Bot Telegram · Data pribadi kamu tidak dibagikan ke pihak lain.</p>`;

  // theme
  ctx.view.querySelectorAll('[data-theme-set]').forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.dataset.themeSet;
      window.dispatchEvent(new CustomEvent('dompetku:theme', { detail: value }));
      ctx.view.querySelectorAll('[data-theme-set]').forEach((el) => el.classList.toggle('active', el === button));
    });
  });

  const installButton = ctx.view.querySelector('[data-install]');
  installButton?.addEventListener('click', () => {
    if (document.documentElement.dataset.canInstall === '1') {
      window.dispatchEvent(new CustomEvent('dompetku:install'));
      return;
    }
    const help = ctx.view.querySelector('.install-help');
    if (help) {
      help.open = true;
      help.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      window.dispatchEvent(new CustomEvent('dompetku:install'));
    }
  });

  ctx.view.querySelector('[data-logout]').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('dompetku:logout'));
  });

  const testButton = ctx.view.querySelector('[data-bot-test]');
  if (testButton) {
    testButton.addEventListener('click', async () => {
      try {
        setButtonBusy(testButton, true, 'Mengirim…');
        await api.botTest();
        toast('Pesan uji terkirim ke Telegram');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setButtonBusy(testButton, false);
      }
    });
  }

  const disconnectButton = ctx.view.querySelector('[data-bot-disconnect]');
  if (disconnectButton) {
    disconnectButton.addEventListener('click', async () => {
      const ok = await confirmAction({
        title: 'Putuskan bot?',
        message: 'Chat Telegram tidak bisa lagi mencatat transaksi sampai kamu mengirim /start ke bot lagi.',
        confirmText: 'Putuskan',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.botDisconnect();
        toast('Bot diputuskan');
        ctx.refresh();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  ctx.view.querySelectorAll('[data-bot-token-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = form.querySelector('#bot-token');
      const button = form.querySelector('[data-bot-save]');
      const token = input.value.trim();
      if (!token) {
        toast('Tempel token bot dulu', 'error');
        input.focus();
        return;
      }
      try {
        setButtonBusy(button, true, 'Menghubungkan…');
        const result = await api.botToken(token);
        input.value = '';
        toast(result.username ? `Bot @${result.username} terhubung` : 'Bot terhubung');
        ctx.refresh();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setButtonBusy(button, false);
      }
    });
  });

  ctx.view.querySelectorAll('[data-category-add]').forEach((button) => {
    button.addEventListener('click', () =>
      openCategoryModal(ctx, null, { defaultKind: button.dataset.categoryAdd, onSaved: ctx.refresh }),
    );
  });

  ctx.view.querySelectorAll('[data-category-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const category = categories.find((item) => item.id === Number(button.dataset.categoryEdit));
      if (category) openCategoryModal(ctx, category, { onSaved: ctx.refresh });
    });
  });
}

/* ------------------------------------------------------------------ */
/* Transaction modal                                                   */
/* ------------------------------------------------------------------ */

export async function openTransactionModal(ctx, tx = null, options = {}) {
  const { accounts, categories } = await loadBasics(true);
  const activeAccounts = accounts.filter((account) => !account.archived);
  if (!activeAccounts.length) {
    toast('Tambahkan dompet dulu di menu Dompet', 'error');
    return;
  }
  const usableCategories = categories.filter((category) => !category.archived);

  let kind = tx?.kind || options.initialKind || 'expense';
  let accountId = tx?.accountId || activeAccounts[0].id;
  let toAccountId =
    tx?.toAccountId || activeAccounts.find((account) => account.id !== accountId)?.id || null;
  let categoryId =
    tx?.categoryId ||
    (kind !== 'transfer' ? usableCategories.find((category) => category.kind === kind)?.id : null) ||
    null;
  let occurredOn = tx?.occurredOn || todayISO();
  let note = tx?.note || '';

  const accountOptions = (selectedId) =>
    activeAccounts
      .map(
        (account) =>
          `<option value="${account.id}" ${account.id === selectedId ? 'selected' : ''}>${esc(account.name)}</option>`,
      )
      .join('');

  const body = `
    <div class="segment" id="tx-kind">
      <button type="button" data-kind-btn="expense" data-kind="expense">Pengeluaran</button>
      <button type="button" data-kind-btn="income" data-kind="income">Pemasukan</button>
      <button type="button" data-kind-btn="transfer" data-kind="transfer">Transfer</button>
    </div>

    <div class="field mt-16">
      <label class="label" for="tx-amount">Jumlah</label>
      <div class="amount-field">
        <span>Rp</span>
        <input id="tx-amount" inputmode="numeric" autocomplete="off" placeholder="0" aria-label="Jumlah transaksi" />
      </div>
    </div>

    <div class="field" id="category-section">
      <span class="label">Kategori</span>
      <div class="chips" id="tx-categories"></div>
    </div>

    <div class="field-row">
      <div class="field">
        <label class="label" for="tx-account">Dompet</label>
        <select class="select" id="tx-account">${accountOptions(accountId)}</select>
      </div>
      <div class="field hidden" id="to-account-field">
        <label class="label" for="tx-to-account">Dompet tujuan</label>
        <select class="select" id="tx-to-account">${accountOptions(toAccountId)}</select>
      </div>
    </div>

    <div class="field-row">
      <div class="field">
        <label class="label" for="tx-date">Tanggal</label>
        <input type="date" class="input" id="tx-date" value="${occurredOn}" />
      </div>
      <div class="field">
        <label class="label" for="tx-note">Catatan</label>
        <input class="input" id="tx-note" maxlength="280" placeholder="mis. makan siang" value="${esc(note)}" />
      </div>
    </div>

    <p class="hint">Tip: transaksi dari Telegram otomatis masuk ke dashboard ini.</p>`;

  const footer = tx
    ? `<button class="btn danger" data-delete type="button">${icon('trash')} Hapus</button>
       <span class="grow"></span>
       <button class="btn ghost" data-cancel type="button">Batal</button>
       <button class="btn primary" data-save type="button">Simpan</button>`
    : `<button class="btn ghost grow" data-cancel type="button">Batal</button>
       <button class="btn primary" data-save type="button">Simpan</button>`;

  openModal({
    title: tx ? 'Ubah transaksi' : 'Catat transaksi',
    body,
    footer,
    onMount(modal, close) {
      const amount = mountMoneyInput(modal.querySelector('#tx-amount'));
      if (tx) amount.set(tx.amount);

      const toField = modal.querySelector('#to-account-field');
      const categorySection = modal.querySelector('#category-section');
      const toSelect = modal.querySelector('#tx-to-account');
      const accountSelect = modal.querySelector('#tx-account');

      const renderCategories = () => {
        const wrap = modal.querySelector('#tx-categories');
        const list = usableCategories.filter((category) => category.kind === kind);
        wrap.innerHTML =
          `<button type="button" class="chip ${categoryId === null ? 'active' : ''}" data-cat="">${icon('tag')}<span>Tanpa kategori</span></button>` +
          list
            .map(
              (category) =>
                `<button type="button" class="chip ${categoryId === category.id ? 'active' : ''}" data-cat="${category.id}">${icon(category.icon)}<span>${esc(category.name)}</span></button>`,
            )
            .join('');
        wrap.querySelectorAll('[data-cat]').forEach((chip) => {
          chip.addEventListener('click', () => {
            categoryId = chip.dataset.cat ? Number(chip.dataset.cat) : null;
            renderCategories();
          });
        });
      };

      const syncToOptions = () => {
        toSelect.innerHTML = activeAccounts
          .filter((account) => account.id !== accountId)
          .map(
            (account) =>
              `<option value="${account.id}" ${account.id === toAccountId ? 'selected' : ''}>${esc(account.name)}</option>`,
          )
          .join('');
        if (![...toSelect.options].length) {
          toAccountId = null;
        } else if (!toAccountId || ![...toSelect.options].some((option) => Number(option.value) === toAccountId)) {
          toAccountId = Number(toSelect.options[0].value);
        }
        toSelect.value = String(toAccountId);
      };

      const sync = () => {
        modal.querySelectorAll('[data-kind-btn]').forEach((button) => {
          button.classList.toggle('active', button.dataset.kindBtn === kind);
        });
        categorySection.classList.toggle('hidden', kind === 'transfer');
        toField.classList.toggle('hidden', kind !== 'transfer');
        if (kind === 'transfer') {
          syncToOptions();
        } else if (!usableCategories.some((category) => category.kind === kind && category.id === categoryId)) {
          categoryId = usableCategories.find((category) => category.kind === kind)?.id ?? null;
        }
        renderCategories();
      };

      modal.querySelectorAll('[data-kind-btn]').forEach((button) => {
        button.addEventListener('click', () => {
          kind = button.dataset.kindBtn;
          sync();
        });
      });

      accountSelect.addEventListener('change', () => {
        accountId = Number(accountSelect.value);
        sync();
      });

      toSelect.addEventListener('change', () => {
        toAccountId = Number(toSelect.value);
      });

      modal.querySelector('#tx-date').addEventListener('change', (event) => {
        occurredOn = event.target.value || todayISO();
      });
      modal.querySelector('#tx-note').addEventListener('input', (event) => {
        note = event.target.value;
      });

      modal.querySelector('[data-cancel]').addEventListener('click', close);

      const saveButton = modal.querySelector('[data-save]');
      saveButton.addEventListener('click', async () => {
        const value = amount.value();
        if (!value || value <= 0) {
          showModalError(modal, 'Jumlah harus lebih dari 0.');
          return;
        }
        if (kind === 'transfer' && !toAccountId) {
          showModalError(modal, 'Pilih dompet tujuan transfer.');
          return;
        }
        const payload = {
          kind,
          amount: value,
          accountId,
          toAccountId: kind === 'transfer' ? toAccountId : null,
          categoryId: kind === 'transfer' ? null : categoryId,
          occurredOn: modal.querySelector('#tx-date').value || todayISO(),
          note: modal.querySelector('#tx-note').value.trim(),
        };
        try {
          setButtonBusy(saveButton, true, 'Menyimpan…');
          if (tx) await api.updateTransaction(tx.id, payload);
          else await api.createTransaction(payload);
          toast(tx ? 'Transaksi diperbarui' : 'Transaksi tersimpan');
          invalidateBasics();
          close();
          if (options.onSaved) options.onSaved();
        } catch (error) {
          showModalError(modal, error.message);
          setButtonBusy(saveButton, false);
        }
      });

      const deleteButton = modal.querySelector('[data-delete]');
      if (deleteButton) {
        deleteButton.addEventListener('click', async () => {
          const ok = await confirmAction({
            title: 'Hapus transaksi?',
            message: 'Transaksi akan dihapus permanen dan saldo dompet ikut menyesuaikan.',
            confirmText: 'Hapus',
            danger: true,
          });
          if (!ok) return;
          try {
            await api.deleteTransaction(tx.id);
            toast('Transaksi dihapus');
            invalidateBasics();
            close();
            if (options.onSaved) options.onSaved();
          } catch (error) {
            showModalError(modal, error.message);
          }
        });
      }

      sync();
    },
  });
}

/* ------------------------------------------------------------------ */
/* Wallet modal                                                        */
/* ------------------------------------------------------------------ */

export async function openWalletModal(ctx, account = null, options = {}) {
  let iconKey = account?.icon || 'wallet';
  let color = account?.color || COLORS[0];

  const body = `
    <div class="field">
      <label class="label" for="wallet-name">Nama dompet</label>
      <input class="input" id="wallet-name" maxlength="40" placeholder="mis. BCA, GoPay, Tunai" value="${esc(account?.name || '')}" />
    </div>
    <div class="field">
      <label class="label" for="wallet-type">Jenis</label>
      <select class="select" id="wallet-type">
        <option value="cash" ${account?.type === 'cash' ? 'selected' : ''}>Tunai</option>
        <option value="bank" ${account?.type === 'bank' ? 'selected' : ''}>Rekening bank</option>
        <option value="ewallet" ${account?.type === 'ewallet' ? 'selected' : ''}>E-wallet</option>
        <option value="other" ${account?.type === 'other' ? 'selected' : ''}>Lainnya</option>
      </select>
    </div>
    <div class="field">
      <label class="label" for="wallet-initial">Saldo awal</label>
      <div class="amount-field" style="padding:10px 14px">
        <span style="font-size:16px">Rp</span>
        <input id="wallet-initial" inputmode="numeric" autocomplete="off" placeholder="0" style="font-size:20px" />
      </div>
      <p class="hint">Isi saldo saat ini untuk dompet baru. Untuk dompet lama, ubah hanya bila perlu.</p>
    </div>
    <div class="field">
      <span class="label">Ikon</span>
      <div class="icon-picker" id="icon-picker">
        ${ACCOUNT_ICONS.map(
          (name) =>
            `<button type="button" class="icon-pick ${name === iconKey ? 'active' : ''}" data-icon="${name}" aria-label="Ikon ${name}">${icon(name)}</button>`,
        ).join('')}
      </div>
    </div>
    <div class="field">
      <span class="label">Warna</span>
      <div class="swatch-row" id="color-picker">
        ${COLORS.map(
          (value) =>
            `<button type="button" class="swatch ${value === color ? 'active' : ''}" data-color="${value}" style="background:${value}" aria-label="Warna ${value}"></button>`,
        ).join('')}
      </div>
    </div>`;

  const footer = account
    ? `<button class="btn danger" data-archive type="button">${icon('trash')} Arsipkan</button>
       <span class="grow"></span>
       <button class="btn ghost" data-cancel type="button">Batal</button>
       <button class="btn primary" data-save type="button">Simpan</button>`
    : `<button class="btn ghost grow" data-cancel type="button">Batal</button>
       <button class="btn primary" data-save type="button">Tambah dompet</button>`;

  openModal({
    title: account ? 'Ubah dompet' : 'Dompet baru',
    body,
    footer,
    onMount(modal, close) {
      const initial = mountMoneyInput(modal.querySelector('#wallet-initial'));
      if (account) initial.set(account.initialBalance);

      modal.querySelectorAll('[data-icon]').forEach((button) => {
        button.addEventListener('click', () => {
          iconKey = button.dataset.icon;
          modal.querySelectorAll('[data-icon]').forEach((el) => el.classList.toggle('active', el === button));
        });
      });

      modal.querySelectorAll('[data-color]').forEach((button) => {
        button.addEventListener('click', () => {
          color = button.dataset.color;
          modal.querySelectorAll('[data-color]').forEach((el) => el.classList.toggle('active', el === button));
        });
      });

      modal.querySelector('[data-cancel]').addEventListener('click', close);

      const saveButton = modal.querySelector('[data-save]');
      saveButton.addEventListener('click', async () => {
        const name = modal.querySelector('#wallet-name').value.trim();
        if (!name) {
          showModalError(modal, 'Nama dompet wajib diisi.');
          return;
        }
        const payload = {
          name,
          type: modal.querySelector('#wallet-type').value,
          initialBalance: initial.value(),
          icon: iconKey,
          color,
        };
        try {
          setButtonBusy(saveButton, true);
          if (account) await api.updateAccount(account.id, payload);
          else await api.createAccount(payload);
          toast(account ? 'Dompet diperbarui' : 'Dompet ditambahkan');
          invalidateBasics();
          close();
          if (options.onSaved) options.onSaved();
        } catch (error) {
          showModalError(modal, error.message);
          setButtonBusy(saveButton, false);
        }
      });

      const archiveButton = modal.querySelector('[data-archive]');
      if (archiveButton) {
        archiveButton.addEventListener('click', async () => {
          const ok = await confirmAction({
            title: 'Arsipkan dompet?',
            message: 'Dompet disembunyikan dari daftar, tetapi semua transaksinya tetap tersimpan.',
            confirmText: 'Arsipkan',
            danger: true,
          });
          if (!ok) return;
          try {
            await api.archiveAccount(account.id);
            toast('Dompet diarsipkan');
            invalidateBasics();
            close();
            if (options.onSaved) options.onSaved();
          } catch (error) {
            showModalError(modal, error.message);
          }
        });
      }
    },
  });
}

/* ------------------------------------------------------------------ */
/* Budget modal                                                        */
/* ------------------------------------------------------------------ */

export async function openBudgetModal(ctx, { month, budget = null, items = [], categories, onSaved }) {
  const used = new Set(items.map((item) => item.categoryId));
  const available = categories.filter((category) => !used.has(category.id) || category.id === budget?.categoryId);

  if (!budget && available.length === 0) {
    toast('Semua kategori pengeluaran sudah punya anggaran bulan ini', 'error');
    return;
  }

  const body = `
    <div class="field">
      <label class="label" for="budget-category">Kategori</label>
      <select class="select" id="budget-category" ${budget ? 'disabled' : ''}>
        ${available
          .map(
            (category) =>
              `<option value="${category.id}" ${category.id === budget?.categoryId ? 'selected' : ''}>${esc(category.name)}</option>`,
          )
          .join('')}
      </select>
    </div>
    <div class="field">
      <label class="label" for="budget-amount">Batas bulanan</label>
      <div class="amount-field" style="padding:12px 14px">
        <span style="font-size:17px">Rp</span>
        <input id="budget-amount" inputmode="numeric" autocomplete="off" placeholder="0" style="font-size:23px" />
      </div>
      <p class="hint">Berlaku untuk ${monthLabel(month)}. Kamu bisa menyalin anggaran ke bulan berikutnya.</p>
    </div>`;

  const footer = budget
    ? `<button class="btn danger" data-delete type="button">${icon('trash')} Hapus</button>
       <span class="grow"></span>
       <button class="btn ghost" data-cancel type="button">Batal</button>
       <button class="btn primary" data-save type="button">Simpan</button>`
    : `<button class="btn ghost grow" data-cancel type="button">Batal</button>
       <button class="btn primary" data-save type="button">Simpan</button>`;

  openModal({
    title: budget ? 'Ubah anggaran' : 'Anggaran baru',
    body,
    footer,
    onMount(modal, close) {
      const amount = mountMoneyInput(modal.querySelector('#budget-amount'));
      if (budget) amount.set(budget.limit);

      modal.querySelector('[data-cancel]').addEventListener('click', close);

      const saveButton = modal.querySelector('[data-save]');
      saveButton.addEventListener('click', async () => {
        const value = amount.value();
        if (!value || value <= 0) {
          showModalError(modal, 'Batas anggaran harus lebih dari 0.');
          return;
        }
        try {
          setButtonBusy(saveButton, true);
          await api.saveBudget({
            categoryId: budget ? budget.categoryId : Number(modal.querySelector('#budget-category').value),
            month,
            amount: value,
          });
          toast('Anggaran disimpan');
          close();
          if (onSaved) onSaved();
        } catch (error) {
          showModalError(modal, error.message);
          setButtonBusy(saveButton, false);
        }
      });

      const deleteButton = modal.querySelector('[data-delete]');
      if (deleteButton) {
        deleteButton.addEventListener('click', async () => {
          const ok = await confirmAction({
            title: 'Hapus anggaran?',
            message: 'Batas anggaran kategori ini akan dihapus untuk bulan tersebut.',
            confirmText: 'Hapus',
            danger: true,
          });
          if (!ok) return;
          try {
            await api.deleteBudget(budget.id);
            toast('Anggaran dihapus');
            close();
            if (onSaved) onSaved();
          } catch (error) {
            showModalError(modal, error.message);
          }
        });
      }
    },
  });
}

/* ------------------------------------------------------------------ */
/* Category modal                                                      */
/* ------------------------------------------------------------------ */

export async function openCategoryModal(ctx, category = null, options = {}) {
  let iconKey = category?.icon || 'tag';
  let color = category?.color || COLORS[0];

  const body = `
    <div class="field">
      <label class="label" for="category-name">Nama kategori</label>
      <input class="input" id="category-name" maxlength="40" placeholder="mis. Kopi & Camilan" value="${esc(category?.name || '')}" />
    </div>
    ${
      category
        ? ''
        : `<div class="field">
            <label class="label" for="category-kind">Jenis</label>
            <select class="select" id="category-kind">
              <option value="expense" ${options.defaultKind !== 'income' ? 'selected' : ''}>Pengeluaran</option>
              <option value="income" ${options.defaultKind === 'income' ? 'selected' : ''}>Pemasukan</option>
            </select>
          </div>`
    }
    <div class="field">
      <span class="label">Ikon</span>
      <div class="icon-picker" id="icon-picker">
        ${CATEGORY_ICONS.map(
          (name) =>
            `<button type="button" class="icon-pick ${name === iconKey ? 'active' : ''}" data-icon="${name}" aria-label="Ikon ${name}">${icon(name)}</button>`,
        ).join('')}
      </div>
    </div>
    <div class="field">
      <span class="label">Warna</span>
      <div class="swatch-row">
        ${COLORS.map(
          (value) =>
            `<button type="button" class="swatch ${value === color ? 'active' : ''}" data-color="${value}" style="background:${value}" aria-label="Warna ${value}"></button>`,
        ).join('')}
      </div>
    </div>
    <div class="field">
      <label class="label" for="category-keywords">Kata kunci bot</label>
      <input class="input" id="category-keywords" placeholder="kopi, teh, camilan" value="${esc((category?.keywords || []).join(', '))}" />
      <p class="hint">Pisahkan dengan koma. Bot memakai kata kunci ini untuk menebak kategori dari chat.</p>
    </div>`;

  const footer = category
    ? `<button class="btn danger" data-archive type="button">${icon('trash')} Arsipkan</button>
       <span class="grow"></span>
       <button class="btn ghost" data-cancel type="button">Batal</button>
       <button class="btn primary" data-save type="button">Simpan</button>`
    : `<button class="btn ghost grow" data-cancel type="button">Batal</button>
       <button class="btn primary" data-save type="button">Tambah kategori</button>`;

  openModal({
    title: category ? 'Ubah kategori' : 'Kategori baru',
    body,
    footer,
    onMount(modal, close) {
      modal.querySelectorAll('[data-icon]').forEach((button) => {
        button.addEventListener('click', () => {
          iconKey = button.dataset.icon;
          modal.querySelectorAll('[data-icon]').forEach((el) => el.classList.toggle('active', el === button));
        });
      });

      modal.querySelectorAll('[data-color]').forEach((button) => {
        button.addEventListener('click', () => {
          color = button.dataset.color;
          modal.querySelectorAll('[data-color]').forEach((el) => el.classList.toggle('active', el === button));
        });
      });

      modal.querySelector('[data-cancel]').addEventListener('click', close);

      const saveButton = modal.querySelector('[data-save]');
      saveButton.addEventListener('click', async () => {
        const name = modal.querySelector('#category-name').value.trim();
        if (!name) {
          showModalError(modal, 'Nama kategori wajib diisi.');
          return;
        }
        const keywords = modal
          .querySelector('#category-keywords')
          .value.split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        const payload = { name, icon: iconKey, color, keywords };
        if (!category) payload.kind = modal.querySelector('#category-kind').value;

        try {
          setButtonBusy(saveButton, true);
          if (category) await api.updateCategory(category.id, payload);
          else await api.createCategory(payload);
          toast(category ? 'Kategori diperbarui' : 'Kategori ditambahkan');
          invalidateBasics();
          close();
          if (options.onSaved) options.onSaved();
        } catch (error) {
          showModalError(modal, error.message);
          setButtonBusy(saveButton, false);
        }
      });

      const archiveButton = modal.querySelector('[data-archive]');
      if (archiveButton) {
        archiveButton.addEventListener('click', async () => {
          const ok = await confirmAction({
            title: 'Arsipkan kategori?',
            message: 'Kategori tidak akan muncul di pilihan baru, tetapi transaksi lama tetap utuh.',
            confirmText: 'Arsipkan',
            danger: true,
          });
          if (!ok) return;
          try {
            await api.archiveCategory(category.id);
            toast('Kategori diarsipkan');
            invalidateBasics();
            close();
            if (options.onSaved) options.onSaved();
          } catch (error) {
            showModalError(modal, error.message);
          }
        });
      }
    },
  });
}
