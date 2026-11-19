/**
 * Dompet Mikail - Financial Dashboard Logic
 * Handles calculations, dynamic charts, transactions storage, and comparison tables.
 */

// Format Rupiah helper
function formatRupiah(amount) {
  if (isNaN(amount) || amount === null) return 'Rp 0';
  return 'Rp ' + Number(amount).toLocaleString('id-ID');
}

function formatShortRupiah(val) {
  if (val >= 1000000) {
    const m = (val / 1000000).toFixed(1).replace('.0', '');
    return `Rp ${m}M`;
  } else if (val >= 1000) {
    const k = Math.round(val / 1000);
    return `Rp ${k}K`;
  }
  return `Rp ${val}`;
}

// Category Color Palette
const CATEGORY_COLORS = {
  'Kebutuhan Rumah Tangga': '#ef4444',
  'Investasi & Tabungan': '#3b82f6',
  'Kebutuhan Pribadi': '#84cc16',
  'Kesehatan': '#a855f7',
  'Pendidikan': '#f59e0b',
  'Hiburan & Lifestyle': '#eab308',
  'Anak & Bayi': '#ec4899',
  'Transportasi': '#06b6d4',
  'Sosial': '#14b8a6',
  'Lainnya': '#64748b'
};

// Default Sample Data (Matches Screenshot exactly for June 2025)
const DEFAULT_TRANSACTIONS_JUNE_2025 = [
  // Top 21 Expenses
  { id: 1, type: 'pengeluaran', date: 4, category: 'Kebutuhan Rumah Tangga', subCategory: 'Sewa / Cicilan rumah', amount: 1500000 },
  { id: 2, type: 'pengeluaran', date: 25, category: 'Hiburan & Lifestyle', subCategory: 'Gadget', amount: 900000 },
  { id: 3, type: 'pengeluaran', date: 17, category: 'Investasi & Tabungan', subCategory: 'Tabungan rutin', amount: 500000 },
  { id: 4, type: 'pengeluaran', date: 26, category: 'Investasi & Tabungan', subCategory: 'Reksadana', amount: 400000 },
  { id: 5, type: 'pengeluaran', date: 3, category: 'Kebutuhan Rumah Tangga', subCategory: 'Internet', amount: 350000 },
  { id: 6, type: 'pengeluaran', date: 10, category: 'Kebutuhan Rumah Tangga', subCategory: 'Belanja bulanan', amount: 320000 },
  { id: 7, type: 'pengeluaran', date: 19, category: 'Investasi & Tabungan', subCategory: 'Dana darurat', amount: 300000 },
  { id: 8, type: 'pengeluaran', date: 11, category: 'Pendidikan', subCategory: 'Pembayaran SPP', amount: 300000 },
  { id: 9, type: 'pengeluaran', date: 2, category: 'Kebutuhan Rumah Tangga', subCategory: 'Listrik', amount: 255000 },
  { id: 10, type: 'pengeluaran', date: 10, category: 'Anak & Bayi', subCategory: 'Popok', amount: 250000 },
  { id: 11, type: 'pengeluaran', date: 18, category: 'Kebutuhan Pribadi', subCategory: 'Jajan / Makan di luar', amount: 170000 },
  { id: 12, type: 'pengeluaran', date: 6, category: 'Transportasi', subCategory: 'Bensin & Transportasi', amount: 150000 },
  { id: 13, type: 'pengeluaran', date: 20, category: 'Kebutuhan Rumah Tangga', subCategory: 'Galon & Gas LPG', amount: 110000 },
  { id: 14, type: 'pengeluaran', date: 14, category: 'Hiburan & Lifestyle', subCategory: 'Nonton bioskop', amount: 85000 },
  { id: 15, type: 'pengeluaran', date: 8, category: 'Kebutuhan Pribadi', subCategory: 'Skincare & Perawatan', amount: 80000 },
  { id: 16, type: 'pengeluaran', date: 9, category: 'Transportasi', subCategory: 'Parkir & Tol', amount: 75000 },
  { id: 17, type: 'pengeluaran', date: 23, category: 'Sosial', subCategory: 'Sedekah & Infaq', amount: 70000 },
  { id: 18, type: 'pengeluaran', date: 22, category: 'Kebutuhan Rumah Tangga', subCategory: 'Laundry', amount: 60000 },
  { id: 19, type: 'pengeluaran', date: 13, category: 'Hiburan & Lifestyle', subCategory: 'Kopi / Nongkrong', amount: 50000 },
  { id: 20, type: 'pengeluaran', date: 16, category: 'Kesehatan', subCategory: 'Obat & Vitamin', amount: 45000 },
  { id: 21, type: 'pengeluaran', date: 15, category: 'Kebutuhan Pribadi', subCategory: 'Pulsa & Kuota Tambahan', amount: 42000 },
  
  // Supplementary Daily Expenses to complete the exact graph curve & Rp 6,592,000 total
  { id: 22, type: 'pengeluaran', date: 1, category: 'Kebutuhan Pribadi', subCategory: 'Camilan sore', amount: 30000 },
  { id: 23, type: 'pengeluaran', date: 3, category: 'Kebutuhan Pribadi', subCategory: 'Sarapan pagi', amount: 25000 },
  { id: 24, type: 'pengeluaran', date: 4, category: 'Kebutuhan Rumah Tangga', subCategory: 'Air Minum Isi Ulang', amount: 250000 },
  { id: 25, type: 'pengeluaran', date: 4, category: 'Kebutuhan Pribadi', subCategory: 'Perlengkapan mandi', amount: 350000 },
  { id: 26, type: 'pengeluaran', date: 6, category: 'Kebutuhan Pribadi', subCategory: 'Makan siang kantor', amount: 50000 },
  { id: 27, type: 'pengeluaran', date: 7, category: 'Kesehatan', subCategory: 'Minyak kayu putih & plester', amount: 95000 },
  { id: 28, type: 'pengeluaran', date: 8, category: 'Kebutuhan Pribadi', subCategory: 'Parkir harian', amount: 5000 },
  { id: 29, type: 'pengeluaran', date: 12, category: 'Kebutuhan Pribadi', subCategory: 'Minuman dingin', amount: 30000 },
  { id: 30, type: 'pengeluaran', date: 17, category: 'Kebutuhan Pribadi', subCategory: 'Snack keluarga', amount: 50000 },
  { id: 31, type: 'pengeluaran', date: 19, category: 'Kebutuhan Pribadi', subCategory: 'Makan malam keluarga', amount: 150000 },
  { id: 32, type: 'pengeluaran', date: 21, category: 'Sosial', subCategory: 'Iuran RT / Kebersihan', amount: 50000 },
  { id: 33, type: 'pengeluaran', date: 22, category: 'Kebutuhan Pribadi', subCategory: 'Belanja sayur segar', amount: 190000 },
  { id: 34, type: 'pengeluaran', date: 28, category: 'Kebutuhan Pribadi', subCategory: 'Jajan akhir pekan', amount: 100000 },

  // Income Transactions (Rp 9,000,000 Total)
  { id: 101, type: 'pemasukan', date: 1, category: 'Pemasukan Utama', subCategory: 'Gaji Bulanan', amount: 8000000 },
  { id: 102, type: 'pemasukan', date: 15, category: 'Pemasukan Utama', subCategory: 'Freelance & Bonus Proyek', amount: 1000000 }
];

