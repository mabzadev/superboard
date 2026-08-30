PRAGMA foreign_keys = ON;

-- Integration authorization states are intentionally separate from channel
-- authorization states: every opaque state is bound to one project,
-- integration and credential version, then atomically consumed once.
CREATE TABLE IF NOT EXISTS support_integration_oauth_states (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  integration_id TEXT NOT NULL
    REFERENCES support_integrations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  credential_version INTEGER NOT NULL CHECK (credential_version > 0),
  state_hash TEXT NOT NULL UNIQUE,
  verifier_encrypted TEXT,
  callback_uri TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_integration_oauth_states_expiry
  ON support_integration_oauth_states(expires_at, consumed_at);

CREATE INDEX IF NOT EXISTS idx_support_integration_oauth_states_scope
  ON support_integration_oauth_states(project_id, integration_id, provider);
