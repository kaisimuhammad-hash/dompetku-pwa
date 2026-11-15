CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'cash' CHECK (type IN ('cash', 'bank', 'ewallet', 'other')),
  initial_balance BIGINT NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#0f9d76',
  icon TEXT NOT NULL DEFAULT 'wallet',
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  icon TEXT NOT NULL DEFAULT 'tag',
  color TEXT NOT NULL DEFAULT '#64748b',
  keywords TEXT NOT NULL DEFAULT '',
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id INTEGER REFERENCES accounts(id),
  category_id INTEGER REFERENCES categories(id),
  note TEXT NOT NULL DEFAULT '',
  occurred_on DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'web',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transfer_target_required CHECK (
    (kind = 'transfer' AND to_account_id IS NOT NULL AND to_account_id <> account_id)
    OR (kind <> 'transfer' AND to_account_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS budgets (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  UNIQUE (category_id, month)
);

CREATE INDEX IF NOT EXISTS transactions_occurred_on_idx ON transactions (occurred_on DESC);
CREATE INDEX IF NOT EXISTS transactions_category_idx ON transactions (category_id);
CREATE INDEX IF NOT EXISTS transactions_account_idx ON transactions (account_id);
CREATE INDEX IF NOT EXISTS transactions_to_account_idx ON transactions (to_account_id);
CREATE INDEX IF NOT EXISTS budgets_month_idx ON budgets (month);
