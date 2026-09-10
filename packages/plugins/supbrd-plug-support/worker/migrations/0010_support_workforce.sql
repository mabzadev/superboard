PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_memberships (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  auth_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('supervisor', 'agent')),
  availability TEXT NOT NULL DEFAULT 'offline' CHECK (availability IN ('online', 'busy', 'offline')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  capacity INTEGER NOT NULL DEFAULT 10 CHECK (capacity BETWEEN 0 AND 10000),
  auto_offline INTEGER NOT NULL DEFAULT 0 CHECK (auto_offline IN (0, 1)),
  last_active_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, auth_user_id)
);

CREATE INDEX IF NOT EXISTS idx_support_memberships_project_role
  ON support_memberships(project_id, active, role, availability);

CREATE TABLE IF NOT EXISTS support_teams (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  allow_auto_assign INTEGER NOT NULL DEFAULT 1 CHECK (allow_auto_assign IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS support_team_members (
  project_id INTEGER NOT NULL,
  team_id TEXT NOT NULL REFERENCES support_teams(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES support_memberships(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(team_id, membership_id)
);

CREATE INDEX IF NOT EXISTS idx_support_team_members_membership
  ON support_team_members(project_id, membership_id);

CREATE TABLE IF NOT EXISTS support_inboxes (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  identifier TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'degraded')),
  auto_assignment INTEGER NOT NULL DEFAULT 1 CHECK (auto_assignment IN (0, 1)),
  allow_reopen INTEGER NOT NULL DEFAULT 1 CHECK (allow_reopen IN (0, 1)),
  csat_enabled INTEGER NOT NULL DEFAULT 0 CHECK (csat_enabled IN (0, 1)),
  settings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, identifier)
);

CREATE INDEX IF NOT EXISTS idx_support_inboxes_project_status
  ON support_inboxes(project_id, status, channel_type);

CREATE TABLE IF NOT EXISTS support_inbox_members (
  project_id INTEGER NOT NULL,
  inbox_id TEXT NOT NULL REFERENCES support_inboxes(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES support_memberships(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(inbox_id, membership_id)
);

CREATE INDEX IF NOT EXISTS idx_support_inbox_members_membership
  ON support_inbox_members(project_id, membership_id);

CREATE TABLE IF NOT EXISTS support_capacity_policies (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  default_capacity INTEGER NOT NULL CHECK (default_capacity BETWEEN 0 AND 10000),
  priority_limits_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(priority_limits_json)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS support_leave_schedules (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  membership_id TEXT NOT NULL REFERENCES support_memberships(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_support_leave_schedules_active
  ON support_leave_schedules(project_id, membership_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS support_assignment_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  policy_id TEXT,
  membership_id TEXT REFERENCES support_memberships(id) ON DELETE SET NULL,
  team_id TEXT REFERENCES support_teams(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_assignment_events_project_created
  ON support_assignment_events(project_id, created_at DESC);

INSERT OR IGNORE INTO support_memberships (
  id, project_id, auth_user_id, display_name, role, availability, active, capacity, auto_offline
)
SELECT id, project_id,
  json_extract(configuration_json, '$.auth_user_id'),
  COALESCE(json_extract(configuration_json, '$.display_name'), name),
  CASE WHEN json_extract(configuration_json, '$.role') = 'supervisor' THEN 'supervisor' ELSE 'agent' END,
  COALESCE(json_extract(configuration_json, '$.availability'), 'offline'),
  enabled,
  COALESCE(json_extract(configuration_json, '$.capacity'), 10),
  COALESCE(json_extract(configuration_json, '$.auto_offline'), 0)
FROM support_configuration_entities
WHERE entity_type = 'agent'
  AND json_type(configuration_json, '$.auth_user_id') = 'text';

INSERT OR IGNORE INTO support_teams (id, project_id, name, description, allow_auto_assign, active)
SELECT id, project_id, name,
  json_extract(configuration_json, '$.description'),
  COALESCE(json_extract(configuration_json, '$.allow_auto_assign'), 1),
  enabled
FROM support_configuration_entities WHERE entity_type = 'team';

INSERT OR IGNORE INTO support_inboxes (
  id, project_id, name, identifier, channel_type, status, auto_assignment, allow_reopen, csat_enabled, settings_json
)
SELECT id, project_id, name,
  COALESCE(json_extract(configuration_json, '$.identifier'), id),
  COALESCE(json_extract(configuration_json, '$.channel_type'), 'api'),
  CASE WHEN enabled = 1 THEN 'active' ELSE 'disabled' END,
  COALESCE(json_extract(configuration_json, '$.auto_assignment'), 1),
  COALESCE(json_extract(configuration_json, '$.allow_reopen'), 1),
  COALESCE(json_extract(configuration_json, '$.csat_enabled'), 0),
  configuration_json
FROM support_configuration_entities WHERE entity_type = 'inbox';
