PRAGMA foreign_keys = ON;

-- Server-side API keys for the public transactional send API. Only a SHA-256
-- digest of the 256-bit secret is stored; the plaintext is shown once.
CREATE TABLE IF NOT EXISTS email_api_keys (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL DEFAULT '["email:send"]' CHECK (json_valid(scopes_json)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_api_keys_project
  ON email_api_keys(project_id, revoked_at, created_at);

-- Fixed one-minute windows for per-project API rate limiting.
CREATE TABLE IF NOT EXISTS email_api_rate_windows (
  project_id INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, window_start)
);

-- API dispatch state. Message status keeps its original CHECK constraint; a
-- scheduled or canceled API message is represented here.
CREATE TABLE IF NOT EXISTS email_message_dispatch (
  message_id TEXT PRIMARY KEY REFERENCES email_messages(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'api' CHECK (source IN ('api')),
  api_key_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('scheduled', 'released', 'canceled')),
  scheduled_at TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  canceled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_email_message_dispatch_due
  ON email_message_dispatch(state, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_email_message_dispatch_project
  ON email_message_dispatch(project_id, created_at);

-- Attachments are stored as base64 chunks to stay below the D1 row size limit.
CREATE TABLE IF NOT EXISTS email_message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_id TEXT,
  disposition TEXT NOT NULL CHECK (disposition IN ('attachment', 'inline')),
  size_bytes INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  UNIQUE (message_id, position)
);
CREATE TABLE IF NOT EXISTS email_message_attachment_chunks (
  attachment_id TEXT NOT NULL REFERENCES email_message_attachments(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content_base64 TEXT NOT NULL,
  PRIMARY KEY (attachment_id, chunk_index)
);

-- Per-message status timeline shown in the message log and the public API.
CREATE TABLE IF NOT EXISTS email_message_events (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  project_id INTEGER,
  recipient TEXT,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_message_events_message
  ON email_message_events(message_id, occurred_at, id);

-- Recipients that hard-bounced or complained are not sent API messages again.
CREATE TABLE IF NOT EXISTS email_suppressions (
  project_id INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('hard_bounce', 'complaint')),
  source_event_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, recipient)
);

-- Domain authentication wizard inputs and the last per-record verification.
ALTER TABLE email_smtp_profiles ADD COLUMN authentication_config_json TEXT;
ALTER TABLE email_smtp_profiles ADD COLUMN authentication_report_json TEXT;
