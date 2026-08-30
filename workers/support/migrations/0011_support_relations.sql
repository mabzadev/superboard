PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_contact_inboxes (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  contact_id TEXT NOT NULL REFERENCES support_contacts(id) ON DELETE CASCADE,
  inbox_id TEXT NOT NULL REFERENCES support_inboxes(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, inbox_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_support_contact_inboxes_contact
  ON support_contact_inboxes(project_id, contact_id);

CREATE TABLE IF NOT EXISTS support_labels (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#64748b',
  description TEXT,
  show_on_sidebar INTEGER NOT NULL DEFAULT 0 CHECK (show_on_sidebar IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS support_conversation_labels (
  project_id INTEGER NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES support_labels(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(conversation_id, label_id)
);

CREATE TABLE IF NOT EXISTS support_contact_labels (
  project_id INTEGER NOT NULL,
  contact_id TEXT NOT NULL REFERENCES support_contacts(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES support_labels(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(contact_id, label_id)
);

CREATE TABLE IF NOT EXISTS support_custom_attribute_definitions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  attribute_key TEXT NOT NULL,
  model TEXT NOT NULL CHECK (model IN ('contact', 'conversation')),
  value_type TEXT NOT NULL CHECK (value_type IN ('text', 'number', 'date', 'boolean', 'list', 'link')),
  description TEXT,
  allowed_values_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_values_json)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, model, attribute_key)
);

CREATE TABLE IF NOT EXISTS support_segments (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  model TEXT NOT NULL CHECK (model IN ('contact', 'conversation')),
  query_json TEXT NOT NULL CHECK (json_valid(query_json)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS support_import_jobs (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  resource_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(checkpoint_json)),
  result_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(result_json)),
  last_error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS support_export_jobs (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  resource_type TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(filters_json)),
  storage_key TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  result_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(result_json)),
  last_error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

ALTER TABLE conversations ADD COLUMN display_id INTEGER;
ALTER TABLE conversations ADD COLUMN muted_until TEXT;
ALTER TABLE conversations ADD COLUMN unread_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_project_display
  ON conversations(project_id, display_id) WHERE display_id IS NOT NULL;

ALTER TABLE messages ADD COLUMN edited_at TEXT;
ALTER TABLE messages ADD COLUMN deleted_at TEXT;
ALTER TABLE messages ADD COLUMN failure_reason TEXT;
ALTER TABLE messages ADD COLUMN provider_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_provider_message
  ON messages(provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_project_sequences (
  project_id INTEGER NOT NULL,
  sequence_name TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(project_id, sequence_name)
);

INSERT OR IGNORE INTO support_labels (id, project_id, name, color, description, show_on_sidebar, active)
SELECT id, project_id, name,
  COALESCE(json_extract(configuration_json, '$.color'), '#64748b'),
  json_extract(configuration_json, '$.description'),
  COALESCE(json_extract(configuration_json, '$.show_on_sidebar'), 0),
  enabled
FROM support_configuration_entities WHERE entity_type = 'label';
