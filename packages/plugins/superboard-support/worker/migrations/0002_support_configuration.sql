PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_project_settings (
  project_id INTEGER PRIMARY KEY,
  business_name TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'en',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  date_format TEXT NOT NULL DEFAULT 'YYYY-MM-DD',
  auto_resolve_minutes INTEGER CHECK (auto_resolve_minutes IS NULL OR auto_resolve_minutes >= 0),
  attachment_max_bytes INTEGER NOT NULL DEFAULT 10485760 CHECK (attachment_max_bytes BETWEEN 1 AND 10485760),
  allowed_content_types_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_content_types_json)),
  features_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(features_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS support_configuration_entities (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'inbox', 'agent', 'team', 'label', 'canned_response', 'macro',
    'custom_attribute', 'automation_rule', 'assignment_policy', 'sla_policy',
    'webhook', 'working_hours', 'notification_preference', 'saved_filter',
    'campaign', 'integration', 'agent_bot', 'capacity_policy', 'leave_schedule',
    'dashboard_app', 'email_template'
  )),
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  configuration_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(configuration_json)),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, entity_type, name)
);

CREATE INDEX IF NOT EXISTS idx_support_configuration_entities_project_type
  ON support_configuration_entities(project_id, entity_type, position, name);

CREATE TABLE IF NOT EXISTS support_configuration_audit_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  entity_id TEXT,
  entity_type TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  actor_id TEXT NOT NULL,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_configuration_audit_project_created
  ON support_configuration_audit_events(project_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS support_configuration_audit_no_update
BEFORE UPDATE ON support_configuration_audit_events
BEGIN
  SELECT RAISE(ABORT, 'support configuration audit events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS support_configuration_audit_no_delete
BEFORE DELETE ON support_configuration_audit_events
BEGIN
  SELECT RAISE(ABORT, 'support configuration audit events are immutable');
END;

ALTER TABLE conversations ADD COLUMN inbox_id TEXT;
ALTER TABLE conversations ADD COLUMN assigned_team_id TEXT;
ALTER TABLE conversations ADD COLUMN custom_attributes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(custom_attributes_json));
ALTER TABLE conversations ADD COLUMN snoozed_until TEXT;
ALTER TABLE conversations ADD COLUMN first_reply_at TEXT;
ALTER TABLE conversations ADD COLUMN resolved_at TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_inbox
  ON conversations(project_id, inbox_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_team
  ON conversations(project_id, assigned_team_id, status, updated_at DESC);
