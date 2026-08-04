ALTER TABLE billing_refund_cases ADD COLUMN provider_event_at TEXT;
ALTER TABLE billing_refund_cases ADD COLUMN projection_version TEXT;

UPDATE billing_refund_cases
SET provider_event_at = strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(updated_at, opened_at, created_at)),
    projection_version = strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(updated_at, opened_at, created_at)) || '|000|LEGACY|' || id
WHERE projection_version IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_refund_cases_projection
  ON billing_refund_cases(project_id, provider, environment, projection_version);
