PRAGMA foreign_keys = ON;

-- Immutable bootstrap schema deployed with the original Support stub.
-- The canonical schema is introduced by 0002a_support_base_upgrade.sql.
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS support_inbox
  ON conversations(project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  profile_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(profile_json)),
  UNIQUE(project_id, external_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
