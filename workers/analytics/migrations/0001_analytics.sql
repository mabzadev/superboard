-- SuperBoard Analytics v1: immutable receipts, durable outbox, hot projections,
-- canonical installation/purchase facts, saved analysis, and durable operations.

CREATE TABLE IF NOT EXISTS analytics_event_receipts (
  project_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_source TEXT NOT NULL,
  application_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'projected', 'dead_letter', 'erased')),
  archive_key TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  projected_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, event_id)
);

CREATE INDEX IF NOT EXISTS analytics_event_receipts_status_idx
  ON analytics_event_receipts (status, updated_at, project_id);
CREATE INDEX IF NOT EXISTS analytics_event_receipts_project_time_idx
  ON analytics_event_receipts (project_id, occurred_at DESC, event_id DESC);

CREATE TABLE IF NOT EXISTS analytics_ingest_outbox (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  project_ref TEXT NOT NULL,
  instance_id INTEGER NOT NULL CHECK (instance_id > 0),
  environment TEXT NOT NULL CHECK (environment IN ('production', 'test')),
  event_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dispatched', 'processing', 'completed', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  dispatched_at TEXT,
  completed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, event_id),
  FOREIGN KEY (project_id, event_id)
    REFERENCES analytics_event_receipts(project_id, event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analytics_ingest_outbox_dispatch_idx
  ON analytics_ingest_outbox (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS analytics_ingest_outbox_project_idx
  ON analytics_ingest_outbox (project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_marketing_signal_outbox (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  project_ref TEXT NOT NULL,
  instance_id INTEGER NOT NULL CHECK (instance_id > 0),
  environment TEXT NOT NULL CHECK (environment IN ('production', 'test')),
  event_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivering', 'delivered', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, event_id)
);

CREATE INDEX IF NOT EXISTS analytics_marketing_signal_outbox_dispatch_idx
  ON analytics_marketing_signal_outbox(status, available_at, created_at);

CREATE TABLE IF NOT EXISTS analytics_projection_receipts (
  project_id TEXT NOT NULL,
  projection TEXT NOT NULL,
  event_id TEXT NOT NULL,
  projected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, projection, event_id)
);

CREATE TABLE IF NOT EXISTS analytics_events_hot (
  project_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_source TEXT NOT NULL,
  application_id TEXT NOT NULL,
  app_instance_id_hash TEXT,
  session_id_hash TEXT,
  anonymous_id_hash TEXT,
  user_id_hash TEXT,
  properties_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(properties_json)),
  context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context_json)),
  occurred_at TEXT NOT NULL,
  archive_key TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, event_id)
);

CREATE INDEX IF NOT EXISTS analytics_events_hot_project_time_idx
  ON analytics_events_hot (project_id, occurred_at DESC, event_id DESC);
CREATE INDEX IF NOT EXISTS analytics_events_hot_name_time_idx
  ON analytics_events_hot (project_id, event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_hot_application_time_idx
  ON analytics_events_hot (project_id, application_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_hot_session_idx
  ON analytics_events_hot (project_id, application_id, session_id_hash, occurred_at);
CREATE INDEX IF NOT EXISTS analytics_events_hot_expiry_idx
  ON analytics_events_hot (expires_at, project_id);

CREATE TABLE IF NOT EXISTS analytics_subject_event_index (
  project_id TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  event_id TEXT NOT NULL,
  archive_key TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (project_id, subject_hash, event_id)
);

CREATE INDEX IF NOT EXISTS analytics_subject_event_lookup_idx
  ON analytics_subject_event_index (project_id, subject_hash, occurred_at DESC);

CREATE TABLE IF NOT EXISTS analytics_profiles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  canonical_subject_hash TEXT NOT NULL,
  properties_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(properties_json)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, application_id, canonical_subject_hash)
);

