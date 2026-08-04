CREATE TABLE growth_app_snapshots_v2 (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('app', 'competitor')),
  entity_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('app_store_connect', 'google_play', 'apple_lookup', 'apptweak', 'manual')),
  observed_date TEXT NOT NULL,
  title TEXT,
  version TEXT,
  rating REAL,
  rating_count INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entity_type, entity_id, source, observed_date)
);

INSERT INTO growth_app_snapshots_v2 (
  id, project_id, entity_type, entity_id, source, observed_date,
  title, version, rating, rating_count, metadata_json, created_at
)
SELECT
  id, project_id, entity_type, entity_id, source, observed_date,
  title, version, rating, rating_count, metadata_json, created_at
FROM growth_app_snapshots;

DROP TABLE growth_app_snapshots;
ALTER TABLE growth_app_snapshots_v2 RENAME TO growth_app_snapshots;

CREATE INDEX growth_app_snapshots_project_idx
  ON growth_app_snapshots (project_id, entity_type, observed_date DESC);
