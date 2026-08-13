PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS analytics_applications (
  project_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, application_id)
);

CREATE INDEX IF NOT EXISTS analytics_applications_seen_idx
  ON analytics_applications(project_id, active, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS analytics_dashboards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'project')),
  layout_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(layout_json)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS analytics_dashboard_widgets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  dashboard_id TEXT NOT NULL REFERENCES analytics_dashboards(id) ON DELETE CASCADE,
  widget_type TEXT NOT NULL CHECK (widget_type IN (
    'metric', 'timeseries', 'event', 'funnel', 'retention', 'table',
    'map', 'crashes', 'views', 'purchases', 'installations'
  )),
  title TEXT NOT NULL,
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  position_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(position_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS analytics_dashboard_widgets_dashboard_idx
  ON analytics_dashboard_widgets(project_id, dashboard_id, created_at);

CREATE TABLE IF NOT EXISTS analytics_view_facts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  view_name TEXT NOT NULL,
  view_url TEXT,
  session_id_hash TEXT,
  profile_id TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  occurred_at TEXT NOT NULL,
  UNIQUE(project_id, source_event_id)
);

CREATE INDEX IF NOT EXISTS analytics_view_facts_query_idx
  ON analytics_view_facts(project_id, application_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_view_facts_name_idx
  ON analytics_view_facts(project_id, view_name, occurred_at DESC);

CREATE TABLE IF NOT EXISTS analytics_crash_groups (
  project_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  fatal INTEGER NOT NULL DEFAULT 0 CHECK (fatal IN (0, 1)),
  resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1)),
  occurrence_count INTEGER NOT NULL DEFAULT 0 CHECK (occurrence_count >= 0),
  affected_profiles INTEGER NOT NULL DEFAULT 0 CHECK (affected_profiles >= 0),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_app_version TEXT,
  last_platform TEXT,
  assignee TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, application_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS analytics_crash_groups_status_idx
  ON analytics_crash_groups(project_id, resolved, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS analytics_crash_occurrences (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  profile_id TEXT,
  message TEXT,
  stack TEXT,
  app_version TEXT,
  platform TEXT,
  occurred_at TEXT NOT NULL,
  UNIQUE(project_id, source_event_id),
  FOREIGN KEY(project_id, application_id, fingerprint)
    REFERENCES analytics_crash_groups(project_id, application_id, fingerprint)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS analytics_crash_occurrences_group_idx
  ON analytics_crash_occurrences(project_id, application_id, fingerprint, occurred_at DESC);

CREATE TABLE IF NOT EXISTS analytics_feedback_facts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  profile_id TEXT,
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  comment TEXT,
  widget_id TEXT,
  occurred_at TEXT NOT NULL,
  UNIQUE(project_id, source_event_id)
);

CREATE INDEX IF NOT EXISTS analytics_feedback_query_idx
  ON analytics_feedback_facts(project_id, application_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS analytics_cohorts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  estimated_size INTEGER NOT NULL DEFAULT 0 CHECK (estimated_size >= 0),
  last_evaluated_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS analytics_remote_config (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  config_key TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('production', 'test')),
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  conditions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(conditions_json)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, environment, config_key)
);

CREATE INDEX IF NOT EXISTS analytics_remote_config_resolve_idx
  ON analytics_remote_config(project_id, environment, enabled, config_key);

CREATE TABLE IF NOT EXISTS analytics_alerts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'metric_threshold', 'crash_spike', 'no_data', 'purchase_drop',
    'installation_drop', 'custom'
  )),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  channels_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(channels_json)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  cooldown_minutes INTEGER NOT NULL DEFAULT 60
    CHECK (cooldown_minutes BETWEEN 1 AND 10080),
  last_evaluated_at TEXT,
  last_triggered_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS analytics_alert_incidents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  alert_id TEXT NOT NULL REFERENCES analytics_alerts(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  summary TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(value_json)),
  notification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending', 'sent', 'partial', 'failed')),
  notifications_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(notifications_json)),
  triggered_at TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at TEXT,
  UNIQUE(project_id, alert_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS analytics_alert_incidents_query_idx
  ON analytics_alert_incidents(project_id, status, triggered_at DESC);

CREATE TABLE IF NOT EXISTS analytics_hooks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  event_types_json TEXT NOT NULL CHECK (json_valid(event_types_json)),
  endpoint_url TEXT NOT NULL,
  encrypted_secret TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_delivery_at TEXT,
  last_delivery_status TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS analytics_hook_deliveries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  hook_id TEXT NOT NULL REFERENCES analytics_hooks(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivering', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, hook_id, event_id)
);

CREATE INDEX IF NOT EXISTS analytics_hook_deliveries_pending_idx
  ON analytics_hook_deliveries(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS analytics_annotations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  annotation_at TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS analytics_annotations_time_idx
  ON analytics_annotations(project_id, annotation_at DESC);
