PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS messaging_companies (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  domain TEXT,
  description TEXT,
  custom_attributes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(custom_attributes_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_messaging_companies_project_name
  ON messaging_companies(project_id, name);

CREATE TABLE IF NOT EXISTS messaging_contacts (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  external_user_id TEXT NOT NULL,
  name TEXT,
  email TEXT,
  phone TEXT,
  company_id TEXT REFERENCES messaging_companies(id) ON DELETE SET NULL,
  avatar_url TEXT,
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
  custom_attributes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(custom_attributes_json)),
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, external_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messaging_contacts_project_email
  ON messaging_contacts(project_id, email) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS idx_messaging_contacts_project_name
  ON messaging_contacts(project_id, name);

CREATE TABLE IF NOT EXISTS messaging_contact_notes (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  contact_id TEXT NOT NULL REFERENCES messaging_contacts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_messaging_contact_notes_contact_created
  ON messaging_contact_notes(project_id, contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS messaging_conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  participant_kind TEXT NOT NULL CHECK (participant_kind IN ('agent', 'team', 'contact')),
  participant_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(conversation_id, participant_kind, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_participants_project_participant
  ON messaging_conversation_participants(project_id, participant_kind, participant_id);

CREATE TABLE IF NOT EXISTS messaging_conversation_drafts (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachments_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(conversation_id, agent_id)
);

CREATE TABLE IF NOT EXISTS messaging_csat_responses (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  contact_external_user_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_messaging_csat_project_created
  ON messaging_csat_responses(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS messaging_agent_notifications (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_messaging_notifications_agent_unread
  ON messaging_agent_notifications(project_id, agent_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS messaging_operations_audit_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_messaging_operations_audit_project_created
  ON messaging_operations_audit_events(project_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS messaging_operations_audit_no_update
BEFORE UPDATE ON messaging_operations_audit_events
BEGIN
  SELECT RAISE(ABORT, 'messaging operations audit events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS messaging_operations_audit_no_delete
BEFORE DELETE ON messaging_operations_audit_events
BEGIN
  SELECT RAISE(ABORT, 'messaging operations audit events are immutable');
END;

CREATE TABLE IF NOT EXISTS messaging_rule_executions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  rule_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(rule_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_rule_executions_project_created
  ON messaging_rule_executions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS messaging_webhook_deliveries (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  webhook_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  last_error TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(webhook_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_messaging_webhook_deliveries_project_created
  ON messaging_webhook_deliveries(project_id, created_at DESC);

ALTER TABLE messages ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private'));
ALTER TABLE messages ADD COLUMN content_type TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'input_email', 'input_select', 'cards', 'form', 'activity'));
ALTER TABLE messages ADD COLUMN reply_to_message_id TEXT;
ALTER TABLE messages ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json));
ALTER TABLE messages ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('pending', 'sent', 'delivered', 'read', 'failed'));

CREATE INDEX IF NOT EXISTS idx_messages_public_history
  ON messages(conversation_id, visibility, sequence);
