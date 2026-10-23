CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  disabled INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  ua TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS ledger_sources (
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  source_file TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, tool_id, source_file)
);

CREATE TABLE IF NOT EXISTS ledger_records (
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  source_file TEXT NOT NULL,
  date TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, tool_id, source_file, date, platform, project, model, type)
);

CREATE INDEX IF NOT EXISTS idx_ledger_records_source
  ON ledger_records(user_id, tool_id, source_file);
