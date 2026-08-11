PRAGMA foreign_keys = OFF;

-- 0001 was already deployed as a minimal stub before Support became a full
-- module. Rebuild that table once so existing installations and fresh D1s
-- converge on the same canonical schema before the operational migrations.
ALTER TABLE conversations RENAME TO support_stub_conversations;

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  external_user_id TEXT NOT NULL,
  client_conversation_id TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_user_id TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(labels_json)),
  last_message_preview TEXT,
  last_message_at TEXT,
  user_last_read_at TEXT,
  agent_last_read_at TEXT,
  inbox_id TEXT,
  assigned_team_id TEXT,
  custom_attributes_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(custom_attributes_json)),
  snoozed_until TEXT,
  first_reply_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, external_user_id, client_conversation_id)
);

INSERT INTO conversations (
  id, project_id, external_user_id, client_conversation_id, subject, status,
  inbox_id, assigned_team_id, custom_attributes_json, snoozed_until,
  first_reply_at, resolved_at, created_at, updated_at
)
SELECT
  id,
  CAST(project_id AS INTEGER),
  'legacy:' || id,
  'legacy:' || id,
  subject,
  status,
  inbox_id,
  assigned_team_id,
  custom_attributes_json,
  snoozed_until,
  first_reply_at,
  resolved_at,
  COALESCE(updated_at, datetime('now')),
  COALESCE(updated_at, datetime('now'))
FROM support_stub_conversations;

DROP TABLE support_stub_conversations;

CREATE INDEX idx_conversations_project_activity
  ON conversations(project_id, updated_at DESC);
CREATE INDEX idx_conversations_user_activity
  ON conversations(project_id, external_user_id, updated_at DESC);
CREATE INDEX idx_conversations_assignment
  ON conversations(project_id, assigned_user_id, status, priority);
CREATE INDEX idx_conversations_inbox
  ON conversations(project_id, inbox_id, status, updated_at DESC);
CREATE INDEX idx_conversations_team
  ON conversations(project_id, assigned_team_id, status, updated_at DESC);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('user', 'agent', 'system')),
  sender_id TEXT NOT NULL,
  body TEXT,
  attachment_key TEXT,
  attachment_name TEXT,
  attachment_content_type TEXT,
  client_message_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(conversation_id, client_message_id),
  CHECK (body IS NOT NULL OR attachment_key IS NOT NULL)
);

CREATE UNIQUE INDEX idx_messages_conversation_sequence
  ON messages(conversation_id, sequence);

CREATE TABLE support_audit_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  project_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system')),
  actor_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_support_audit_project_created
  ON support_audit_events(project_id, created_at DESC);

CREATE TRIGGER support_audit_no_update
BEFORE UPDATE ON support_audit_events
BEGIN
  SELECT RAISE(ABORT, 'support audit events are immutable');
END;

CREATE TRIGGER support_audit_no_delete
BEFORE DELETE ON support_audit_events
BEGIN
  SELECT RAISE(ABORT, 'support audit events are immutable');
END;

PRAGMA foreign_keys = ON;
