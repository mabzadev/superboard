ALTER TABLE growth_automation_runs ADD COLUMN claim_token TEXT;
ALTER TABLE growth_automation_runs ADD COLUMN claim_expires_at TEXT;
ALTER TABLE growth_events ADD COLUMN processed_at TEXT;

UPDATE growth_automation_runs
SET claim_expires_at = datetime(claimed_at, '+5 minutes')
WHERE claimed_at IS NOT NULL;

UPDATE growth_events
SET processed_at = created_at
WHERE processed_at IS NULL;

DROP INDEX IF EXISTS growth_automation_runs_delivery_idx;

CREATE INDEX growth_automation_runs_delivery_idx
  ON growth_automation_runs (status, next_attempt_at, claim_expires_at, claimed_at);

CREATE INDEX growth_events_processing_idx
  ON growth_events (project_id, processed_at)
  WHERE processed_at IS NULL;
