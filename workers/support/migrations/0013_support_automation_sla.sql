PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_automation_rules (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  event_name TEXT NOT NULL,
  condition_mode TEXT NOT NULL DEFAULT 'all' CHECK (condition_mode IN ('all', 'any')),
  conditions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(conditions_json)),
  actions_json TEXT NOT NULL CHECK (json_valid(actions_json)),
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_support_automation_rules_event
  ON support_automation_rules(project_id, event_name, active, position);

CREATE TABLE IF NOT EXISTS support_assignment_policies (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  policy_type TEXT NOT NULL CHECK (policy_type IN ('round_robin', 'balanced', 'manual')),
  queue_order TEXT NOT NULL DEFAULT 'oldest' CHECK (queue_order IN ('oldest', 'priority', 'recent')),
  max_assignments_per_agent INTEGER CHECK (max_assignments_per_agent BETWEEN 0 AND 10000),
  inbox_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(inbox_ids_json)),
  team_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(team_ids_json)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS support_working_hours (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  inbox_id TEXT REFERENCES support_inboxes(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL,
  weekly_schedule_json TEXT NOT NULL CHECK (json_valid(weekly_schedule_json)),
  closed_dates_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(closed_dates_json)),
  unavailable_message TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS support_sla_policies (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  first_response_minutes INTEGER NOT NULL CHECK (first_response_minutes BETWEEN 1 AND 525600),
  next_response_minutes INTEGER CHECK (next_response_minutes BETWEEN 1 AND 525600),
  resolution_minutes INTEGER NOT NULL CHECK (resolution_minutes BETWEEN 1 AND 525600),
  business_hours_only INTEGER NOT NULL DEFAULT 0 CHECK (business_hours_only IN (0, 1)),
  conditions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(conditions_json)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS support_applied_slas (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  policy_id TEXT NOT NULL REFERENCES support_sla_policies(id) ON DELETE RESTRICT,
  first_response_due_at TEXT,
  next_response_due_at TEXT,
  resolution_due_at TEXT,
  first_response_met_at TEXT,
  resolution_met_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'met', 'breached', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_applied_slas_due
  ON support_applied_slas(project_id, status, first_response_due_at, resolution_due_at);

CREATE TABLE IF NOT EXISTS support_sla_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  applied_sla_id TEXT NOT NULL REFERENCES support_applied_slas(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('warning', 'breach', 'met', 'cancelled')),
  target TEXT NOT NULL CHECK (target IN ('first_response', 'next_response', 'resolution')),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(applied_sla_id, event_type, target)
);

CREATE TABLE IF NOT EXISTS support_scheduled_jobs (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  job_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  queue_name TEXT NOT NULL CHECK (queue_name IN ('events', 'ai', 'bulk')),
  due_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'queued', 'completed', 'failed', 'cancelled')),
  claim_token TEXT,
  claimed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, job_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_support_scheduled_jobs_due
  ON support_scheduled_jobs(status, due_at);

INSERT OR IGNORE INTO support_automation_rules (
  id, project_id, name, event_name, condition_mode, conditions_json, actions_json, position, active, created_by
)
SELECT id, project_id, name,
  json_extract(configuration_json, '$.event_name'), 'all',
  COALESCE(json_extract(configuration_json, '$.conditions'), '[]'),
  COALESCE(json_extract(configuration_json, '$.actions'), '[]'),
  position, enabled, COALESCE(created_by, 'system')
FROM support_configuration_entities
WHERE entity_type = 'automation_rule'
  AND json_type(configuration_json, '$.event_name') = 'text';
