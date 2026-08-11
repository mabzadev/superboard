PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_idempotency_keys (
  project_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  request_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('processing', 'completed')),
  response_status INTEGER,
  response_body TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  PRIMARY KEY(project_id, key)
);

CREATE INDEX IF NOT EXISTS idx_support_idempotency_created
  ON support_idempotency_keys(project_id, created_at);
