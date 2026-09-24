CREATE TABLE IF NOT EXISTS identity_admin_resource_scope (
  realm TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL CHECK (project_id > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (realm, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS identity_admin_resource_scope_project_idx
  ON identity_admin_resource_scope (realm, project_id, resource_type, resource_id);
