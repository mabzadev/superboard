PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_assistants (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  instructions TEXT NOT NULL,
  response_mode TEXT NOT NULL DEFAULT 'suggestion' CHECK (response_mode IN ('suggestion', 'draft', 'automatic')),
  handoff_enabled INTEGER NOT NULL DEFAULT 1 CHECK (handoff_enabled IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS support_assistant_inboxes (
  project_id INTEGER NOT NULL,
  assistant_id TEXT NOT NULL REFERENCES support_assistants(id) ON DELETE CASCADE,
  inbox_id TEXT NOT NULL REFERENCES support_inboxes(id) ON DELETE CASCADE,
  automatic_enabled INTEGER NOT NULL DEFAULT 0 CHECK (automatic_enabled IN (0, 1)),
  configured_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(assistant_id, inbox_id)
);

CREATE TABLE IF NOT EXISTS support_assistant_scenarios (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  assistant_id TEXT NOT NULL REFERENCES support_assistants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(trigger_json)),
  instructions TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(assistant_id, name)
);

CREATE TABLE IF NOT EXISTS support_assistant_tools (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  assistant_id TEXT NOT NULL REFERENCES support_assistants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('GET', 'POST')),
  input_schema_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_schema_json)),
  headers_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(headers_json)),
  allowed INTEGER NOT NULL DEFAULT 0 CHECK (allowed IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(assistant_id, name)
);

CREATE TABLE IF NOT EXISTS support_copilot_threads (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  assistant_id TEXT REFERENCES support_assistants(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES support_memberships(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS support_copilot_messages (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  thread_id TEXT NOT NULL REFERENCES support_copilot_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(citations_json)),
  tool_calls_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tool_calls_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_copilot_messages_thread
  ON support_copilot_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS support_assistant_tasks (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  assistant_id TEXT REFERENCES support_assistants(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  task_type TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
  result_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(result_json)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  last_error TEXT,
  created_by TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS support_report_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  inbox_id TEXT REFERENCES support_inboxes(id) ON DELETE SET NULL,
  membership_id TEXT REFERENCES support_memberships(id) ON DELETE SET NULL,
  team_id TEXT REFERENCES support_teams(id) ON DELETE SET NULL,
  provider TEXT,
  occurred_at TEXT NOT NULL,
  dimensions_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(dimensions_json)),
  metrics_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_report_events_project_time
  ON support_report_events(project_id, occurred_at, event_type);

CREATE TABLE IF NOT EXISTS support_report_rollups (
  project_id INTEGER NOT NULL,
  bucket_start TEXT NOT NULL,
  interval TEXT NOT NULL CHECK (interval IN ('hour', 'day', 'week', 'month')),
  dimension_type TEXT NOT NULL,
  dimension_value TEXT NOT NULL,
  metrics_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(project_id, bucket_start, interval, dimension_type, dimension_value)
);
