CREATE TABLE IF NOT EXISTS opengrow_custom_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  project_ref TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (
    capability IN ('vocostar.voice.clone', 'vocostar.media.convert')
  ),
  user_id TEXT NOT NULL,
  entity_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'dispatched', 'running', 'completed', 'failed', 'cancelled')
  ),
  credit_cost INTEGER NOT NULL DEFAULT 0 CHECK (credit_cost >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  requested_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_opengrow_custom_jobs_status_updated
  ON opengrow_custom_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_opengrow_custom_jobs_capability_created
  ON opengrow_custom_jobs(capability, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opengrow_custom_jobs_user_created
  ON opengrow_custom_jobs(user_id, created_at DESC);
