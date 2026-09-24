CREATE TABLE IF NOT EXISTS billing_google_voided_sync_state (
  project_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment = 'production'),
  watermark_ms INTEGER,
  last_started_at TEXT,
  last_completed_at TEXT,
  last_error TEXT,
  claim_token TEXT,
  claim_expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, environment),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_google_voided_sync_due
  ON billing_google_voided_sync_state(last_completed_at, claim_expires_at);
