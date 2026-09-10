ALTER TABLE billing_balance_ledger ADD COLUMN expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_balance_active
  ON billing_balance_ledger(project_id, customer_id, currency_identifier, expires_at);
