PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS application_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password_hash TEXT,
  name TEXT,
  is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1)),
  email_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS application_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES application_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('anonymous', 'google', 'apple')),
  subject_hash TEXT NOT NULL,
  provider_email TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, subject_hash)
);

CREATE INDEX IF NOT EXISTS application_identities_user_idx
  ON application_identities(user_id);

CREATE TABLE IF NOT EXISTS application_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES application_users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rotated_from_id TEXT
);

CREATE INDEX IF NOT EXISTS application_sessions_user_idx
  ON application_sessions(user_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS application_identity_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES application_users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS application_auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL
);
