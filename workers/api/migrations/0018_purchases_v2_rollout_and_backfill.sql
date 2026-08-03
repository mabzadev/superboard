-- Purchases 2.0 rollout state and additive canonical event backfill.

CREATE TABLE IF NOT EXISTS billing_feature_flags (
  project_id TEXT PRIMARY KEY,
  purchases_core INTEGER NOT NULL DEFAULT 1,
  product_catalog INTEGER NOT NULL DEFAULT 1,
  paywalls INTEGER NOT NULL DEFAULT 1,
  growth INTEGER NOT NULL DEFAULT 1,
  web_billing INTEGER NOT NULL DEFAULT 1,
  extended_stores INTEGER NOT NULL DEFAULT 0,
  virtual_currencies INTEGER NOT NULL DEFAULT 1,
  scheduled_exports INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO billing_feature_flags (project_id)
SELECT CAST(id AS TEXT) FROM projects;

INSERT OR IGNORE INTO billing_events (
  id,
  project_id,
  application_id,
  customer_id,
  transaction_id,
  subscription_id,
  provider,
  environment,
  external_event_id,
  event_type,
  status,
  occurred_at,
  processed_at,
  payload
)
SELECT
  'backfill_' || t.id,
  t.project_id,
  t.application_id,
  t.customer_id,
  t.id,
  (
    SELECT s.id
    FROM billing_subscriptions s
    WHERE s.project_id = t.project_id
      AND s.store = t.store
      AND s.environment = t.environment
      AND s.original_transaction_id = COALESCE(t.original_transaction_id, t.store_transaction_id)
    LIMIT 1
  ),
  t.store,
  t.environment,
  t.store_transaction_id,
  CASE
    WHEN upper(t.event_type) LIKE '%TRANSFER%' THEN 'transferred'
    WHEN upper(t.event_type) LIKE '%REFUND_REVERSE%' THEN 'refund_reversed'
    WHEN upper(t.event_type) LIKE '%REFUND%' OR t.status = 'refunded' THEN 'refunded'
    WHEN upper(t.event_type) LIKE '%REVOK%' OR t.status = 'revoked' THEN 'revoked'
    WHEN upper(t.event_type) LIKE '%EXPIRE%' OR t.status = 'expired' THEN 'expired'
    WHEN upper(t.event_type) LIKE '%GRACE%' OR t.status = 'grace_period' THEN 'grace_period_started'
    WHEN upper(t.event_type) LIKE '%FAIL%' OR upper(t.event_type) LIKE '%BILLING_ISSUE%' OR t.status = 'billing_issue' THEN 'billing_issue'
    WHEN upper(t.event_type) LIKE '%UNCANCEL%' OR upper(t.event_type) LIKE '%REACTIV%' THEN 'reactivated'
    WHEN upper(t.event_type) LIKE '%CANCEL%' OR upper(t.event_type) LIKE '%DID_CHANGE_RENEWAL_STATUS%' OR t.status = 'cancelled' THEN 'cancelled'
    WHEN upper(t.event_type) LIKE '%PRODUCT_CHANGE%' OR upper(t.event_type) LIKE '%UPGRADE%' OR upper(t.event_type) LIKE '%DOWNGRADE%' THEN 'product_changed'
    WHEN upper(t.event_type) LIKE '%TRIAL_CONVERT%' THEN 'trial_converted'
    WHEN t.status = 'trialing' THEN 'trial_started'
    WHEN upper(t.event_type) LIKE '%RENEW%' THEN 'renewal'
    ELSE 'initial_purchase'
  END,
  'processed',
  COALESCE(t.purchased_at, t.verified_at, t.created_at),
  COALESCE(t.verified_at, t.created_at),
  t.raw_payload
FROM billing_transactions t;
