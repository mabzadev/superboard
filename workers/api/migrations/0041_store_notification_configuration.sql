CREATE TABLE IF NOT EXISTS billing_store_notification_configurations (
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('apple', 'google', 'stripe')),
  ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1)),
  current_configuration TEXT NOT NULL DEFAULT '{}',
  required_configuration TEXT NOT NULL DEFAULT '{}',
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  configured_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, provider),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_billing_store_notification_configurations_readiness
  ON billing_store_notification_configurations(provider, ready, checked_at);
