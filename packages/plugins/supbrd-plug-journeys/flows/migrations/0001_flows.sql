PRAGMA foreign_keys = ON;

CREATE TABLE flow_organizations (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  project_ref TEXT NOT NULL,
  name TEXT NOT NULL,
  sdk_identifier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  UNIQUE (project_id, id),
  UNIQUE (project_id, sdk_identifier)
);
CREATE INDEX idx_flow_organizations_project ON flow_organizations(project_id, status, updated_at DESC);

CREATE TABLE flow_members (
  organization_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  identity_user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role = 'admin'),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (organization_id, identity_user_id),
  FOREIGN KEY (project_id, organization_id) REFERENCES flow_organizations(project_id, id) ON DELETE CASCADE
);

CREATE TABLE flow_invitations (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id, organization_id) REFERENCES flow_organizations(project_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_flow_invitations_lookup ON flow_invitations(project_id, organization_id, email, expires_at);

CREATE TABLE flow_environments (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('production', 'test', 'development')),
  sdk_key_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  allow_draft INTEGER NOT NULL DEFAULT 0 CHECK (allow_draft IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, organization_id, key),
  FOREIGN KEY (project_id, organization_id) REFERENCES flow_organizations(project_id, id) ON DELETE CASCADE
);

CREATE TABLE flow_language_groups (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  default_locale TEXT NOT NULL,
  locales_json TEXT NOT NULL DEFAULT '[]',
  fallbacks_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id, organization_id) REFERENCES flow_organizations(project_id, id) ON DELETE CASCADE
);

CREATE TABLE flow_component_libraries (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  identifier TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  source TEXT NOT NULL DEFAULT 'custom' CHECK (source IN ('basics-v2', 'custom', 'superboard')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, organization_id, identifier),
  FOREIGN KEY (project_id, organization_id) REFERENCES flow_organizations(project_id, id) ON DELETE CASCADE
);

CREATE TABLE flow_component_definitions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  component_type TEXT NOT NULL,
  schema_json TEXT NOT NULL DEFAULT '{}',
  exit_nodes_json TEXT NOT NULL DEFAULT '[]',
  css_variables_json TEXT NOT NULL DEFAULT '{}',
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, organization_id, library_id, key),
  FOREIGN KEY (library_id) REFERENCES flow_component_libraries(id) ON DELETE CASCADE
);

CREATE TABLE flow_component_versions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  component_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (component_id, version),
  FOREIGN KEY (component_id) REFERENCES flow_component_definitions(id) ON DELETE CASCADE
);

CREATE TABLE flow_workflows (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  identifier TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL DEFAULT 'once' CHECK (frequency IN ('once', 'every-time')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  origin TEXT NOT NULL DEFAULT 'flows' CHECK (origin IN ('flows', 'paywalls', 'onboardings')),
  legacy_id TEXT,
  draft_revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  UNIQUE (project_id, organization_id, identifier),
  UNIQUE (project_id, origin, legacy_id),
  FOREIGN KEY (project_id, organization_id) REFERENCES flow_organizations(project_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_flow_workflows_list ON flow_workflows(project_id, organization_id, status, updated_at DESC);

CREATE TABLE flow_workflow_drafts (
  workflow_id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  graph_json TEXT NOT NULL,
  validation_json TEXT NOT NULL DEFAULT '{"valid":true,"issues":[]}',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE
);

CREATE TABLE flow_workflow_versions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  graph_json TEXT NOT NULL,
  changelog TEXT,
  checksum_sha256 TEXT NOT NULL,
  migration_strategy TEXT NOT NULL DEFAULT 'finish-current' CHECK (migration_strategy IN ('finish-current', 'restart-current', 'restart-all')),
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workflow_id, version),
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE
);

CREATE TABLE flow_environment_releases (
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version_id TEXT,
  use_draft INTEGER NOT NULL DEFAULT 0 CHECK (use_draft IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  activated_by TEXT NOT NULL,
  activated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (environment_id, workflow_id),
  FOREIGN KEY (environment_id) REFERENCES flow_environments(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_version_id) REFERENCES flow_workflow_versions(id)
);

CREATE TABLE flow_translations (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  block_key TEXT NOT NULL,
  property_key TEXT NOT NULL,
  locale TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workflow_id, block_key, property_key, locale),
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE
);

CREATE TABLE flow_launchpad_groups (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  concurrency_limit INTEGER,
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (environment_id) REFERENCES flow_environments(id) ON DELETE CASCADE
);

CREATE TABLE flow_launchpad_workflows (
  group_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, workflow_id),
  FOREIGN KEY (group_id) REFERENCES flow_launchpad_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE
);

