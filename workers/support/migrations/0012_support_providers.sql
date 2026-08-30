PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_provider_endpoints (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  inbox_id TEXT REFERENCES support_inboxes(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'configuration_required'
    CHECK (status IN ('configuration_required', 'configured', 'validated', 'degraded', 'live_validated', 'disabled')),
  settings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
  last_validated_at TEXT,
  last_event_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, provider, display_name)
);

CREATE INDEX IF NOT EXISTS idx_support_provider_endpoints_project
  ON support_provider_endpoints(project_id, provider, status);

CREATE TABLE IF NOT EXISTS support_provider_credentials (
  endpoint_id TEXT PRIMARY KEY REFERENCES support_provider_endpoints(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  encrypted_payload TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_provider_credentials_project
  ON support_provider_credentials(project_id);

CREATE TABLE IF NOT EXISTS support_oauth_states (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  endpoint_id TEXT NOT NULL REFERENCES support_provider_endpoints(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  verifier_encrypted TEXT,
  callback_uri TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_oauth_states_expiry
  ON support_oauth_states(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS support_provider_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  endpoint_id TEXT NOT NULL REFERENCES support_provider_endpoints(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  headers_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(headers_json)),
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'processed', 'ignored', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(endpoint_id, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_support_provider_events_status
  ON support_provider_events(project_id, status, received_at);

CREATE TABLE IF NOT EXISTS support_provider_deliveries (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  endpoint_id TEXT NOT NULL REFERENCES support_provider_endpoints(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(request_json)),
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  last_error TEXT,
  next_attempt_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(endpoint_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_support_provider_deliveries_due
  ON support_provider_deliveries(project_id, status, next_attempt_at);

CREATE TABLE IF NOT EXISTS support_integrations (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'configuration_required'
    CHECK (status IN ('configuration_required', 'configured', 'validated', 'degraded', 'live_validated', 'disabled')),
  settings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, provider, display_name)
);

CREATE TABLE IF NOT EXISTS support_calls (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  endpoint_id TEXT REFERENCES support_provider_endpoints(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  provider_reference TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'ringing', 'active', 'completed', 'rejected', 'failed')),
  participants_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(participants_json)),
  recording_key TEXT,
  started_at TEXT,
  ended_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_calls_conversation
  ON support_calls(project_id, conversation_id, created_at DESC);
