-- Flows is a project capability. The temporary SaaS organization and MTU
-- model is intentionally removed: SuperBoard projects already provide the
-- tenant, access-control and commercial boundaries.
--
-- The transient development data is explicitly discarded after backup for
-- this append-only schema rebuild. Historical Paywalls/Onboardings data
-- remains in its archived source databases and is imported into the
-- project-scoped tables after this migration.
PRAGMA defer_foreign_keys = ON;

DROP TABLE IF EXISTS flow_version_translations;
DROP TABLE IF EXISTS flow_launchpad_workflows;
DROP TABLE IF EXISTS flow_launchpad_assignments;
DROP TABLE IF EXISTS flow_legacy_targeting_rules;
DROP TABLE IF EXISTS flow_legacy_variants;
DROP TABLE IF EXISTS flow_legacy_experiments;
DROP TABLE IF EXISTS flow_legacy_placements;
DROP TABLE IF EXISTS flow_legacy_versions;
DROP TABLE IF EXISTS flow_survey_responses;
DROP TABLE IF EXISTS flow_experiment_assignments;
DROP TABLE IF EXISTS flow_environment_releases;
DROP TABLE IF EXISTS flow_translations;
DROP TABLE IF EXISTS flow_user_workflow_states;
DROP TABLE IF EXISTS flow_users;
DROP TABLE IF EXISTS flow_component_versions;
DROP TABLE IF EXISTS flow_component_definitions;
DROP TABLE IF EXISTS flow_component_libraries;
DROP TABLE IF EXISTS flow_workflow_versions;
DROP TABLE IF EXISTS flow_workflow_drafts;
DROP TABLE IF EXISTS flow_workflows;
DROP TABLE IF EXISTS flow_launchpad_groups;
DROP TABLE IF EXISTS flow_language_groups;
DROP TABLE IF EXISTS flow_environments;
DROP TABLE IF EXISTS flow_analytics_events;
DROP TABLE IF EXISTS flow_exports;
DROP TABLE IF EXISTS flow_billing_cycles;
DROP TABLE IF EXISTS flow_mtu_users;
DROP TABLE IF EXISTS flow_usage_alerts;
DROP TABLE IF EXISTS flow_idempotency_keys;
DROP TABLE IF EXISTS flow_import_checkpoints;
DROP TABLE IF EXISTS flow_legacy_mappings;
DROP TABLE IF EXISTS flow_outbox_receipts;
DROP TABLE IF EXISTS flow_legacy_event_claims;
DROP TABLE IF EXISTS flow_audit_events;
DROP TABLE IF EXISTS flow_invitations;
DROP TABLE IF EXISTS flow_members;
DROP TABLE IF EXISTS flow_organizations;
DROP TABLE IF EXISTS flow_projects;

CREATE TABLE flow_projects (
  project_id INTEGER PRIMARY KEY,
  project_ref TEXT NOT NULL UNIQUE,
  sdk_identifier TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE flow_environments (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('production', 'test', 'development')),
  sdk_key_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  allow_draft INTEGER NOT NULL DEFAULT 0 CHECK (allow_draft IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, key),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE
);

CREATE TABLE flow_language_groups (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  default_locale TEXT NOT NULL,
  locales_json TEXT NOT NULL DEFAULT '[]',
  fallbacks_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE
);

CREATE TABLE flow_component_libraries (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  identifier TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  source TEXT NOT NULL DEFAULT 'custom' CHECK (source IN ('basics-v2', 'custom', 'superboard')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, identifier),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE
);

CREATE TABLE flow_component_definitions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
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
  UNIQUE (project_id, library_id, key),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (library_id) REFERENCES flow_component_libraries(id) ON DELETE CASCADE
);

CREATE TABLE flow_component_versions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  component_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (component_id, version),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (component_id) REFERENCES flow_component_definitions(id) ON DELETE CASCADE
);

CREATE TABLE flow_workflows (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
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
  UNIQUE (project_id, identifier),
  UNIQUE (project_id, origin, legacy_id),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE
);
CREATE INDEX idx_flow_workflows_list
  ON flow_workflows(project_id, status, updated_at DESC);

CREATE TABLE flow_workflow_drafts (
  workflow_id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  graph_json TEXT NOT NULL,
  validation_json TEXT NOT NULL DEFAULT '{"valid":true,"issues":[]}',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE
);

