CREATE TABLE IF NOT EXISTS core_collected_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  collection_key TEXT NOT NULL,
  event_name TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  trusted INTEGER NOT NULL DEFAULT 0 CHECK (trusted IN (0, 1)),
  format TEXT NOT NULL DEFAULT 'analytics' CHECK (format IN ('analytics', 'customer')),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, collection_key)
);
CREATE INDEX IF NOT EXISTS idx_core_collected_events_project_sequence
  ON core_collected_events (project_id, sequence);
CREATE INDEX IF NOT EXISTS idx_core_collected_events_project_event_sequence
  ON core_collected_events (project_id, event_name, sequence);

CREATE TRIGGER IF NOT EXISTS core_collect_legacy_fact
AFTER INSERT ON analytics_fact_outbox
BEGIN
  INSERT OR IGNORE INTO core_collected_events
    (project_id, collection_key, event_name, payload_json, trusted, received_at)
  VALUES (NEW.project_id, 'fact:' || NEW.fact_key,
    json_extract(NEW.payload_json, '$.event_name'), NEW.payload_json, 1, NEW.created_at);
END;

INSERT OR IGNORE INTO core_collected_events
  (project_id, collection_key, event_name, payload_json, trusted, received_at)
SELECT project_id, 'fact:' || fact_key, json_extract(payload_json, '$.event_name'),
  payload_json, 1, created_at
FROM analytics_fact_outbox ORDER BY created_at, id;
