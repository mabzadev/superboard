PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_webhook_secrets (
  webhook_id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  encrypted_secret TEXT NOT NULL,
  secret_version INTEGER NOT NULL DEFAULT 1 CHECK (secret_version > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY(webhook_id) REFERENCES support_configuration_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_support_webhook_secrets_project
  ON support_webhook_secrets(project_id, webhook_id);

CREATE TABLE IF NOT EXISTS support_secret_audit_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  webhook_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('configured', 'rotated', 'revoked')),
  secret_version INTEGER,
  actor_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_secret_audit_project_created
  ON support_secret_audit_events(project_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS support_secret_audit_no_update
BEFORE UPDATE ON support_secret_audit_events
BEGIN
  SELECT RAISE(ABORT, 'support secret audit events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS support_secret_audit_no_delete
BEFORE DELETE ON support_secret_audit_events
BEGIN
  SELECT RAISE(ABORT, 'support secret audit events are immutable');
END;
