CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  ip_hash TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) <= 160),
  data TEXT NOT NULL CHECK(json_valid(data)),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_user_updated ON documents(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS banks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) <= 160),
  questions TEXT NOT NULL CHECK(json_valid(questions) AND json_type(questions) = 'array'),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS banks_user_created ON banks(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('suggestion', 'issue')),
  message TEXT NOT NULL CHECK(length(trim(message)) BETWEEN 10 AND 2000),
  created_at TEXT NOT NULL
);
