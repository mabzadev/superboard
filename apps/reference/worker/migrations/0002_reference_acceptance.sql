CREATE TABLE reference_custom_jobs_next (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  project_ref TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (
    capability IN ('reference.echo', 'reference.acceptance')
  ),
  user_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'completed'),
  requested_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

INSERT INTO reference_custom_jobs_next (
  id,
  idempotency_key,
  request_hash,
  project_ref,
  capability,
  user_id,
  payload_json,
  status,
  requested_at,
  created_at,
  updated_at,
  completed_at
)
SELECT
  id,
  idempotency_key,
  request_hash,
  project_ref,
  capability,
  user_id,
  payload_json,
  status,
  requested_at,
  created_at,
  updated_at,
  completed_at
FROM reference_custom_jobs;

DROP TABLE reference_custom_jobs;

ALTER TABLE reference_custom_jobs_next RENAME TO reference_custom_jobs;

CREATE INDEX idx_reference_custom_jobs_project_user_created
  ON reference_custom_jobs(project_ref, user_id, created_at DESC, id DESC);

CREATE INDEX idx_reference_custom_jobs_capability_created
  ON reference_custom_jobs(capability, created_at DESC, id DESC);

CREATE INDEX idx_reference_custom_jobs_status_created
  ON reference_custom_jobs(status, created_at DESC, id DESC);
