CREATE TABLE IF NOT EXISTS billing_release_gate_checks (
  project_id TEXT NOT NULL,
  check_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed')),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  verified_by TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, check_key),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS billing_release_gate_status_idx
  ON billing_release_gate_checks (project_id, status, updated_at DESC);
