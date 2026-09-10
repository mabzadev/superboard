CREATE TABLE IF NOT EXISTS billing_certification_device_challenges (
  run_id TEXT PRIMARY KEY,
  challenge_hash TEXT NOT NULL CHECK (length(challenge_hash) = 64),
  expires_at TEXT NOT NULL,
  claimed_customer_id TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES billing_certification_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (claimed_customer_id) REFERENCES billing_customers(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS billing_certification_device_challenges_expiry
  ON billing_certification_device_challenges(expires_at, run_id);

CREATE TABLE IF NOT EXISTS billing_certification_device_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  target_project_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  check_key TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'failed')),
  source_platform TEXT NOT NULL CHECK (source_platform IN ('ios', 'android', 'web')),
  application_identifier TEXT NOT NULL,
  build_number TEXT NOT NULL,
  app_version TEXT,
  sdk_version TEXT,
  device_model TEXT,
  os_version TEXT,
  evidence_json TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL CHECK (length(evidence_sha256) = 64),
  observed_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES billing_certification_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (target_project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES billing_customers(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS billing_certification_device_results_run
  ON billing_certification_device_results(run_id, check_key, received_at DESC);

CREATE TRIGGER IF NOT EXISTS billing_certification_device_results_no_update
BEFORE UPDATE ON billing_certification_device_results
BEGIN
  SELECT RAISE(ABORT, 'billing certification device results are immutable');
END;

CREATE TRIGGER IF NOT EXISTS billing_certification_device_results_no_delete
BEFORE DELETE ON billing_certification_device_results
BEGIN
  SELECT RAISE(ABORT, 'billing certification device results are immutable');
END;
