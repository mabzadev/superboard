PRAGMA foreign_keys = ON;

ALTER TABLE smtp_profiles ADD COLUMN hourly_quota INTEGER CHECK (hourly_quota IS NULL OR hourly_quota > 0);
ALTER TABLE smtp_profiles ADD COLUMN daily_quota INTEGER CHECK (daily_quota IS NULL OR daily_quota > 0);

CREATE TABLE IF NOT EXISTS provider_webhook_endpoints (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_provider_webhooks_project
  ON provider_webhook_endpoints(project_id, enabled, provider);
