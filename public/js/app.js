import { api } from './api.js';
import { esc } from './format.js';
import { brandMark, icon } from './icons.js';
import {
  budgetsPage,
  dashboardPage,
  invalidateBasics,
  openTransactionModal,
  settingsPage,
  transactionsPage,
  walletsPage,
} from './pages.js';
import { confirmAction, errorState, loadingScreen, toast } from './ui.js';

const NAV = [
  { key: 'dashboard', path: '/', label: 'Ringkasan', icon: 'home', page: dashboardPage },
  { key: 'transactions', path: '/transaksi', label: 'Transaksi', icon: 'list', page: transactionsPage },
  { key: 'wallets', path: '/dompet', label: 'Dompet', icon: 'wallet', page: walletsPage },
  { key: 'budgets', path: '/anggaran', label: 'Anggaran', icon: 'target', page: budgetsPage },
  { key: 'settings', path: '/pengaturan', label: 'Pengaturan', icon: 'settings', page: settingsPage },
];

const THEME_KEY = 'dpk_theme';
const appRoot = document.getElementById('app');
const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');

let session = null;
let shellCtx = null;
let renderSeq = 0;
let lastPath = null;
let deferredPrompt = null;
let handlingUnauthorized = false;

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'system';
}

function applyTheme(theme = getTheme()) {
  const resolved = theme === 'system' ? (themeMedia.matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#070e18' : '#0f9d76');
  document.querySelectorAll('[data-theme-toggle="label"]').forEach((button) => {
    button.innerHTML = `${icon(resolved === 'dark' ? 'sun' : 'moon')}<span>${resolved === 'dark' ? 'Mode terang' : 'Mode gelap'}</span>`;
  });
  document.querySelectorAll('[data-theme-toggle="icon"]').forEach((button) => {
    button.innerHTML = icon(resolved === 'dark' ? 'sun' : 'moon');
  });
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(search)) };
}

function resolveRoute(path) {
  const clean = path === '' ? '/' : path;
  return (
    NAV.find((item) =>
      item.path === '/' ? clean === '/' : clean === item.path || clean.startsWith(`${item.path}/`),
    ) || NAV[0]
  );
}

function setActiveNav(key) {
  document.querySelectorAll('[data-nav], [data-nav-tab]').forEach((element) => {
    const active = element.dataset.nav === key || element.dataset.navTab === key;
    element.classList.toggle('active', active);
    if (active) element.setAttribute('aria-current', 'page');
    else element.removeAttribute('aria-current');
  });
}

function navigate(path, params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  });
  const text = search.toString();
  const hash = `#${path}${text ? `?${text}` : ''}`;
  if (location.hash === hash) renderView();
  else location.hash = hash;
}

