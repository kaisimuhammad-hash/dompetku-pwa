export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: {},
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch {
    throw new ApiError('Tidak dapat terhubung ke server. Periksa koneksi internet.', 0);
  }

  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null);
  }

  if (response.status === 401 && !path.startsWith('/auth') && path !== '/session') {
    window.dispatchEvent(new CustomEvent('dompetku:unauthorized'));
  }

  if (!response.ok) {
    throw new ApiError(data?.error || `Permintaan gagal (${response.status})`, response.status);
  }
  return data;
}

const qs = (params) => {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  });
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const api = {
  session: () => request('/session'),
  login: (passcode) => request('/auth/login', { method: 'POST', body: { passcode } }),
  logout: () => request('/auth/logout', { method: 'POST' }),

  overview: (month) => request(`/overview${qs({ month })}`),
  cashflow: (month, months = 6) => request(`/cashflow${qs({ month, months })}`),

  transactions: (filters) => request(`/transactions${qs(filters)}`),
  transaction: (id) => request(`/transactions/${id}`),
  createTransaction: (data) => request('/transactions', { method: 'POST', body: data }),
  updateTransaction: (id, data) => request(`/transactions/${id}`, { method: 'PATCH', body: data }),
  deleteTransaction: (id) => request(`/transactions/${id}`, { method: 'DELETE' }),

  accounts: (includeArchived) => request(`/accounts${qs({ includeArchived: includeArchived ? 1 : '' })}`),
  createAccount: (data) => request('/accounts', { method: 'POST', body: data }),
  updateAccount: (id, data) => request(`/accounts/${id}`, { method: 'PATCH', body: data }),
  archiveAccount: (id) => request(`/accounts/${id}`, { method: 'DELETE' }),
  restoreAccount: (id) => request(`/accounts/${id}/restore`, { method: 'POST' }),

  categories: (includeArchived) => request(`/categories${qs({ includeArchived: includeArchived ? 1 : '' })}`),
  createCategory: (data) => request('/categories', { method: 'POST', body: data }),
  updateCategory: (id, data) => request(`/categories/${id}`, { method: 'PATCH', body: data }),
  archiveCategory: (id) => request(`/categories/${id}`, { method: 'DELETE' }),
  restoreCategory: (id) => request(`/categories/${id}/restore`, { method: 'POST' }),

  budgets: (month) => request(`/budgets${qs({ month })}`),
  saveBudget: (data) => request('/budgets', { method: 'PUT', body: data }),
  deleteBudget: (id) => request(`/budgets/${id}`, { method: 'DELETE' }),
  copyBudgets: (from, to) => request('/budgets/copy', { method: 'POST', body: { from, to } }),

  settings: () => request('/settings'),
  setDefaultAccount: (accountId) =>
    request('/settings/default-account', { method: 'POST', body: { accountId } }),

  botStatus: () => request('/bot/status'),
  botTest: () => request('/bot/test', { method: 'POST' }),
  botDisconnect: () => request('/bot/disconnect', { method: 'POST' }),
};
