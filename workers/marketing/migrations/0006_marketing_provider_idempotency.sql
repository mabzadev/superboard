PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS provider_event_receipts (
  project_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  delivery_id TEXT,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  PRIMARY KEY(project_id, source, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_event_receipts_received
  ON provider_event_receipts(project_id, received_at DESC);
