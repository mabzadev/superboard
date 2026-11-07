CREATE TABLE IF NOT EXISTS data_buckets (
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  public INTEGER NOT NULL DEFAULT 0 CHECK (public IN (0,1)),
  max_bytes INTEGER NOT NULL CHECK (max_bytes > 0),
  allowed_types_json TEXT NOT NULL DEFAULT '[]',
  read_rule TEXT NOT NULL DEFAULT 'owner' CHECK (read_rule IN ('public','authenticated','owner','service')),
  write_rule TEXT NOT NULL DEFAULT 'owner' CHECK (write_rule IN ('public','authenticated','owner','service')),
  delete_rule TEXT NOT NULL DEFAULT 'owner' CHECK (delete_rule IN ('public','authenticated','owner','service')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, name)
);

CREATE TABLE IF NOT EXISTS data_objects (
  project_id INTEGER NOT NULL,
  bucket TEXT NOT NULL,
  path TEXT NOT NULL,
  owner_id TEXT,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  etag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, bucket, path)
);

CREATE INDEX IF NOT EXISTS idx_data_objects_owner
  ON data_objects(project_id, bucket, owner_id, path);

CREATE TABLE IF NOT EXISTS data_uploads (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  bucket TEXT NOT NULL,
  path TEXT NOT NULL,
  owner_id TEXT,
  content_type TEXT NOT NULL,
  r2_upload_id TEXT NOT NULL,
  upsert INTEGER NOT NULL DEFAULT 0 CHECK (upsert IN (0,1)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_data_uploads_project ON data_uploads(project_id, bucket);
CREATE INDEX IF NOT EXISTS idx_data_uploads_expiry ON data_uploads(expires_at);

CREATE TABLE IF NOT EXISTS data_upload_parts (
  upload_id TEXT NOT NULL,
  part_number INTEGER NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
  etag TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (upload_id, part_number)
);
