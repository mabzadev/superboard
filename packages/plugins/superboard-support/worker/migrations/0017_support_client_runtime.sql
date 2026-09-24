PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_contact_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  contact_id TEXT NOT NULL REFERENCES support_contacts(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  properties_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(properties_json)),
  idempotency_key TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_support_contact_events_contact
  ON support_contact_events(project_id, contact_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS support_meetings (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  integration_id TEXT REFERENCES support_integrations(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'dyte',
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'active', 'completed', 'cancelled', 'failed')),
  join_url TEXT,
  expires_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, provider, provider_reference)
);

CREATE INDEX IF NOT EXISTS idx_support_meetings_conversation
  ON support_meetings(project_id, conversation_id, created_at DESC);