CREATE TABLE flow_workflow_versions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  graph_json TEXT NOT NULL,
  changelog TEXT,
  checksum_sha256 TEXT NOT NULL,
  migration_strategy TEXT NOT NULL DEFAULT 'finish-current' CHECK (migration_strategy IN ('finish-current', 'restart-current', 'restart-all')),
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workflow_id, version),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE
);

CREATE TABLE flow_environment_releases (
  project_id INTEGER NOT NULL,
  environment_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version_id TEXT,
  use_draft INTEGER NOT NULL DEFAULT 0 CHECK (use_draft IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  activated_by TEXT NOT NULL,
  activated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (environment_id, workflow_id),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (environment_id) REFERENCES flow_environments(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_version_id) REFERENCES flow_workflow_versions(id)
);

CREATE TABLE flow_translations (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  workflow_id TEXT NOT NULL,
  block_key TEXT NOT NULL,
  property_key TEXT NOT NULL,
  locale TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workflow_id, block_key, property_key, locale),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE
);

CREATE TABLE flow_version_translations (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version_id TEXT NOT NULL,
  block_key TEXT NOT NULL,
  property_key TEXT NOT NULL,
  locale TEXT NOT NULL,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (workflow_version_id, block_key, property_key, locale),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_version_id) REFERENCES flow_workflow_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE
);
CREATE INDEX flow_version_translations_runtime_idx
  ON flow_version_translations(project_id, workflow_version_id, locale, block_key, property_key);

CREATE TABLE flow_launchpad_groups (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  environment_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  concurrency_limit INTEGER,
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE,
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

CREATE TABLE flow_launchpad_assignments (
  project_id INTEGER NOT NULL,
  environment_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, environment_id, user_id_hash, workflow_id),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (environment_id) REFERENCES flow_environments(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES flow_launchpad_groups(id) ON DELETE CASCADE
);
CREATE INDEX flow_launchpad_assignments_group_idx
  ON flow_launchpad_assignments(project_id, environment_id, user_id_hash, group_id);

CREATE TABLE flow_users (
  project_id INTEGER NOT NULL,
  environment_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  external_user_id_ciphertext TEXT,
  properties_ciphertext TEXT,
  locale TEXT,
  country TEXT,
  platform TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, environment_id, user_id_hash),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (environment_id) REFERENCES flow_environments(id) ON DELETE CASCADE
);

CREATE TABLE flow_user_workflow_states (
  project_id INTEGER NOT NULL,
  environment_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('not-started', 'in-progress', 'completed', 'stopped')),
  active_block_ids_json TEXT NOT NULL DEFAULT '[]',
  tour_indexes_json TEXT NOT NULL DEFAULT '{}',
  entered_at TEXT,
  exited_at TEXT,
  generation INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, environment_id, user_id_hash, workflow_id),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (environment_id) REFERENCES flow_environments(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE
);

CREATE TABLE flow_analytics_events (
  event_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  project_ref TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  event_name TEXT NOT NULL,
  workflow_id TEXT,
  workflow_version_id TEXT,
  block_id TEXT,
  block_key TEXT,
  properties_json TEXT NOT NULL DEFAULT '{}',
  legacy_event_type TEXT,
  source_event_id TEXT,
  source_module TEXT CHECK (source_module IS NULL OR source_module IN ('paywalls', 'onboardings')),
  occurred_at TEXT NOT NULL,
  projected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, event_id),
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE
);
CREATE INDEX idx_flow_analytics_query
  ON flow_analytics_events(project_id, environment_id, occurred_at DESC);
CREATE INDEX idx_flow_analytics_workflow
  ON flow_analytics_events(project_id, workflow_id, event_name, occurred_at DESC);
CREATE UNIQUE INDEX flow_analytics_legacy_source_event_idx
  ON flow_analytics_events(project_id, source_module, source_event_id)
  WHERE source_module IS NOT NULL AND source_event_id IS NOT NULL;

CREATE TABLE flow_survey_responses (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  environment_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  survey_id TEXT NOT NULL,
  workflow_id TEXT,
  block_id TEXT,
  block_state_id TEXT NOT NULL,
  url TEXT NOT NULL,
  response_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  UNIQUE (project_id, event_id),
  FOREIGN KEY (project_id, event_id)
    REFERENCES flow_analytics_events(project_id, event_id) ON DELETE CASCADE
);

