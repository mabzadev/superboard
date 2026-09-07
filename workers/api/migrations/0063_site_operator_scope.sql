CREATE TABLE IF NOT EXISTS site_operator_instances (
  instance_slug TEXT PRIMARY KEY NOT NULL,
  instance_id INTEGER NOT NULL UNIQUE REFERENCES instances(id) ON DELETE CASCADE,
  linked_by TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
