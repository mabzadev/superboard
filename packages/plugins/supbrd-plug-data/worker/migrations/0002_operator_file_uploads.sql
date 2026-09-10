CREATE TABLE IF NOT EXISTS operator_file_uploads (
 id TEXT PRIMARY KEY, project_id INTEGER NOT NULL, operation_id TEXT NOT NULL,
 request_hash TEXT NOT NULL, filename TEXT NOT NULL, content_type TEXT NOT NULL,
 byte_size INTEGER NOT NULL CHECK(byte_size>0), object_key TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('created','uploading','uploaded','completed')),
 etag TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(project_id,operation_id)
);
CREATE INDEX IF NOT EXISTS idx_operator_file_uploads_expiry ON operator_file_uploads(project_id,state,expires_at);
CREATE TABLE IF NOT EXISTS operator_files (
 id TEXT PRIMARY KEY, project_id INTEGER NOT NULL, filename TEXT NOT NULL,
 content_type TEXT NOT NULL, byte_size INTEGER NOT NULL, object_key TEXT NOT NULL UNIQUE,
 etag TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_operator_files_project ON operator_files(project_id,deleted_at,id);
