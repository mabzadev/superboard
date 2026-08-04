ALTER TABLE billing_subscriptions ADD COLUMN provider_last_verified_at TEXT;
ALTER TABLE billing_subscriptions ADD COLUMN provider_verification_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE billing_subscriptions ADD COLUMN provider_verification_error_code TEXT;
ALTER TABLE billing_subscriptions ADD COLUMN provider_verification_error_message TEXT;
ALTER TABLE billing_subscriptions ADD COLUMN provider_verification_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_provider_verification
ON billing_subscriptions (
  project_id,
  provider_verification_status,
  provider_last_verified_at
);
