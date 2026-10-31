PRAGMA foreign_keys = ON;

-- Customer endpoints receiving signed outbound email events.
CREATE TABLE IF NOT EXISTS email_event_webhooks (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  events_json TEXT NOT NULL CHECK (json_valid(events_json)),
  encrypted_secret TEXT NOT NULL,
  secret_prefix TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_email_event_webhooks_project
  ON email_event_webhooks(project_id, enabled);

-- Delivery log with retry state for each event and endpoint.
CREATE TABLE IF NOT EXISTS email_event_webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES email_event_webhooks(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'retrying', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  response_status INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at TEXT,
  UNIQUE (webhook_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_email_event_webhook_deliveries_webhook
  ON email_event_webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_event_webhook_deliveries_status
  ON email_event_webhook_deliveries(status, next_attempt_at);
