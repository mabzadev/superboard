ALTER TABLE billing_checkout_sessions ADD COLUMN request_fingerprint TEXT;
ALTER TABLE billing_checkout_sessions ADD COLUMN redemption_code_encrypted TEXT;
ALTER TABLE billing_checkout_sessions ADD COLUMN processing_lease_id TEXT;
ALTER TABLE billing_checkout_sessions ADD COLUMN processing_started_at TEXT;
ALTER TABLE billing_checkout_sessions ADD COLUMN provider_subscription_id TEXT;
ALTER TABLE billing_checkout_sessions ADD COLUMN provider_payment_intent_id TEXT;
ALTER TABLE billing_checkout_sessions ADD COLUMN provider_charge_id TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_checkout_processing_lease
  ON billing_checkout_sessions(status, processing_started_at)
  WHERE status = 'creating';

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_checkout_provider_subscription
  ON billing_checkout_sessions(connection_id, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_checkout_provider_payment_intent
  ON billing_checkout_sessions(connection_id, provider_payment_intent_id)
  WHERE provider_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_checkout_provider_charge
  ON billing_checkout_sessions(connection_id, provider_charge_id)
  WHERE provider_charge_id IS NOT NULL;
