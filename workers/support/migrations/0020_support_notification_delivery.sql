PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_notification_delivery_outbox (
  notification_id TEXT PRIMARY KEY
    REFERENCES support_agent_notifications(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'queued', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  claimed_at TEXT,
  next_attempt_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_error TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_notification_delivery_due
  ON support_notification_delivery_outbox(status, next_attempt_at, created_at);

CREATE TRIGGER IF NOT EXISTS support_notification_delivery_enqueue
AFTER INSERT ON support_agent_notifications
BEGIN
  INSERT OR IGNORE INTO support_notification_delivery_outbox
    (notification_id, project_id)
  VALUES (NEW.id, NEW.project_id);
END;

-- A deployment may already contain unread Support notifications. Backfill them
-- through the same idempotent pipeline instead of requiring special rollout
-- code. The production-empty case is naturally a no-op.
INSERT OR IGNORE INTO support_notification_delivery_outbox
  (notification_id, project_id)
SELECT id, project_id
FROM support_agent_notifications
WHERE deleted_at IS NULL AND read_at IS NULL;
