CREATE TABLE IF NOT EXISTS core_collection_cursors (
  consumer TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  PRIMARY KEY (consumer, project_id)
);
