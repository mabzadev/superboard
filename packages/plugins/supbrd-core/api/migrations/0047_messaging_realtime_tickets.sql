CREATE TABLE IF NOT EXISTS messaging_realtime_tickets (
  token_hash TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  project_external_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS messaging_realtime_tickets_expiry_idx
  ON messaging_realtime_tickets (expires_at, consumed_at);

CREATE INDEX IF NOT EXISTS messaging_realtime_tickets_scope_idx
  ON messaging_realtime_tickets (project_id, conversation_id, user_id);