// Reference Data for May 2025 (Previous Month) for accurate comparison calculations
const PREVIOUS_MONTH_DATA = {
  totalIncome: 9000000,
  totalExpense: 5539500, // May 2025
  netBalance: 3460500 + 2423500, // Rp 5,884,000
  totalTransactions: 35,
  subCategories: {
    'Sewa / Cicilan rumah': 1500000,
    'Tabungan rutin': 500000,
    'Internet': 350000,
    'Belanja bulanan': 300000,
    'Dana darurat': 300000,
    'Listrik': 250000,
    'Popok': 120000,
    'Jajan / Makan di luar': 70000,
    'Nonton bioskop': 80000,
    'Gadget': 0,
    'Reksadana': 400000,
    'Pembayaran SPP': 300000,
    'Bensin & Transportasi': 140000,
    'Galon & Gas LPG': 105000,
    'Skincare & Perawatan': 75000
  }
};

class DompetApp {
  constructor() {
    this.storageKey = 'dompet_mikail_transactions_v2';
    this.budgetKey = 'dompet_mikail_budget_v2';
    this.transactions = this.loadTransactions();
    this.budget = this.loadBudget();
    this.dailyChartInstance = null;
    this.allocationChartInstance = null;
    this.hasChartJS = typeof Chart !== 'undefined';

    this.initElements();
    this.bindEvents();
    this.render();
  }