async function renderView() {
  if (!session?.authenticated) return;
  const seq = ++renderSeq;
  const { path, query } = parseHash();
  const route = resolveRoute(path);
  setActiveNav(route.key);
  const fab = document.querySelector('[data-fab]');
  if (fab) fab.classList.toggle('hidden', route.key === 'settings');

  const view = document.getElementById('view');
  if (!view) return;
  view.innerHTML = loadingScreen();

  const ctx = {
    view,
    query,
    navigate,
    refresh: () => {
      if (seq === renderSeq) renderView();
    },
  };
  shellCtx = ctx;

  try {
    await route.page(ctx);
    if (seq !== renderSeq) return;
    document.title =
      route.key === 'dashboard' ? 'Dompetku — Catatan Keuangan' : `${route.label} · Dompetku`;
    if (lastPath !== path) {
      window.scrollTo({ top: 0 });
      lastPath = path;
    }
  } catch (error) {
    if (seq !== renderSeq) return;
    if (error.status === 401) return;
    view.innerHTML = errorState(error.message);
  }
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

function botPillHTML() {
  return `<a class="bot-pill" href="#/pengaturan" id="bot-pill" aria-label="Status bot Telegram">
    ${icon('bot')}<span class="dot" data-bot-dot></span><span data-bot-text>Memeriksa bot…</span>
  </a>`;
}

function renderShell() {
  lastPath = null;
  appRoot.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div>
          <a class="brand" href="#/" aria-label="Dompetku">
            <span class="brand-mark">${brandMark()}</span>
            <span class="brand-text"><strong>Dompetku</strong><small>Keuangan pribadi</small></span>
          </a>
          <nav class="nav" aria-label="Menu utama">
            ${NAV.map(
              (item) =>
                `<a class="nav-link" href="#${item.path}" data-nav="${item.key}">${icon(item.icon)}<span>${item.label}</span></a>`,
            ).join('')}
          </nav>
        </div>
        <div class="sidebar-bottom">
          ${botPillHTML()}
          <button class="nav-link" type="button" data-theme-toggle="label">${icon('moon')}<span>Mode gelap</span></button>
          <button class="nav-link" type="button" data-logout>${icon('logout')}<span>Keluar</span></button>
        </div>
      </aside>

      <div class="main">
        <div class="offline-banner" id="offline-banner" role="status">
          ${icon('wifi-off')} Kamu sedang offline — data mungkin belum terbaru
        </div>
        <header class="topbar">
          <a class="brand-mobile" href="#/">
            <span class="brand-mark">${brandMark()}</span>
            Dompetku
          </a>
          <div class="topbar-actions">
            <button class="icon-btn bordered" type="button" data-theme-toggle="icon" aria-label="Ganti tema">${icon('moon')}</button>
            <button class="icon-btn bordered" type="button" data-logout aria-label="Keluar">${icon('logout')}</button>
          </div>
        </header>
        <main class="view" id="view"></main>
      </div>

      <button class="fab" type="button" data-fab aria-label="Catat transaksi">${icon('plus')}</button>

      <nav class="tabbar" aria-label="Navigasi bawah">
        ${NAV.map(
          (item) =>
            `<a class="tab" href="#${item.path}" data-nav-tab="${item.key}">${icon(item.icon)}<span>${item.label}</span></a>`,
        ).join('')}
      </nav>
    </div>`;

  applyTheme();

  appRoot.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', toggleTheme);
  });
  appRoot.querySelectorAll('[data-logout]').forEach((button) => {
    button.addEventListener('click', handleLogout);
  });
  appRoot.querySelector('[data-fab]').addEventListener('click', () => {
    if (shellCtx) openTransactionModal(shellCtx, null, { onSaved: () => renderView() });
  });

  updateNetworkBanner();
  renderView();
  refreshBotPill();
}

async function refreshBotPill() {
  const pill = document.getElementById('bot-pill');
  if (!pill) return;
  const dot = pill.querySelector('[data-bot-dot]');
  const text = pill.querySelector('[data-bot-text]');
  try {
    const status = await api.botStatus();
    if (dot) dot.className = `dot ${status.connected ? 'on' : 'off'}`;
    if (text) {
      text.textContent = status.connected
        ? status.username
          ? `@${status.username} terhubung`
          : 'Bot terhubung'
        : status.enabled
          ? 'Menunggu /start'
          : 'Bot belum aktif';
    }
  } catch {
    if (dot) dot.className = 'dot';
    if (text) text.textContent = 'Status bot tak tersedia';
  }
}

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

function renderLogin(info = {}) {
  document.title = 'Masuk · Dompetku';
  appRoot.innerHTML = `
    <div class="login">
      <aside class="login-aside">
        <div class="login-brand"><span class="brand-mark">${brandMark()}</span> Dompetku</div>
        <div class="login-copy">
          <h1>Catat keuangan lewat Telegram, pantau dari mana saja.</h1>
          <p>Kirim pesan sederhana seperti <strong>“makan siang 25rb”</strong> ke bot, lalu Dompetku merapikan transaksi, dompet, dan anggaran bulananmu.</p>
          <div class="login-points">
            <div class="login-point"><span class="tick">${icon('check')}</span>Pencatatan cepat lewat chat</div>
            <div class="login-point"><span class="tick">${icon('check')}</span>Laporan dan grafik yang mudah dibaca</div>
            <div class="login-point"><span class="tick">${icon('shield')}</span>Data pribadi, hanya kamu yang bisa akses</div>
          </div>
        </div>
        <p class="login-foot">Dompetku · Keuangan pribadi yang rapi</p>
      </aside>
      <main class="login-main">
        <div class="login-card">
          <span class="brand-mark">${brandMark()}</span>
          <h2>Selamat datang kembali</h2>
          <p class="login-sub">Masukkan kode akses untuk membuka dashboard keuanganmu.</p>
          <form id="login-form" novalidate>
            <div class="login-error" id="login-error" role="alert"></div>
            <div class="field">
              <label class="label" for="passcode">Kode akses</label>
              <input class="input" id="passcode" name="passcode" type="password" inputmode="text" autocomplete="current-password" placeholder="••••••" required />
            </div>
            <button class="btn primary block" type="submit" id="login-submit">Masuk</button>
          </form>
          ${
            info.demoPasscode
              ? `<div class="login-hint">Mode demo lokal aktif. Kode akses bawaan: <strong>dompetku</strong>. Ganti lewat <code>APP_PASSCODE</code> sebelum dipakai serius.</div>`
              : ''
          }
          <p class="login-note">Akses hanya untuk perangkatmu. Jangan bagikan kode akses ke orang lain.</p>
        </div>
      </main>
    </div>`;

  const form = document.getElementById('login-form');
  const input = document.getElementById('passcode');
  const submit = document.getElementById('login-submit');
  const errorBox = document.getElementById('login-error');

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.classList.add('show');
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const passcode = input.value.trim();
    if (!passcode) {
      showError('Masukkan kode akses terlebih dahulu.');
      input.focus();
      return;
    }
    errorBox.classList.remove('show');
    submit.disabled = true;
    submit.textContent = 'Memeriksa…';
    try {
      await api.login(passcode);
      session = { authenticated: true, demoPasscode: Boolean(info.demoPasscode) };
      renderShell();
    } catch (error) {
      showError(error.message || 'Gagal masuk. Coba lagi.');
      input.select();
      submit.disabled = false;
      submit.textContent = 'Masuk';
    }
  });

  input.focus();
}

function renderFatal(message) {
  document.title = 'Dompetku';
  appRoot.innerHTML = `
    <div class="login">
      <main class="login-main">
        <div class="login-card" style="text-align:center">
          <span class="brand-mark" style="margin-inline:auto">${brandMark()}</span>
          <h2>Server tidak dapat dihubungi</h2>
          <p class="login-sub">${esc(message || 'Periksa koneksi internet lalu coba lagi.')}</p>
          <button class="btn primary block" type="button" id="retry">Coba lagi</button>
        </div>
      </main>
    </div>`;
  document.getElementById('retry').addEventListener('click', boot);
}

/* ------------------------------------------------------------------ */
/* Session lifecycle                                                   */
/* ------------------------------------------------------------------ */

function resetSession() {
  renderSeq += 1;
  session = null;
  shellCtx = null;
  lastPath = null;
  invalidateBasics();
  document.getElementById('modal-root').innerHTML = '';
  document.body.style.overflow = '';
  boot();
}

async function handleLogout() {
  const ok = await confirmAction({
    title: 'Keluar dari Dompetku?',
    message: 'Kamu perlu memasukkan kode akses lagi untuk membuka dashboard.',
    confirmText: 'Keluar',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.logout();
  } catch {
    // Sesi tetap ditutup di sisi klien meski permintaan gagal.
  }
  resetSession();
  toast('Kamu sudah keluar');
}

function handleUnauthorized() {
  if (handlingUnauthorized || !session?.authenticated) return;
  handlingUnauthorized = true;
  resetSession();
  toast('Sesi berakhir. Silakan masuk lagi.', 'error');
  setTimeout(() => {
    handlingUnauthorized = false;
  }, 600);
}

function updateNetworkBanner() {
  const banner = document.getElementById('offline-banner');
  if (banner) banner.classList.toggle('show', !navigator.onLine);
}

/* ------------------------------------------------------------------ */
/* PWA                                                                 */
/* ------------------------------------------------------------------ */

async function handleInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch {
      // Prompt bisa ditutup tanpa pilihan.
    }
    deferredPrompt = null;
    delete document.documentElement.dataset.canInstall;
    return;
  }
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    toast('Di Safari: ketuk Bagikan, lalu “Tambahkan ke Layar Utama”.');
  } else if (/Android/i.test(ua)) {
    toast('Di Chrome: menu ⋮, lalu “Tambahkan ke layar utama”.');
  } else {
    toast('Di Chrome/Edge: klik ikon instal di address bar atau menu ⋮ → “Instal Dompetku”.');
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  applyTheme();
  appRoot.innerHTML = loadingScreen();
  try {
    session = await api.session();
  } catch (error) {
    session = null;
    renderFatal(error.message);
    return;
  }
  if (session.authenticated) renderShell();
  else renderLogin(session);
}

window.addEventListener('hashchange', () => {
  if (session?.authenticated) renderView();
});
window.addEventListener('online', () => {
  updateNetworkBanner();
  if (session?.authenticated) renderView();
});
window.addEventListener('offline', updateNetworkBanner);
window.addEventListener('dompetku:theme', (event) => {
  localStorage.setItem(THEME_KEY, event.detail);
  applyTheme(event.detail);
});
window.addEventListener('dompetku:logout', handleLogout);
window.addEventListener('dompetku:unauthorized', handleUnauthorized);
window.addEventListener('dompetku:install', handleInstall);
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  document.documentElement.dataset.canInstall = '1';
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  delete document.documentElement.dataset.canInstall;
  toast('Dompetku sudah terpasang di perangkat');
});
themeMedia.addEventListener('change', () => {
  if (getTheme() === 'system') applyTheme('system');
});

registerServiceWorker();
boot();