CREATE TABLE flow_experiment_assignments (
  project_id INTEGER NOT NULL,
  environment_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  split_block_id TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, environment_id, workflow_id, split_block_id, user_id_hash)
);

CREATE TABLE flow_exports (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  export_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  filters_json TEXT NOT NULL DEFAULT '{}',
  r2_key TEXT,
  error_message TEXT,
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES flow_projects(project_id) ON DELETE CASCADE
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
  event_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  environment_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('projected', 'duplicate', 'dead-letter')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  PRIMARY KEY (project_id, event_id)
);
CREATE INDEX flow_outbox_receipts_project_status_idx
  ON flow_outbox_receipts(project_id, environment_id, status, received_at);

CREATE TABLE flow_audit_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  project_ref TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  request_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_flow_audit_project
  ON flow_audit_events(project_id, occurred_at DESC);

CREATE TABLE flow_legacy_versions (
  id TEXT PRIMARY KEY,
  legacy_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('paywalls', 'onboardings')),
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  definition_json TEXT NOT NULL,
  changelog TEXT,
  flow_version_id TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT,
  archived_at TEXT,
  UNIQUE (project_id, source_module, legacy_id),
  UNIQUE (project_id, source_module, workflow_id, version),
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (flow_version_id) REFERENCES flow_workflow_versions(id)
);
CREATE INDEX idx_flow_legacy_versions_workflow
  ON flow_legacy_versions(project_id, source_module, workflow_id, version DESC);

CREATE TABLE flow_legacy_placements (
  id TEXT PRIMARY KEY,
  legacy_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('paywalls', 'onboardings')),
  key TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  active_legacy_version_id TEXT,
  experience_id TEXT,
  targeting_json TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, source_module, legacy_id),
  UNIQUE (project_id, source_module, key, priority),
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (active_legacy_version_id) REFERENCES flow_legacy_versions(id)
);
CREATE INDEX idx_flow_legacy_placements_resolve
  ON flow_legacy_placements(project_id, source_module, key, active, priority DESC);

CREATE TABLE flow_legacy_experiments (
  id TEXT PRIMARY KEY,
  legacy_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('paywalls', 'onboardings')),
  workflow_id TEXT NOT NULL,
  placement_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'running', 'paused', 'completed', 'archived')),
  traffic_percent INTEGER NOT NULL DEFAULT 100 CHECK (traffic_percent BETWEEN 0 AND 100),
  traffic_basis_points INTEGER CHECK (traffic_basis_points BETWEEN 0 AND 10000),
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, source_module, legacy_id),
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (placement_id) REFERENCES flow_legacy_placements(id) ON DELETE SET NULL
);

CREATE TABLE flow_legacy_variants (
  id TEXT PRIMARY KEY,
  legacy_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('paywalls', 'onboardings')),
  experiment_id TEXT NOT NULL,
  legacy_version_id TEXT NOT NULL,
  key TEXT NOT NULL,
  weight INTEGER NOT NULL CHECK (weight > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, source_module, legacy_id),
  UNIQUE (experiment_id, key),
  FOREIGN KEY (experiment_id) REFERENCES flow_legacy_experiments(id) ON DELETE CASCADE,
  FOREIGN KEY (legacy_version_id) REFERENCES flow_legacy_versions(id)
);

CREATE TABLE flow_legacy_targeting_rules (
  id TEXT PRIMARY KEY,
  legacy_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('paywalls', 'onboardings')),
  placement_id TEXT NOT NULL,
  conditions_json TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, source_module, legacy_id),
  FOREIGN KEY (placement_id) REFERENCES flow_legacy_placements(id) ON DELETE CASCADE
);
CREATE INDEX idx_flow_legacy_targeting_rules_placement
  ON flow_legacy_targeting_rules(project_id, placement_id, active, priority DESC);

CREATE TABLE flow_legacy_event_claims (
  event_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('paywalls', 'onboardings')),
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, source_module, event_id)
);
CREATE INDEX idx_flow_legacy_event_claims_project
  ON flow_legacy_event_claims(project_id, source_module, claimed_at DESC);

PRAGMA defer_foreign_keys = OFF;
