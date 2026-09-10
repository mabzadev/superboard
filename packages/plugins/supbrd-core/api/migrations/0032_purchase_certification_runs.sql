CREATE TABLE IF NOT EXISTS billing_certification_runs (
  id TEXT PRIMARY KEY,
  release_project_id TEXT NOT NULL,
  target_project_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web', 'cross_platform')),
  build_number TEXT NOT NULL,
  app_version TEXT,
  sdk_version TEXT,
  device_model TEXT,
  os_version TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  notes TEXT,
  created_by TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (release_project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (target_project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS billing_certification_runs_release_status
  ON billing_certification_runs(release_project_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS billing_certification_observations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  check_key TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'failed')),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('billing_transaction', 'billing_event', 'paywall_event', 'legacy_inventory', 'test_run')),
  reference_id TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL CHECK (length(evidence_sha256) = 64),
  notes TEXT,
  created_by TEXT NOT NULL,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES billing_certification_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS billing_certification_observations_run
  ON billing_certification_observations(run_id, check_key, observed_at DESC);

CREATE INDEX IF NOT EXISTS billing_certification_observations_check
  ON billing_certification_observations(check_key, outcome, observed_at DESC);

CREATE TRIGGER IF NOT EXISTS billing_certification_observations_no_update
BEFORE UPDATE ON billing_certification_observations
BEGIN
  SELECT RAISE(ABORT, 'billing certification observations are immutable');
END;

CREATE TRIGGER IF NOT EXISTS billing_certification_observations_no_delete
BEFORE DELETE ON billing_certification_observations
BEGIN
  SELECT RAISE(ABORT, 'billing certification observations are immutable');
END;
