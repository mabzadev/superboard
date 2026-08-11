ALTER TABLE billing_webhook_deliveries ADD COLUMN last_attempt_at TEXT;
ALTER TABLE billing_webhook_deliveries ADD COLUMN response_body TEXT;
ALTER TABLE billing_webhook_deliveries ADD COLUMN customer_id TEXT;
ALTER TABLE billing_webhook_deliveries ADD COLUMN claim_token TEXT;
ALTER TABLE billing_webhook_deliveries ADD COLUMN claim_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_deliveries_claim
  ON billing_webhook_deliveries(status, next_attempt_at, claim_expires_at);

CREATE INDEX IF NOT EXISTS idx_billing_deliveries_projection
  ON billing_webhook_deliveries(transaction_id, event_type, customer_id);
