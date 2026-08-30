CREATE TABLE flow_version_translations (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version_id TEXT NOT NULL,
  block_key TEXT NOT NULL,
  property_key TEXT NOT NULL,
  locale TEXT NOT NULL,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workflow_version_id, block_key, property_key, locale),
  FOREIGN KEY (workflow_version_id) REFERENCES flow_workflow_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE
);

CREATE INDEX flow_version_translations_runtime_idx
  ON flow_version_translations (
    project_id,
    organization_id,
    workflow_version_id,
    locale,
    block_key,
    property_key
  );
