ALTER TABLE notifications ADD COLUMN support_event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_support_event
  ON notifications(support_event_id)
  WHERE support_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_notification_ingress (
  event_id TEXT PRIMARY KEY,
  payload_sha256 TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  recipient_user_id TEXT NOT NULL,
  notification_id INTEGER REFERENCES notifications(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed')),
  browser_messages INTEGER NOT NULL DEFAULT 0,
  push_queued INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_support_notification_ingress_status
  ON support_notification_ingress(status, updated_at);
