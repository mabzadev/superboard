ALTER TABLE billing_webhook_events ADD COLUMN job_payload TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_project_status_received
ON billing_webhook_events (project_id, status, received_at DESC);