CREATE INDEX IF NOT EXISTS analytics_profiles_project_seen_idx
  ON analytics_profiles (project_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS analytics_identity_aliases (
  project_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  alias_kind TEXT NOT NULL CHECK (alias_kind IN ('user', 'anonymous', 'instance')),
  alias_hash TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, application_id, alias_kind, alias_hash),
  FOREIGN KEY (profile_id) REFERENCES analytics_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS analytics_installations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  app_instance_id_hash TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  platform TEXT,
  app_version TEXT,
  attribution_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, application_id, app_instance_id_hash),
  UNIQUE (project_id, source_event_id)
);

CREATE INDEX IF NOT EXISTS analytics_installations_project_time_idx
  ON analytics_installations (project_id, installed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS analytics_installations_application_time_idx
  ON analytics_installations (project_id, application_id, installed_at DESC);

CREATE TABLE IF NOT EXISTS analytics_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  session_id_hash TEXT NOT NULL,
  profile_id TEXT,
  app_instance_id_hash TEXT,
  first_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 1 CHECK (event_count > 0),
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  platform TEXT,
  app_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, application_id, session_id_hash),
  FOREIGN KEY (profile_id) REFERENCES analytics_profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS analytics_sessions_project_time_idx
  ON analytics_sessions (project_id, started_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS analytics_purchase_facts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  billing_transaction_id TEXT,
  store TEXT NOT NULL CHECK (store IN ('apple', 'google', 'stripe', 'manual')),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  store_transaction_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  product_id TEXT,
  amount_micros INTEGER,
  currency TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, store, environment, store_transaction_id, event_type),
  UNIQUE (project_id, source_event_id)
);

CREATE INDEX IF NOT EXISTS analytics_purchase_facts_project_time_idx
  ON analytics_purchase_facts (project_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS analytics_purchase_facts_application_time_idx
  ON analytics_purchase_facts (project_id, application_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS analytics_daily_metrics (
  project_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  dimension_key TEXT NOT NULL DEFAULT '',
  event_count INTEGER NOT NULL DEFAULT 0,
  value_micros INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, application_id, metric_date, metric_name, dimension_key)
);

CREATE INDEX IF NOT EXISTS analytics_daily_metrics_query_idx
  ON analytics_daily_metrics (project_id, metric_name, metric_date DESC, application_id);

CREATE TABLE IF NOT EXISTS analytics_saved_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  report_type TEXT NOT NULL
    CHECK (report_type IN ('dashboard', 'funnel', 'cohort', 'retention', 'query', 'alert')),
  name TEXT NOT NULL,
  description TEXT,
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, report_type, name)
);

CREATE INDEX IF NOT EXISTS analytics_saved_reports_project_idx
  ON analytics_saved_reports (project_id, report_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS analytics_operation_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  operation_type TEXT NOT NULL
    CHECK (operation_type IN ('export', 'replay', 'rebuild_rollups', 'erase_subject')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  input_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_message TEXT,
  requested_by TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS analytics_operation_jobs_project_idx
  ON analytics_operation_jobs (project_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS analytics_operation_jobs_status_idx
  ON analytics_operation_jobs (status, created_at);

CREATE TABLE IF NOT EXISTS analytics_dead_letters (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  event_id TEXT,
  source_queue TEXT NOT NULL,
  message_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'quarantined'
    CHECK (status IN ('quarantined', 'replayed', 'discarded')),
  last_error TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT,
  UNIQUE (source_queue, message_id)
);

CREATE INDEX IF NOT EXISTS analytics_dead_letters_project_idx
  ON analytics_dead_letters (project_id, status, received_at DESC);

CREATE TABLE IF NOT EXISTS analytics_project_settings (
  project_id TEXT PRIMARY KEY,
  hot_retention_days INTEGER NOT NULL DEFAULT 35
    CHECK (hot_retention_days BETWEEN 1 AND 366),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  data_collection_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (data_collection_enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS analytics_idempotency_keys (
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, key)
);

CREATE INDEX IF NOT EXISTS analytics_idempotency_expiry_idx
  ON analytics_idempotency_keys (created_at, project_id);

CREATE TABLE IF NOT EXISTS analytics_audit_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS analytics_audit_events_project_idx
  ON analytics_audit_events (project_id, occurred_at DESC, id DESC);
