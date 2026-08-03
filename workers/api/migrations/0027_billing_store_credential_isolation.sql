ALTER TABLE billing_store_connections ADD COLUMN billing_configuration_encrypted TEXT;

CREATE TABLE IF NOT EXISTS billing_store_credential_audit (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL,
  operation TEXT NOT NULL,
  actor_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (connection_id) REFERENCES billing_store_connections(id) ON DELETE RESTRICT
);

CREATE TRIGGER IF NOT EXISTS billing_store_credential_audit_no_update
BEFORE UPDATE ON billing_store_credential_audit
BEGIN
  SELECT RAISE(ABORT, 'billing store credential audit is immutable');
END;

CREATE TRIGGER IF NOT EXISTS billing_store_credential_audit_no_delete
BEFORE DELETE ON billing_store_credential_audit
BEGIN
  SELECT RAISE(ABORT, 'billing store credential audit is immutable');
END;
