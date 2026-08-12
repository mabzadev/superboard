-- Durable producer outbox for canonical Analytics facts.
-- The central API/Billing D1 transaction commits a verified domain fact and
-- this delivery record together; Analytics then applies its own event receipt.

CREATE TABLE IF NOT EXISTS analytics_fact_outbox (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivering', 'delivered', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, fact_key),
  UNIQUE (project_id, event_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analytics_fact_outbox_delivery_idx
  ON analytics_fact_outbox (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS analytics_fact_outbox_project_idx
  ON analytics_fact_outbox (project_id, status, created_at DESC);
