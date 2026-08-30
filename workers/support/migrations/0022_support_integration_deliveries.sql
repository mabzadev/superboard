PRAGMA foreign_keys = ON;

-- Native integration executions are persisted separately from the immutable
-- operations audit. Queue delivery is at-least-once, so the unique key below
-- is the local idempotency barrier for every external side effect.
CREATE TABLE IF NOT EXISTS support_integration_deliveries (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  integration_id TEXT NOT NULL
    REFERENCES support_integrations(id) ON DELETE CASCADE,
  conversation_id TEXT
    REFERENCES conversations(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  response_status INTEGER,
  result_reference TEXT,
  last_error_code TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, integration_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_support_integration_deliveries_status
  ON support_integration_deliveries(project_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_support_integration_deliveries_conversation
  ON support_integration_deliveries(project_id, conversation_id, created_at DESC);
