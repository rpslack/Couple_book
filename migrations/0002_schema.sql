CREATE TABLE households (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul'
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  UNIQUE(household_id, type, name),
  UNIQUE(id, household_id, type)
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  category_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
  amount INTEGER NOT NULL CHECK(typeof(amount) = 'integer' AND amount > 0),
  transaction_date TEXT NOT NULL CHECK(transaction_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  memo TEXT NOT NULL DEFAULT '',
  subject TEXT,
  payment_method TEXT,
  recorded_by TEXT,
  source_file TEXT,
  source_row TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY(category_id, household_id, type) REFERENCES categories(id, household_id, type)
);
CREATE INDEX transactions_household_date ON transactions(household_id, transaction_date);
