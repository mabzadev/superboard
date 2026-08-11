CREATE TABLE IF NOT EXISTS growth_lifecycle_outbox (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'payment_failed',
    'entitlement_expired',
    'refund_granted',
    'refund_reversed',
    'renewal_succeeded',
    'churn_risk'
  )),
  subject_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'projected', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  projected_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source_id, event_type)
);

CREATE INDEX IF NOT EXISTS growth_lifecycle_outbox_delivery_idx
  ON growth_lifecycle_outbox (status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS growth_lifecycle_outbox_project_idx
  ON growth_lifecycle_outbox (project_id, created_at DESC);
