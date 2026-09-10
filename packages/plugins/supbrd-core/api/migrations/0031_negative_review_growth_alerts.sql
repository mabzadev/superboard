ALTER TABLE store_review_revisions ADD COLUMN growth_projected_at TEXT;
ALTER TABLE store_review_revisions ADD COLUMN growth_projection_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_review_revisions ADD COLUMN growth_projection_next_attempt_at TEXT;
ALTER TABLE store_review_revisions ADD COLUMN growth_projection_error TEXT;

CREATE INDEX IF NOT EXISTS idx_store_review_revisions_growth_projection
  ON store_review_revisions(growth_projected_at, growth_projection_next_attempt_at, growth_projection_attempts)
  WHERE rating <= 2;

CREATE TABLE IF NOT EXISTS inbox_automation_alerts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('store_review')),
  source_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'high' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_inbox_automation_alerts_source
  ON inbox_automation_alerts(project_id, source_type, source_id, status, updated_at DESC);

CREATE TABLE growth_delivery_receipts_new (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('chat', 'push', 'in_app', 'inbox')),
  subject_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'delivered', 'failed')),
  notification_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT
);

INSERT INTO growth_delivery_receipts_new (
  run_id, project_id, channel, subject_id, status, notification_id, last_error,
  created_at, updated_at, delivered_at
)
SELECT run_id, project_id, channel, subject_id, status, notification_id, last_error,
  created_at, updated_at, delivered_at
FROM growth_delivery_receipts;

DROP TABLE growth_delivery_receipts;
ALTER TABLE growth_delivery_receipts_new RENAME TO growth_delivery_receipts;

CREATE INDEX IF NOT EXISTS growth_delivery_receipts_project_idx
  ON growth_delivery_receipts (project_id, status, created_at DESC);
