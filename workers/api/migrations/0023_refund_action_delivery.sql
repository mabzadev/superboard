ALTER TABLE billing_refund_provider_actions ADD COLUMN next_attempt_at TEXT;
ALTER TABLE billing_refund_provider_actions ADD COLUMN claim_token TEXT;
ALTER TABLE billing_refund_provider_actions ADD COLUMN claim_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_refund_actions_retry
  ON billing_refund_provider_actions(status, next_attempt_at, claim_expires_at, attempts);
