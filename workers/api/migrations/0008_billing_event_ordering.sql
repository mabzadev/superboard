ALTER TABLE billing_transactions ADD COLUMN event_occurred_at TEXT;
ALTER TABLE billing_subscriptions ADD COLUMN latest_event_at TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_transactions_original_event
  ON billing_transactions(project_id, store, environment, original_transaction_id, event_occurred_at);
