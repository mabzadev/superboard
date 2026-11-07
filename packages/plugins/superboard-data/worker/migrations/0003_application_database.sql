CREATE TABLE IF NOT EXISTS data_tables (
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  label TEXT,
  read_rule TEXT NOT NULL DEFAULT 'owner' CHECK (read_rule IN ('public','authenticated','owner','service')),
  insert_rule TEXT NOT NULL DEFAULT 'owner' CHECK (insert_rule IN ('public','authenticated','owner','service')),
  update_rule TEXT NOT NULL DEFAULT 'owner' CHECK (update_rule IN ('public','authenticated','owner','service')),
  delete_rule TEXT NOT NULL DEFAULT 'owner' CHECK (delete_rule IN ('public','authenticated','owner','service')),
  realtime INTEGER NOT NULL DEFAULT 0 CHECK (realtime IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, name)
);

CREATE TABLE IF NOT EXISTS data_columns (
  project_id INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text','integer','number','boolean','json','timestamp','uuid')),
  nullable INTEGER NOT NULL DEFAULT 1 CHECK (nullable IN (0,1)),
  default_json TEXT,
  is_unique INTEGER NOT NULL DEFAULT 0 CHECK (is_unique IN (0,1)),
  indexed INTEGER NOT NULL DEFAULT 0 CHECK (indexed IN (0,1)),
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, table_name, name)
);

CREATE TABLE IF NOT EXISTS data_service_keys (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  hint TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_data_service_keys_project
  ON data_service_keys(project_id, revoked_at, created_at);

CREATE TABLE IF NOT EXISTS data_project_settings (
  project_id INTEGER PRIMARY KEY,
  realtime_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (realtime_anonymous IN (0,1)),
  updated_at TEXT NOT NULL
);
