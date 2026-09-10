ALTER TABLE ios_server_api_keys ADD COLUMN billing_encrypted_key TEXT;
ALTER TABLE android_server_api_keys ADD COLUMN billing_encrypted_key TEXT;

CREATE TABLE IF NOT EXISTS billing_credential_rewrap_audit (
  id TEXT PRIMARY KEY,
  source_table TEXT NOT NULL CHECK (source_table IN ('ios_server_api_keys', 'android_server_api_keys')),
  source_id TEXT NOT NULL,
  target_key_version TEXT NOT NULL,
  actor TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER IF NOT EXISTS billing_credential_rewrap_audit_no_update
BEFORE UPDATE ON billing_credential_rewrap_audit
BEGIN
  SELECT RAISE(ABORT, 'billing credential rewrap audit is immutable');
END;

CREATE TRIGGER IF NOT EXISTS billing_credential_rewrap_audit_no_delete
BEFORE DELETE ON billing_credential_rewrap_audit
BEGIN
  SELECT RAISE(ABORT, 'billing credential rewrap audit is immutable');
END;
