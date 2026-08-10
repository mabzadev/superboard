CREATE TABLE IF NOT EXISTS application_account_erasures (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  instance_id INTEGER NOT NULL,
  project_ref TEXT NOT NULL,
  application_user_id TEXT,
  application_user_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'failed', 'completed')),
  completed_steps_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(completed_steps_json)),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_id TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  last_error_service TEXT,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, application_user_hash)
);

CREATE INDEX IF NOT EXISTS application_account_erasures_status_updated
  ON application_account_erasures(status, updated_at);

-- Device certification evidence is immutable except for a one-way privacy
-- redaction. Test result/outcome fields remain immutable and auditable.
DROP TRIGGER IF EXISTS billing_certification_device_results_no_update;

CREATE TRIGGER billing_certification_device_results_immutable_fields
BEFORE UPDATE OF id, run_id, target_project_id, customer_id, check_key,
  outcome, source_platform, application_identifier, build_number,
  app_version, sdk_version, observed_at, received_at
ON billing_certification_device_results
BEGIN
  SELECT RAISE(ABORT, 'billing certification immutable fields cannot be updated');
END;

CREATE TRIGGER billing_certification_device_results_privacy_redaction_only
BEFORE UPDATE OF device_model, os_version, evidence_json, evidence_sha256
ON billing_certification_device_results
WHEN NOT (
  NEW.device_model IS NULL
  AND NEW.os_version IS NULL
  AND NEW.evidence_json = '{}'
  AND length(NEW.evidence_sha256) = 64
)
BEGIN
  SELECT RAISE(ABORT, 'billing certification evidence can only be privacy-redacted');
END;
