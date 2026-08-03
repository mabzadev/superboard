ALTER TABLE billing_paywall_events ADD COLUMN growth_projected_at TEXT;
ALTER TABLE billing_paywall_events ADD COLUMN growth_projection_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_paywall_events ADD COLUMN growth_projection_next_attempt_at TEXT;
ALTER TABLE billing_paywall_events ADD COLUMN growth_projection_error TEXT;

CREATE INDEX IF NOT EXISTS billing_paywall_growth_projection_idx
  ON billing_paywall_events (growth_projected_at, growth_projection_next_attempt_at, occurred_at)
  WHERE event_type IN ('closed', 'purchase_cancelled', 'purchase_failed');
