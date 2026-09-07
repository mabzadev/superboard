CREATE TABLE IF NOT EXISTS mcp_site_operator_grants (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('code', 'token')),
  resource_key TEXT NOT NULL,
  instance_slug TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_role INTEGER NOT NULL CHECK (operator_role BETWEEN 40 AND 50),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (resource_type, resource_key)
);
CREATE INDEX IF NOT EXISTS idx_mcp_site_operator_grants_owner
  ON mcp_site_operator_grants(instance_slug, operator_id, resource_type);
