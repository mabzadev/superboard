PRAGMA foreign_keys = ON;

ALTER TABLE subscribers ADD COLUMN optin_token_expires_at TEXT;

CREATE TABLE IF NOT EXISTS marketing_outbox (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('double_optin')),
  resource_id TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched', 'completed', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  dispatched_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, job_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_marketing_outbox_status
  ON marketing_outbox(status, created_at);
