CREATE TABLE IF NOT EXISTS billing_dead_letters (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  queue_name TEXT NOT NULL,
  job_type TEXT,
  job_payload TEXT NOT NULL,
  job_payload_sha256 TEXT NOT NULL,
  job_valid INTEGER NOT NULL DEFAULT 0,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'quarantined' CHECK (
    status IN ('quarantined', 'replay_queued', 'discarded')
  ),
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  replay_requested_by TEXT,
  replay_requested_at TEXT,
  discarded_by TEXT,
  discarded_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS billing_dead_letters_project_status_received
  ON billing_dead_letters(project_id, status, received_at DESC);

CREATE INDEX IF NOT EXISTS billing_dead_letters_status_received
  ON billing_dead_letters(status, received_at DESC);
