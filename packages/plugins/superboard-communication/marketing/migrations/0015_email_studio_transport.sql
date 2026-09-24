CREATE TABLE IF NOT EXISTS email_studio_transports (
  project_id INTEGER NOT NULL,
  delivery_id TEXT NOT NULL,
  message_json TEXT NOT NULL CHECK (json_valid(message_json)),
  status TEXT NOT NULL DEFAULT 'prepared',
  provider_message_id TEXT,
  purpose TEXT NOT NULL DEFAULT 'legacy',
  locale TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(project_id, delivery_id)
);
CREATE TABLE IF NOT EXISTS email_studio_send_attempts (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  delivery_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  success INTEGER NOT NULL CHECK(success IN (0,1)),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_email_studio_attempts_delivery
  ON email_studio_send_attempts(project_id, delivery_id, created_at);
