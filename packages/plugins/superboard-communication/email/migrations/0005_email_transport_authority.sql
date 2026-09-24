CREATE TABLE IF NOT EXISTS email_transport_deliveries (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_sha256 TEXT NOT NULL,
  source TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  reference_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  provider_message_id TEXT,
  provider_response TEXT,
  last_error TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_transport_project_updated
  ON email_transport_deliveries(project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_transport_status_lease
  ON email_transport_deliveries(status, lease_expires_at);
