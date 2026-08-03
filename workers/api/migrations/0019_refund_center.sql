-- Unified Refund Center for Apple, Google Play and Stripe.
-- Provider payloads are retained for reconciliation; human approval is required
-- before every outbound provider action.

CREATE TABLE IF NOT EXISTS billing_refund_cases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  customer_id TEXT,
  transaction_id TEXT,
  subscription_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('apple', 'google', 'stripe')),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  provider_case_id TEXT NOT NULL,
  case_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'evidence_required', 'awaiting_approval', 'submitted', 'won', 'lost', 'closed')
  ),
  reason TEXT,
  amount_micros INTEGER,
  currency TEXT,
  deadline_at TEXT,
  provider_payload TEXT NOT NULL DEFAULT '{}',
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES billing_customers(id) ON DELETE SET NULL,
  FOREIGN KEY (transaction_id) REFERENCES billing_transactions(id) ON DELETE SET NULL,
  FOREIGN KEY (subscription_id) REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
  UNIQUE(project_id, provider, environment, provider_case_id)
);

CREATE TABLE IF NOT EXISTS billing_refund_evidence (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  content TEXT,
  file_key TEXT,
  source TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('provider', 'admin', 'system')),
  review_status TEXT NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'approved', 'rejected')),
  created_by TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES billing_refund_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS billing_refund_provider_actions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'approved', 'queued', 'sent', 'failed', 'cancelled')
  ),
  idempotency_key TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_response TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES billing_refund_cases(id) ON DELETE CASCADE,
  UNIQUE(idempotency_key)
);

CREATE TABLE IF NOT EXISTS billing_refund_deadlines (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  deadline_type TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'met', 'missed', 'cancelled')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES billing_refund_cases(id) ON DELETE CASCADE,
  UNIQUE(case_id, deadline_type)
);

CREATE TABLE IF NOT EXISTS billing_refund_audit_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('provider', 'admin', 'system')),
  actor_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (case_id) REFERENCES billing_refund_cases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_billing_refund_cases_project_status
  ON billing_refund_cases(project_id, status, deadline_at);
CREATE INDEX IF NOT EXISTS idx_billing_refund_cases_customer
  ON billing_refund_cases(customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_refund_actions_status
  ON billing_refund_provider_actions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_billing_refund_deadlines_due
  ON billing_refund_deadlines(status, due_at);
CREATE INDEX IF NOT EXISTS idx_billing_refund_audit_case
  ON billing_refund_audit_events(case_id, occurred_at);

CREATE TRIGGER IF NOT EXISTS billing_refund_audit_no_update
BEFORE UPDATE ON billing_refund_audit_events
BEGIN
  SELECT RAISE(ABORT, 'refund audit events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS billing_refund_audit_no_delete
BEFORE DELETE ON billing_refund_audit_events
BEGIN
  SELECT RAISE(ABORT, 'refund audit events are immutable');
END;
