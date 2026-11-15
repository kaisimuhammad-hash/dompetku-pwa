import { esc } from './format.js';
import { icon } from './icons.js';

const modalRoot = () => document.getElementById('modal-root');

export function toast(message, type = 'success') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check')}<span>${esc(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

export function openModal({ title, body, footer = '', wide = false, onMount, onClose }) {
  const root = modalRoot();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Tutup">${icon('x')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  root.appendChild(backdrop);
  document.body.style.overflow = 'hidden';

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (!root.children.length) document.body.style.overflow = '';
    if (onClose) onClose();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  backdrop.querySelector('[data-close]').addEventListener('click', close);

  if (onMount) onMount(backdrop.querySelector('.modal'), close);
  setTimeout(() => {
    const first = backdrop.querySelector(
      '.modal-body input:not([type=hidden]), .modal-body select, .modal-body textarea, .modal-foot .btn',
    );
    if (first) first.focus({ preventScroll: true });
  }, 60);
  return close;
}

export function confirmAction({
  title = 'Konfirmasi',
  message,
  confirmText = 'Lanjutkan',
  cancelText = 'Batal',
  danger = false,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openModal({
      title,
      body: `<p class="text-sm muted" style="line-height:1.65">${esc(message)}</p>`,
      footer: `<button class="btn ghost grow" data-cancel>${esc(cancelText)}</button>
               <button class="btn ${danger ? 'danger-solid' : 'primary'}" data-ok>${esc(confirmText)}</button>`,
      onMount(modal, close) {
        modal.querySelector('[data-cancel]').addEventListener('click', () => {
          finish(false);
          close();
        });
        modal.querySelector('[data-ok]').addEventListener('click', () => {
          finish(true);
          close();
        });
      },
      onClose: () => finish(false),
    });
  });
}

export function emptyState({ iconName = 'box', title, description, action = '' }) {
  return `
    <div class="empty">
      <div class="empty-icon">${icon(iconName)}</div>
      <div class="empty-title">${esc(title)}</div>
      <div class="empty-desc">${esc(description)}</div>
      ${action}
    </div>`;
}

export function loadingScreen() {
  return `<div class="loading-screen"><div class="spinner" role="status" aria-label="Memuat"></div></div>`;
}

export function errorState(message, action = '') {
  return `<div class="card"><div class="empty">
    <div class="empty-icon">${icon('alert')}</div>
    <div class="empty-title">Gagal memuat data</div>
    <div class="empty-desc">${esc(message)}</div>
    ${action || '<button class="btn ghost" onclick="location.reload()">Coba lagi</button>'}
  </div></div>`;
}

export function mountMoneyInput(input) {
  const format = (digits) => (digits ? new Intl.NumberFormat('id-ID').format(Number(digits)) : '');
  const setFromDigits = () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 13);
    input.dataset.raw = digits;
    input.value = format(digits);
  };
  if (input.value) setFromDigits();
  else input.dataset.raw = '';
  input.addEventListener('input', setFromDigits);
  input.addEventListener('blur', () => {
    const digits = input.dataset.raw || '';
    input.value = format(digits);
  });
  return {
    value: () => Number(input.dataset.raw || 0),
    set(value) {
      input.dataset.raw = String(Math.round(Number(value) || 0));
      input.value = format(input.dataset.raw);
    },
  };
}

export function setButtonBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" style="width:16px;height:16px;border-width:2px"></span> ${esc(label || 'Menyimpan…')}`;
  } else {
    button.disabled = false;
    if (button.dataset.label) button.innerHTML = button.dataset.label;
  }
}

export function showModalError(modal, message) {
  let el = modal.querySelector('.modal-error');
  if (!el) {
    el = document.createElement('div');
    el.className = 'modal-error';
    modal.querySelector('.modal-body').prepend(el);
  }
  el.textContent = message;
  el.classList.add('show');
}

export function hideModalError(modal) {
  const el = modal.querySelector('.modal-error');
  if (el) el.classList.remove('show');
}
