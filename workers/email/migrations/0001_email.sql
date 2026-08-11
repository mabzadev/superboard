PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS email_messages (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('development', 'production')),
  transport TEXT NOT NULL CHECK (transport IN ('capture', 'smtp')),
  kind TEXT NOT NULL CHECK (kind IN ('transactional', 'marketing', 'test')),
  project_id INTEGER,
  template_key TEXT,
  from_name TEXT NOT NULL,
  from_address TEXT NOT NULL,
  reply_to TEXT,
  subject TEXT NOT NULL,
  text_body TEXT,
  html_body TEXT,
  headers_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('captured', 'queued', 'sending', 'sent', 'failed')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('captured', 'queued', 'sending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  provider_response TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT,
  UNIQUE (message_id, recipient)
);

CREATE INDEX IF NOT EXISTS idx_email_messages_created ON email_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(status, created_at);
CREATE INDEX IF NOT EXISTS idx_email_deliveries_message ON email_deliveries(message_id, status);
