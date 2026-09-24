ALTER TABLE email_messages ADD COLUMN idempotency_key TEXT;
ALTER TABLE email_messages ADD COLUMN request_sha256 TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_environment_idempotency
  ON email_messages(environment, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_deliveries_retry
  ON email_deliveries(status, updated_at);
