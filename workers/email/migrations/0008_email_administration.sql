CREATE TABLE IF NOT EXISTS email_smtp_profiles (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  encrypted_config TEXT NOT NULL,
  public_config_json TEXT NOT NULL CHECK (json_valid(public_config_json)),
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  hourly_quota INTEGER,
  daily_quota INTEGER,
  dkim_selector TEXT,
  authentication_status TEXT NOT NULL DEFAULT 'unverified',
  spf_status TEXT,
  dkim_status TEXT,
  dmarc_status TEXT,
  authentication_checked_at TEXT,
  last_tested_at TEXT,
  last_test_status TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_email_smtp_profiles_project ON email_smtp_profiles(project_id, priority, id);
CREATE TABLE IF NOT EXISTS email_message_senders (
  message_id TEXT PRIMARY KEY REFERENCES email_messages(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  public_config_json TEXT NOT NULL CHECK (json_valid(public_config_json)),
  encrypted_config TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_admin_audit_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  operator_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_email_admin_audit_project ON email_admin_audit_events(project_id, created_at);
CREATE TABLE IF NOT EXISTS email_admin_operations (
  project_id INTEGER NOT NULL,
  operation_key TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  response_json TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(project_id, operation_key)
);
CREATE TABLE IF NOT EXISTS email_webhook_endpoints (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_email_webhook_endpoints_project ON email_webhook_endpoints(project_id, id);
CREATE TABLE IF NOT EXISTS email_administration_imports (
  project_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(project_id, source, source_id)
);
CREATE TABLE IF NOT EXISTS email_webhook_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  endpoint_id TEXT REFERENCES email_webhook_endpoints(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  UNIQUE(project_id, provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_email_webhook_events_project ON email_webhook_events(project_id, occurred_at, id);
