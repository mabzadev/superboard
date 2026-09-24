-- Shared Dashboard authentication abuse protection. Keys are SHA-256 digests;
-- raw IP addresses, emails and invitation/reset tokens are never persisted.

CREATE TABLE IF NOT EXISTS dashboard_auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL DEFAULT (datetime('now')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS dashboard_auth_rate_limits_window_idx
  ON dashboard_auth_rate_limits(window_started_at);
