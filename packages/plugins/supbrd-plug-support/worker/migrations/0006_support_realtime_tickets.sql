PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_realtime_tickets (
  token_hash TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  conversation_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_support_realtime_tickets_expiry
  ON support_realtime_tickets(expires_at, consumed_at);
