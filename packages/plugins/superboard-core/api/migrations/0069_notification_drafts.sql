CREATE TABLE IF NOT EXISTS notification_drafts (
  notification_id INTEGER PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
