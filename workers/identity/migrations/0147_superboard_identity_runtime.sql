PRAGMA foreign_keys = ON;

-- D1-backed replacement for Melody's eventually-consistent KV state. OAuth
-- codes, refresh tokens, MFA challenges and replay markers all remain on the
-- same strongly-consistent database as the identity records.
CREATE TABLE melody_runtime_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  encoding TEXT NOT NULL DEFAULT 'text' CHECK (encoding IN ('text', 'base64')),
  metadata_json TEXT,
  expires_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX melody_runtime_kv_expiry_idx
  ON melody_runtime_kv(expires_at) WHERE expires_at IS NOT NULL;

-- Stable bridge between Melody's numeric rows and SuperBoard's public UUIDs.
-- Control-plane users may have no project/application row during the overlap;
-- project application users always retain their canonical SuperBoard id.
CREATE TABLE identity_subject_bridge (
  id TEXT PRIMARY KEY,
  realm TEXT NOT NULL CHECK (length(realm) BETWEEN 1 AND 128),
  melody_user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL CHECK (project_id > 0),
  application_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(realm, melody_user_id, project_id),
  UNIQUE(realm, project_id, application_user_id)
);

CREATE INDEX identity_subject_bridge_application_idx
  ON identity_subject_bridge(project_id, application_user_id);

CREATE TABLE identity_app_realm (
  melody_app_id INTEGER PRIMARY KEY REFERENCES app(id) ON DELETE CASCADE,
  realm TEXT NOT NULL CHECK (length(realm) BETWEEN 1 AND 128),
  project_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (project_id IS NULL OR project_id > 0)
);

CREATE INDEX identity_app_realm_project_idx
  ON identity_app_realm(realm, project_id)
  WHERE project_id IS NOT NULL;

-- Runtime feature policy is explicit and versioned. It lets each application
-- expose every Melody capability without forcing mutually exclusive sign-in
-- modes to be active globally at the same time.
CREATE TABLE identity_app_feature_policy (
  melody_app_id INTEGER PRIMARY KEY REFERENCES app(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Durable replay protection for the Worker-native SAML service provider.
CREATE TABLE identity_saml_replay (
  response_id TEXT PRIMARY KEY,
  idp_id INTEGER REFERENCES saml_idp(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX identity_saml_replay_expiry_idx
  ON identity_saml_replay(expires_at);

-- Auditable, retryable integration events for future consumers. Authentication
-- success never depends on a remote call or an eventually-consistent store.
CREATE TABLE identity_event_outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'processing', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX identity_event_outbox_delivery_idx
  ON identity_event_outbox(state, available_at, created_at);