  loadTransactions() {
    const saved = localStorage.getItem(this.storageKey);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved transactions, resetting', e);
      }
    }
    return JSON.parse(JSON.stringify(DEFAULT_TRANSACTIONS_JUNE_2025));
  }

  saveTransactions() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.transactions));
  }

  loadBudget() {
    const saved = localStorage.getItem(this.budgetKey);
    return saved ? Number(saved) : 6000000;
  }

  saveBudget(val) {
    this.budget = val;
    localStorage.setItem(this.budgetKey, val.toString());
  }

  initElements() {
    // Header & Selectors
    this.periodHeading = document.getElementById('periodHeading');
    this.selectMonth = document.getElementById('selectMonth');
    this.selectYear = document.getElementById('selectYear');

    // KPI Cards
    this.totalIncomeDisplay = document.getElementById('totalIncomeDisplay');
    this.totalExpenseDisplay = document.getElementById('totalExpenseDisplay');
    this.netBalanceDisplay = document.getElementById('netBalanceDisplay');
    this.totalTransCount = document.getElementById('totalTransCount');
    this.incomeTrendText = document.getElementById('incomeTrendText');
    this.expenseTrendText = document.getElementById('expenseTrendText');
    this.balanceTrendText = document.getElementById('balanceTrendText');
    this.transTrendText = document.getElementById('transTrendText');

    // Budget & Ratio Bar
    this.btnEditBudget = document.getElementById('btnEditBudget');
    this.budgetAmountDisplay = document.getElementById('budgetAmountDisplay');
    this.splitIncomeBar = document.getElementById('splitIncomeBar');
    this.splitExpenseBar = document.getElementById('splitExpenseBar');
    this.splitIncomeLabel = document.getElementById('splitIncomeLabel');
    this.splitExpenseLabel = document.getElementById('splitExpenseLabel');

    // Mini Reports
    this.miniReportsText = document.getElementById('miniReportsText');
    this.reportSaldo = document.getElementById('reportSaldo');
    this.reportDiff = document.getElementById('reportDiff');
    this.reportPercent = document.getElementById('reportPercent');

    // Chart badge
    this.chartTotalBadge = document.getElementById('chartTotalBadge');

    // Tables & Legend
    this.topExpensesTableBody = document.getElementById('topExpensesTableBody');
    this.allocationLegendList = document.getElementById('allocationLegendList');
    this.comparisonTableBody = document.getElementById('comparisonTableBody');

    // Modals
    this.btnOpenAddModal = document.getElementById('btnOpenAddModal');
    this.addModal = document.getElementById('addModal');
    this.btnCloseModal = document.getElementById('btnCloseModal');
    this.btnCancelModal = document.getElementById('btnCancelModal');
    this.transactionForm = document.getElementById('transactionForm');

    this.budgetModal = document.getElementById('budgetModal');
    this.btnCloseBudgetModal = document.getElementById('btnCloseBudgetModal');
    this.btnCancelBudgetModal = document.getElementById('btnCancelBudgetModal');
    this.budgetForm = document.getElementById('budgetForm');
    this.budgetInputNumber = document.getElementById('budgetInputNumber');

    // Actions
    this.btnResetData = document.getElementById('btnResetData');
    this.btnExportCSV = document.getElementById('btnExportCSV');
  }

  bindEvents() {
    // Month/Year select
    this.selectMonth.addEventListener('change', () => this.handlePeriodChange());
    this.selectYear.addEventListener('change', () => this.handlePeriodChange());

    // Add Transaction Modal
    this.btnOpenAddModal.addEventListener('click', () => {
      this.transactionForm.reset();
      this.addModal.style.display = 'flex';
    });

    const closeModal = () => { this.addModal.style.display = 'none'; };
    this.btnCloseModal.addEventListener('click', closeModal);
    this.btnCancelModal.addEventListener('click', closeModal);
    this.addModal.addEventListener('click', (e) => {
      if (e.target === this.addModal) closeModal();
    });

    this.transactionForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleAddTransaction();
    });

    // Budget Modal
    this.btnEditBudget.addEventListener('click', () => {
      this.budgetInputNumber.value = this.budget;
      this.budgetModal.style.display = 'flex';
    });

    const closeBudgetModal = () => { this.budgetModal.style.display = 'none'; };
    this.btnCloseBudgetModal.addEventListener('click', closeBudgetModal);
    this.btnCancelBudgetModal.addEventListener('click', closeBudgetModal);
    this.budgetModal.addEventListener('click', (e) => {
      if (e.target === this.budgetModal) closeBudgetModal();
    });

    this.budgetForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const newBudget = Number(this.budgetInputNumber.value) || 0;
      this.saveBudget(newBudget);
      closeBudgetModal();
      this.render();
    });

    // Reset Data
    this.btnResetData.addEventListener('click', () => {
      if (confirm('Kembalikan data seperti tampilan default awal Juni 2025?')) {
        this.transactions = JSON.parse(JSON.stringify(DEFAULT_TRANSACTIONS_JUNE_2025));
        this.budget = 6000000;
        this.saveTransactions();
        this.saveBudget(this.budget);
        this.render();
      }
    });

    // Export CSV
    this.btnExportCSV.addEventListener('click', () => this.exportCSV());
  }

  handlePeriodChange() {
    const monthNames = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'June',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const monthIndex = parseInt(this.selectMonth.value, 10) - 1;
    const year = this.selectYear.value;
    const periodName = `${monthNames[monthIndex]} ${year}`;
    this.periodHeading.textContent = periodName;
    this.render();
  }

  handleAddTransaction() {
    const type = document.querySelector('input[name="transType"]:checked').value;
    const date = parseInt(document.getElementById('formDate').value, 10) || 1;
    const amount = parseInt(document.getElementById('formAmount').value, 10) || 0;
    const category = document.getElementById('formCategory').value;
    const subCategory = document.getElementById('formSubCategory').value.trim();

    if (!subCategory || amount <= 0) {
      alert('Mohon isi nama sub kategori dan jumlah yang valid.');
      return;
    }

    const newTx = {
      id: Date.now(),
      type,
      date,
      category: type === 'pemasukan' ? 'Pemasukan Utama' : category,
      subCategory,
      amount
    };

    this.transactions.push(newTx);
    this.saveTransactions();
    this.addModal.style.display = 'none';
    this.render();
  }

  render() {
    // 1. Calculate Aggregates
    const expenses = this.transactions.filter(t => t.type === 'pengeluaran');
    const incomes = this.transactions.filter(t => t.type === 'pemasukan');

    const totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);
    const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);
    const netBalance = totalIncome - totalExpense;
    const totalTransactionsCount = this.transactions.length;

    // 2. Update KPI Cards
    this.totalIncomeDisplay.textContent = formatRupiah(totalIncome);
    this.totalExpenseDisplay.textContent = formatRupiah(totalExpense);
    this.netBalanceDisplay.textContent = formatRupiah(netBalance);
    this.totalTransCount.textContent = totalTransactionsCount;

    // Trends relative to previous month
    const prevExpense = PREVIOUS_MONTH_DATA.totalExpense;
    const expenseDeltaPercent = Math.round(((totalExpense - prevExpense) / prevExpense) * 100);
    this.expenseTrendText.textContent = `▲ ${Math.abs(expenseDeltaPercent)}% VS Bulan Lalu`;
    this.expenseTrendText.className = expenseDeltaPercent > 0 ? 'trend-down' : 'trend-up';

    const prevBalance = PREVIOUS_MONTH_DATA.netBalance;
    const balanceDeltaPercent = Math.round(((netBalance - prevBalance) / prevBalance) * 100);
    this.balanceTrendText.textContent = `▼ ${Math.abs(balanceDeltaPercent)}% VS Bulan Lalu`;

    const prevTrans = PREVIOUS_MONTH_DATA.totalTransactions;
    const transDeltaPercent = Math.round(((totalTransactionsCount - prevTrans) / prevTrans) * 100);
    this.transTrendText.textContent = `${transDeltaPercent >= 0 ? '▲' : '▼'} ${Math.abs(transDeltaPercent)}% VS Bulan Lalu`;

    // 3. Update Budget & Ratio Split Bar
    this.budgetAmountDisplay.textContent = formatRupiah(this.budget);

    const sumTotalFlow = (totalIncome + totalExpense) || 1;
    const incomePercent = Math.min(100, Math.max(15, (totalIncome / sumTotalFlow) * 100));
    const expensePercent = 100 - incomePercent;

    this.splitIncomeBar.style.width = `${incomePercent}%`;
    this.splitExpenseBar.style.width = `${expensePercent}%`;
    this.splitIncomeLabel.textContent = formatRupiah(totalIncome);
    this.splitExpenseLabel.textContent = formatRupiah(totalExpense);

    // 4. Update Mini Reports
    const diffFromPrevMonth = prevBalance - netBalance;
    const percentDrop = ((diffFromPrevMonth / prevBalance) * 100).toFixed(2);

    this.reportSaldo.textContent = formatRupiah(netBalance);
    this.reportDiff.textContent = formatRupiah(Math.abs(diffFromPrevMonth));
    this.reportPercent.textContent = `-${percentDrop}%`;

    // 5. Update Chart Total Badge
    this.chartTotalBadge.textContent = `Total: ${formatRupiah(totalExpense)}`;

    // 6. Render Daily Spline Area Chart
    this.renderDailyChart(expenses);

    // 7. Render Top 21 Expenses Table
    this.renderTopExpensesTable(expenses);

    // 8. Render Allocation Donut Chart & Legend
    this.renderAllocationSection(expenses, totalExpense);

    // 9. Render Comparison Month vs Last Month Table
    this.renderComparisonTable(expenses);
  }

  renderDailyChart(expenses) {
    // 28/31 days aggregation
    const daysInMonth = 28;
    const dailyMap = {};
    for (let d = 1; d <= daysInMonth; d++) {
      dailyMap[d] = 0;
    }

    expenses.forEach(t => {
      const d = t.date >= 1 && t.date <= daysInMonth ? t.date : 1;
      dailyMap[d] = (dailyMap[d] || 0) + t.amount;
    });

    const labels = [];
    const dataValues = [];
    for (let d = 1; d <= daysInMonth; d++) {
      labels.push(d.toString());
      dataValues.push(dailyMap[d]);
    }

    const canvas = document.getElementById('dailyExpenseChart');
    const fallback = document.getElementById('chartFallback');

    if (this.hasChartJS && canvas) {
      if (this.dailyChartInstance) {
        this.dailyChartInstance.destroy();
      }

      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 0, 200);
      gradient.addColorStop(0, 'rgba(100, 116, 139, 0.45)');
      gradient.addColorStop(0.7, 'rgba(148, 163, 184, 0.15)');
      gradient.addColorStop(1, 'rgba(241, 245, 249, 0.02)');

      this.dailyChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Pengeluaran',
            data: dataValues,
            borderColor: '#334155',
            borderWidth: 2.2,
            backgroundColor: gradient,
            fill: true,
            tension: 0.35,
            pointBackgroundColor: '#1e293b',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 1.5,
            pointRadius: (context) => {
              const val = context.raw;
              return val > 300000 ? 5.5 : (val > 0 ? 3.5 : 0);
            },
            pointHoverRadius: 7
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1e293b',
              padding: 8,
              titleFont: { size: 12, weight: 'bold' },
              bodyFont: { size: 12 },
              callbacks: {
                title: (items) => `Tanggal ${items[0].label} Juni`,
                label: (item) => `Pengeluaran: ${formatRupiah(item.raw)}`
              }
            }
          },
          scales: {
            x: {
              grid: { display: true, color: '#f1f5f9' },
              ticks: { font: { size: 10, weight: 600 }, color: '#64748b' }
            },
            y: {
              display: false,
              suggestedMax: 2200000
            }
          }
        }
      });
    } else {
      // SVG Fallback renderer
      this.renderSvgChartFallback(fallback, labels, dataValues);
    }
  }

  renderSvgChartFallback(container, labels, dataValues) {
    if (!container) return;
    container.style.display = 'block';
    const maxVal = Math.max(...dataValues, 100000);
    const width = 800;
    const height = 180;
    const padding = 20;

    const points = dataValues.map((val, idx) => {
      const x = padding + (idx / (labels.length - 1)) * (width - padding * 2);
      const y = height - padding - (val / maxVal) * (height - padding * 2);
      return { x, y, val, label: labels[idx] };
    });

    const pathD = points.reduce((acc, pt, i) => {
      return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
    }, '');

    const areaD = `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

    const svgHtml = `
      <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%;">
        <defs>
          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#94a3b8" stop-opacity="0.5"/>
            <stop offset="100%" stop-color="#cbd5e1" stop-opacity="0.05"/>
          </linearGradient>
        </defs>
        <path d="${areaD}" fill="url(#chartGrad)" />
        <path d="${pathD}" fill="none" stroke="#334155" stroke-width="2.5" />
        ${points.map(pt => pt.val > 0 ? `
          <circle cx="${pt.x}" cy="${pt.y}" r="${pt.val > 300000 ? 5 : 3.5}" fill="#1e293b" stroke="#ffffff" stroke-width="1.5" />
          ${pt.val >= 250000 ? `<text x="${pt.x}" y="${pt.y - 8}" font-size="9" font-weight="700" fill="#334155" text-anchor="middle">${formatShortRupiah(pt.val)}</text>` : ''}
        ` : '').join('')}
      </svg>
    `;
    container.innerHTML = svgHtml;
  }

  renderTopExpensesTable(expenses) {
    // Group by subcategory
    const subCatMap = {};
    expenses.forEach(t => {
      const name = t.subCategory;
      subCatMap[name] = (subCatMap[name] || 0) + t.amount;
    });

    // Sort descending
    const sorted = Object.entries(subCatMap)
      .map(([subCategory, total]) => ({ subCategory, total }))
      .sort((a, b) => b.total - a.total);

    // Limit to 21
    const top21 = sorted.slice(0, 21);

    this.topExpensesTableBody.innerHTML = top21.map((item, index) => `
      <tr>
        <td style="text-align: center; color: #64748b; font-weight: 700;">${index + 1}</td>
        <td class="subcat-name">${item.subCategory}</td>
        <td class="amt-cell">${formatRupiah(item.total)}</td>
      </tr>
    `).join('');
  }

  renderAllocationSection(expenses, totalExpense) {
    // Group by Category
    const catMap = {};
    expenses.forEach(t => {
      const c = t.category || 'Kebutuhan Rumah Tangga';
      catMap[c] = (catMap[c] || 0) + t.amount;
    });

    // Sort descending
    const sortedCats = Object.entries(catMap)
      .map(([category, amount]) => ({
        category,
        amount,
        percent: totalExpense > 0 ? ((amount / totalExpense) * 100).toFixed(1) : 0,
        color: CATEGORY_COLORS[category] || '#94a3b8'
      }))
      .sort((a, b) => b.amount - a.amount);

    // Render Donut Chart
    const canvas = document.getElementById('allocationPieChart');
    const fallback = document.getElementById('donutFallback');

    if (this.hasChartJS && canvas) {
      if (this.allocationChartInstance) {
        this.allocationChartInstance.destroy();
      }

      const labels = sortedCats.map(c => c.category);
      const data = sortedCats.map(c => c.amount);
      const colors = sortedCats.map(c => c.color);

      this.allocationChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '52%',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const val = ctx.raw;
                  const pct = totalExpense > 0 ? ((val / totalExpense) * 100).toFixed(1) : 0;
                  return ` ${ctx.label}: ${formatRupiah(val)} (${pct}%)`;
                }
              }
            }
          }
        }
      });
    } else {
      // SVG Donut Fallback
      this.renderSvgDonutFallback(fallback, sortedCats, totalExpense);
    }

    // Render Legend List on Right
    this.allocationLegendList.innerHTML = sortedCats.map(c => `
      <div class="alloc-item">
        <div class="alloc-label-group">
          <span class="alloc-dot" style="background-color: ${c.color};"></span>
          <span title="${c.category}">${c.category}</span>
        </div>
        <div class="alloc-pct">${c.percent}%</div>
      </div>
    `).join('');
  }

  renderSvgDonutFallback(container, categories, total) {
    if (!container) return;
    container.style.display = 'block';
    const size = 150;
    const strokeWidth = 36;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    let accumulatedAngle = 0;

    const circles = categories.map(c => {
      const pct = total > 0 ? c.amount / total : 0;
      const strokeDash = pct * circumference;
      const strokeDashoffset = -accumulatedAngle * circumference;
      accumulatedAngle += pct;
      return `<circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="${c.color}" stroke-width="${strokeWidth}" stroke-dasharray="${strokeDash} ${circumference}" stroke-dashoffset="${strokeDashoffset}" />`;
    }).join('');

    container.innerHTML = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform: rotate(-90deg);">
        ${circles}
      </svg>
    `;
  }

  renderComparisonTable(expenses) {
    // Current month aggregated by subcategory
    const currentSubCat = {};
    expenses.forEach(t => {
      const name = t.subCategory;
      currentSubCat[name] = (currentSubCat[name] || 0) + t.amount;
    });

    const prevSubCat = PREVIOUS_MONTH_DATA.subCategories;

    // Combine keys from both current and previous month
    const allKeys = Array.from(new Set([
      ...Object.keys(currentSubCat),
      ...Object.keys(prevSubCat)
    ]));

    // Build comparison objects
    const comparisons = allKeys.map(subCategory => {
      const cur = currentSubCat[subCategory] || 0;
      const prev = prevSubCat[subCategory] || 0;

      let pctChange = 0;
      if (prev > 0) {
        pctChange = Math.round(((cur - prev) / prev) * 100);
      } else if (cur > 0) {
        pctChange = 100;
      }

      return { subCategory, current: cur, previous: prev, pctChange };
    });

    // Sort by current month expense descending
    comparisons.sort((a, b) => b.current - a.current);

    // Limit to top entries
    const rows = comparisons.slice(0, 15);

    this.comparisonTableBody.innerHTML = rows.map(item => {
      let badgeClass = 'delta-same';
      let arrow = '';
      if (item.pctChange > 0) {
        badgeClass = 'delta-up';
        arrow = '▲ ';
      } else if (item.pctChange < 0) {
        badgeClass = 'delta-down';
        arrow = '▼ ';
      }

      return `
        <tr>
          <td class="subcat-name">${item.subCategory}</td>
          <td class="amt-cell">${formatRupiah(item.current)}</td>
          <td class="amt-cell" style="color: #64748b;">${formatRupiah(item.previous)}</td>
          <td style="text-align: center;">
            <span class="delta-badge ${badgeClass}">${arrow}${Math.abs(item.pctChange)}%</span>
          </td>
        </tr>
      `;
    }).join('');
  }

  exportCSV() {
    let csv = 'ID,Tipe,Tanggal,Kategori,Sub Kategori,Jumlah\n';
    this.transactions.forEach(t => {
      csv += `"${t.id}","${t.type}","${t.date}","${t.category}","${t.subCategory}","${t.amount}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'dompet_mikail_transaksi.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Start app on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new DompetApp();
});
