PRAGMA foreign_keys = ON;

-- Public Help Center paths contain a portal slug but no project identifier.
-- A globally unique, case-insensitive slug is therefore the public tenant
-- boundary. The Dashboard still scopes every CRUD operation by project_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_portals_public_slug
  ON support_portals(lower(slug));

CREATE TABLE IF NOT EXISTS support_macros (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  actions_json TEXT NOT NULL CHECK (json_valid(actions_json)),
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS support_canned_responses (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  shortcut TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name),
  UNIQUE(project_id, shortcut)
);

CREATE INDEX IF NOT EXISTS idx_support_macros_active
  ON support_macros(project_id, active, position, name);
CREATE INDEX IF NOT EXISTS idx_support_canned_responses_active
  ON support_canned_responses(project_id, active, position, name);

CREATE TABLE IF NOT EXISTS support_integration_credentials (
  integration_id TEXT PRIMARY KEY
    REFERENCES support_integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  encrypted_payload TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_integration_credentials_project
  ON support_integration_credentials(project_id, integration_id);

INSERT OR IGNORE INTO support_integrations
  (id, project_id, provider, display_name, status, settings_json, created_at, updated_at)
SELECT id, project_id, 'webhook', name, 'configuration_required',
  json_object(
    'endpoint_url', json_extract(configuration_json, '$.url'),
    'events', COALESCE(json_extract(configuration_json, '$.events'), json('[]'))
  ),
  created_at, updated_at
FROM support_configuration_entities
WHERE entity_type = 'webhook'
  AND json_type(configuration_json, '$.url') = 'text';

-- One-time native projection for installations that still contain metadata
-- written by an earlier Support settings editor. Runtime code never reads the
-- metadata catalogue after this migration.
INSERT OR IGNORE INTO support_macros
  (id, project_id, name, actions_json, position, active, created_by, created_at, updated_at)
SELECT id, project_id, name,
  COALESCE(json_extract(configuration_json, '$.actions'), '[]'),
  position, enabled, created_by, created_at, updated_at
FROM support_configuration_entities
WHERE entity_type = 'macro'
  AND json_type(configuration_json, '$.actions') = 'array';

INSERT OR IGNORE INTO support_canned_responses
  (id, project_id, name, content, shortcut, position, active, created_by, created_at, updated_at)
SELECT id, project_id, name,
  COALESCE(json_extract(configuration_json, '$.content'), ''),
  json_extract(configuration_json, '$.shortcut'),
  position, enabled, created_by, created_at, updated_at
FROM support_configuration_entities
WHERE entity_type = 'canned_response'
  AND json_type(configuration_json, '$.content') = 'text';