CREATE TABLE flow_users (
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  external_user_id_ciphertext TEXT,
  properties_ciphertext TEXT,
  locale TEXT,
  country TEXT,
  platform TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, organization_id, environment_id, user_id_hash)
);

CREATE TABLE flow_user_workflow_states (
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('not-started', 'in-progress', 'completed', 'stopped')),
  active_block_ids_json TEXT NOT NULL DEFAULT '[]',
  entered_at TEXT,
  exited_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, organization_id, environment_id, user_id_hash, workflow_id)
);

CREATE TABLE flow_analytics_events (
  event_id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  project_ref TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  event_name TEXT NOT NULL,
  workflow_id TEXT,
  workflow_version_id TEXT,
  block_id TEXT,
  block_key TEXT,
  properties_json TEXT NOT NULL DEFAULT '{}',
  legacy_event_type TEXT,
  occurred_at TEXT NOT NULL,
  projected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_flow_analytics_query ON flow_analytics_events(project_id, organization_id, environment_id, occurred_at DESC);
CREATE INDEX idx_flow_analytics_workflow ON flow_analytics_events(project_id, workflow_id, event_name, occurred_at DESC);

CREATE TABLE flow_survey_responses (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  survey_id TEXT NOT NULL,
  workflow_id TEXT,
  block_id TEXT,
  block_state_id TEXT NOT NULL,
  url TEXT NOT NULL,
  response_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES flow_analytics_events(event_id) ON DELETE CASCADE
);

CREATE TABLE flow_experiment_assignments (
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  split_block_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, organization_id, environment_id, workflow_id, split_block_id, user_id_hash)
);

CREATE TABLE flow_exports (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  export_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  filters_json TEXT NOT NULL DEFAULT '{}',
  r2_key TEXT,
  error_message TEXT,
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE TABLE flow_billing_cycles (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'custom')),
  mode TEXT NOT NULL DEFAULT 'observe' CHECK (mode = 'observe'),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  mtu_limit INTEGER,
  alert_emails_json TEXT NOT NULL DEFAULT '[]',
  mtu_count INTEGER NOT NULL DEFAULT 0,
  estimate_micros INTEGER NOT NULL DEFAULT 0,
  usage_limited INTEGER NOT NULL DEFAULT 0 CHECK (usage_limited = 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (organization_id, starts_at)
);

CREATE TABLE flow_mtu_users (
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  first_counted_at TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('block-activated', 'delay-entered')),
  PRIMARY KEY (project_id, organization_id, cycle_id, user_id_hash),
  FOREIGN KEY (cycle_id) REFERENCES flow_billing_cycles(id) ON DELETE CASCADE
);

CREATE TABLE flow_usage_alerts (
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  threshold INTEGER NOT NULL CHECK (threshold IN (80, 100)),
  sent_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, cycle_id, threshold)
);

CREATE TABLE flow_idempotency_keys (
  project_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, scope, idempotency_key)
);

CREATE TABLE flow_import_checkpoints (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('paywalls', 'onboardings')),
  source_database TEXT NOT NULL,
  source_bookmark TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'verified', 'failed', 'rolled-back')),
  cursor_json TEXT NOT NULL DEFAULT '{}',
  counts_json TEXT NOT NULL DEFAULT '{}',
  checksums_json TEXT NOT NULL DEFAULT '{}',
  backup_receipt_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, source_module, source_bookmark)
);

CREATE TABLE flow_legacy_mappings (
  project_id INTEGER NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('paywalls', 'onboardings')),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  flow_type TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, source_module, source_type, source_id)
);

CREATE TABLE flow_outbox_receipts (
  event_id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('projected', 'duplicate', 'dead-letter')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE TABLE flow_audit_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  project_ref TEXT NOT NULL,
  organization_id TEXT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  request_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_flow_audit_project ON flow_audit_events(project_id, occurred_at DESC);
