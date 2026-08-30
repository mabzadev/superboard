CREATE TABLE flows_legacy_cutover_state (
  project_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  window_id TEXT,
  plan_id TEXT,
  verification_checksum_sha256 TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_flows_legacy_cutover_enabled
  ON flows_legacy_cutover_state(enabled, updated_at);

CREATE TABLE flows_legacy_cutover_commands (
  project_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_checksum_sha256 TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, idempotency_key),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_flows_legacy_cutover_commands_created
  ON flows_legacy_cutover_commands(project_id, created_at DESC);
