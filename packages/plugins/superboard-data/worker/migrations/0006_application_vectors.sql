CREATE TABLE IF NOT EXISTS data_vector_collections (
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  read_rule TEXT NOT NULL DEFAULT 'owner' CHECK (read_rule IN ('public','authenticated','owner','service')),
  write_rule TEXT NOT NULL DEFAULT 'owner' CHECK (write_rule IN ('public','authenticated','owner','service')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, name)
);

CREATE TABLE IF NOT EXISTS data_vector_items (
  project_id INTEGER NOT NULL,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  owner_id TEXT,
  content TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  vector_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, collection, id)
);

CREATE INDEX IF NOT EXISTS idx_data_vector_items_owner
  ON data_vector_items(project_id, collection, owner_id);
