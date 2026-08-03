ALTER TABLE notifications ADD COLUMN automation_run_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_automation_run_idx
  ON notifications (automation_run_id)
  WHERE automation_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS growth_delivery_receipts (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('chat', 'push', 'in_app')),
  subject_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'delivered', 'failed')),
  notification_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS growth_delivery_receipts_project_idx
  ON growth_delivery_receipts (project_id, status, created_at DESC);
