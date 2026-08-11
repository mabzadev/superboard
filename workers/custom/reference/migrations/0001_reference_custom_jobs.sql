CREATE TABLE IF NOT EXISTS reference_custom_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  project_ref TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability = 'reference.echo'),
  user_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'completed'),
  requested_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reference_custom_jobs_project_user_created
  ON reference_custom_jobs(project_ref, user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_reference_custom_jobs_capability_created
  ON reference_custom_jobs(capability, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_reference_custom_jobs_status_created
  ON reference_custom_jobs(status, created_at DESC, id DESC);
