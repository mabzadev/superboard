PRAGMA foreign_keys = ON;

ALTER TABLE email_deliveries ADD COLUMN provider_status TEXT;
ALTER TABLE email_deliveries ADD COLUMN provider_event_at TEXT;
ALTER TABLE email_deliveries ADD COLUMN provider_diagnostic TEXT;

ALTER TABLE email_transport_deliveries ADD COLUMN provider_status TEXT;
ALTER TABLE email_transport_deliveries ADD COLUMN provider_event_at TEXT;
ALTER TABLE email_transport_deliveries ADD COLUMN provider_diagnostic TEXT;

CREATE TABLE IF NOT EXISTS email_provider_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('aws-ses')),
  provider_message_id TEXT NOT NULL,
  source TEXT,
  project_id INTEGER,
  reference_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'delivered', 'soft_bounce', 'hard_bounce', 'complaint',
    'delivery_delayed', 'rejected'
  )),
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  correlation_status TEXT NOT NULL DEFAULT 'processing'
    CHECK (correlation_status IN ('processing', 'matched', 'unmatched')),
  consumer_status TEXT NOT NULL DEFAULT 'not_applicable'
    CHECK (consumer_status IN ('not_applicable', 'pending', 'completed')),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_provider_events_consumer
  ON email_provider_events(source, consumer_status, received_at, id);

CREATE INDEX IF NOT EXISTS idx_email_provider_events_message
  ON email_provider_events(provider, provider_message_id, occurred_at);
