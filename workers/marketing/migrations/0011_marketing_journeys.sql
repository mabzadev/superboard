PRAGMA foreign_keys = ON;

-- Identity aliases use the same project-scoped HMAC contract as Analytics.
-- Raw application identifiers never have to cross the Analytics boundary.
CREATE TABLE IF NOT EXISTS subscriber_identity_aliases (
  project_id INTEGER NOT NULL,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  identity_kind TEXT NOT NULL CHECK (identity_kind IN ('user', 'anonymous', 'instance')),
  identity_hash TEXT NOT NULL,
  key_position INTEGER NOT NULL DEFAULT 0 CHECK (key_position IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, identity_kind, identity_hash),
  UNIQUE (project_id, subscriber_id, identity_kind, key_position)
);

CREATE INDEX IF NOT EXISTS subscriber_identity_aliases_subscriber_idx
  ON subscriber_identity_aliases(project_id, subscriber_id, identity_kind);

CREATE TABLE IF NOT EXISTS marketing_channel_connectors (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('webhook', 'sms', 'push', 'whatsapp', 'slack')),
  endpoint_url TEXT NOT NULL,
  encrypted_secret TEXT,
  headers_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(headers_json)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS marketing_channel_connectors_project_idx
  ON marketing_channel_connectors(project_id, enabled, channel, name);

CREATE TABLE IF NOT EXISTS marketing_journeys (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  trigger_event_name TEXT NOT NULL,
  trigger_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(trigger_json)),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version > 0),
  reentry_policy TEXT NOT NULL DEFAULT 'once'
    CHECK (reentry_policy IN ('once', 'after_completion', 'every_event')),
  entry_segment_id TEXT REFERENCES subscriber_segments(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL,
  activated_at TEXT,
  paused_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS marketing_journeys_trigger_idx
  ON marketing_journeys(project_id, status, trigger_event_name);

CREATE TABLE IF NOT EXISTS marketing_journey_versions (
  project_id INTEGER NOT NULL,
  journey_id TEXT NOT NULL REFERENCES marketing_journeys(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  trigger_json TEXT NOT NULL CHECK (json_valid(trigger_json)),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(project_id, journey_id, version)
);

CREATE TABLE IF NOT EXISTS marketing_signal_receipts (
  project_id INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  application_id TEXT NOT NULL,
  subject_hash TEXT,
  properties_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(properties_json)),
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'matched', 'unmatched', 'completed')),
  matched_journeys INTEGER NOT NULL DEFAULT 0 CHECK (matched_journeys >= 0),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  PRIMARY KEY(project_id, event_id)
);

CREATE INDEX IF NOT EXISTS marketing_signal_receipts_project_time_idx
  ON marketing_signal_receipts(project_id, occurred_at DESC, event_id DESC);

CREATE TABLE IF NOT EXISTS marketing_journey_enrollments (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  journey_id TEXT NOT NULL REFERENCES marketing_journeys(id) ON DELETE CASCADE,
  journey_version INTEGER NOT NULL CHECK (journey_version > 0),
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  entry_event_id TEXT,
  deduplication_key TEXT NOT NULL,
  current_node_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'waiting', 'processing', 'completed', 'exited', 'cancelled', 'failed')),
  context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context_json)),
  next_run_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_error TEXT,
  enrolled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, journey_id, deduplication_key),
  FOREIGN KEY(project_id, journey_id, journey_version)
    REFERENCES marketing_journey_versions(project_id, journey_id, version)
);

CREATE INDEX IF NOT EXISTS marketing_journey_enrollments_due_idx
  ON marketing_journey_enrollments(status, next_run_at, project_id);
CREATE INDEX IF NOT EXISTS marketing_journey_enrollments_journey_idx
  ON marketing_journey_enrollments(project_id, journey_id, enrolled_at DESC);
CREATE INDEX IF NOT EXISTS marketing_journey_enrollments_subscriber_idx
  ON marketing_journey_enrollments(project_id, subscriber_id, enrolled_at DESC);

CREATE TABLE IF NOT EXISTS marketing_journey_step_executions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  enrollment_id TEXT NOT NULL REFERENCES marketing_journey_enrollments(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  output_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(output_json)),
  last_error TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, enrollment_id, node_id)
);

CREATE INDEX IF NOT EXISTS marketing_journey_step_executions_status_idx
  ON marketing_journey_step_executions(project_id, status, updated_at);

CREATE TABLE IF NOT EXISTS marketing_journey_deliveries (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  enrollment_id TEXT NOT NULL REFERENCES marketing_journey_enrollments(id) ON DELETE CASCADE,
  execution_id TEXT NOT NULL REFERENCES marketing_journey_step_executions(id) ON DELETE CASCADE,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  connector_id TEXT,
  recipient TEXT,
  provider_message_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'suppressed', 'failed')),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, execution_id)
);

CREATE INDEX IF NOT EXISTS marketing_journey_deliveries_project_idx
  ON marketing_journey_deliveries(project_id, channel, created_at DESC);
