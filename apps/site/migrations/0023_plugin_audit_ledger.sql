CREATE TABLE IF NOT EXISTS superboard_audit_heads (
 instance_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL DEFAULT 0, hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS superboard_audit_entries (
 instance_id TEXT NOT NULL, sequence INTEGER NOT NULL, operation_id TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), previous_hash TEXT NOT NULL,
 hash TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(instance_id, sequence), UNIQUE(instance_id, operation_id)
);
CREATE INDEX IF NOT EXISTS idx_superboard_audit_entries_created ON superboard_audit_entries(instance_id,created_at,sequence);
CREATE TRIGGER IF NOT EXISTS superboard_audit_entries_immutable_update BEFORE UPDATE ON superboard_audit_entries BEGIN SELECT RAISE(ABORT,'Audit entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS superboard_audit_entries_immutable_delete BEFORE DELETE ON superboard_audit_entries BEGIN SELECT RAISE(ABORT,'Audit entries are immutable'); END;
CREATE TABLE IF NOT EXISTS superboard_audit_archives (
 instance_id TEXT NOT NULL, archive_id TEXT NOT NULL, from_sequence INTEGER NOT NULL,
 to_sequence INTEGER NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 checksum TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(instance_id,archive_id)
);
CREATE TABLE IF NOT EXISTS superboard_audit_cursors (
 instance_id TEXT PRIMARY KEY, completed_at TEXT NOT NULL, operation_id TEXT NOT NULL
);
