PRAGMA foreign_keys = ON;

CREATE TABLE growth_apps (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('apple', 'google')),
  app_identifier TEXT NOT NULL,
  display_name TEXT,
  country TEXT NOT NULL DEFAULT 'us',
  language TEXT NOT NULL DEFAULT 'en',
  device TEXT NOT NULL CHECK (device IN ('iphone', 'ipad', 'android')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, platform, app_identifier, country, language, device)
);

CREATE INDEX growth_apps_project_idx ON growth_apps (project_id, enabled, is_primary);

CREATE TABLE growth_keywords (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  app_id TEXT NOT NULL REFERENCES growth_apps(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  country TEXT NOT NULL,
  language TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (app_id, keyword, country, language)
);

CREATE INDEX growth_keywords_project_idx ON growth_keywords (project_id, enabled);

CREATE TABLE growth_keyword_snapshots (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  keyword_id TEXT NOT NULL REFERENCES growth_keywords(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('apptweak', 'manual')),
  observed_date TEXT NOT NULL,
  rank INTEGER,
  volume REAL,
  search_popularity REAL,
  difficulty REAL,
  installs REAL,
  relevancy REAL,
  chance REAL,
  kei REAL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (keyword_id, source, observed_date)
);

CREATE INDEX growth_keyword_snapshots_project_idx ON growth_keyword_snapshots (project_id, observed_date DESC);

CREATE TABLE growth_competitors (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('apple', 'google')),
  app_identifier TEXT NOT NULL,
  display_name TEXT,
  country TEXT NOT NULL DEFAULT 'us',
  language TEXT NOT NULL DEFAULT 'en',
  device TEXT NOT NULL CHECK (device IN ('iphone', 'ipad', 'android')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, platform, app_identifier, country, language, device)
);

CREATE INDEX growth_competitors_project_idx ON growth_competitors (project_id, enabled);

CREATE TABLE growth_app_snapshots (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('app', 'competitor')),
  entity_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('apple_lookup', 'apptweak', 'manual')),
  observed_date TEXT NOT NULL,
  title TEXT,
  version TEXT,
  rating REAL,
  rating_count INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entity_type, entity_id, source, observed_date)
);

CREATE INDEX growth_app_snapshots_project_idx ON growth_app_snapshots (project_id, entity_type, observed_date DESC);

CREATE TABLE growth_recommendations (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  recommendation_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, recommendation_key)
);

CREATE INDEX growth_recommendations_project_idx ON growth_recommendations (project_id, status, priority);

CREATE TABLE growth_automations (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('chat', 'push', 'in_app')),
  trigger_config_json TEXT NOT NULL DEFAULT '{}',
  action_config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX growth_automations_project_idx ON growth_automations (project_id, enabled, trigger_type);

CREATE TABLE growth_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  subject_id TEXT,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, provider_event_id)
);

CREATE INDEX growth_events_project_idx ON growth_events (project_id, event_type, occurred_at DESC);

CREATE TABLE growth_automation_runs (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  automation_id TEXT NOT NULL REFERENCES growth_automations(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES growth_events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'cancelled')),
  action_payload_json TEXT NOT NULL DEFAULT '{}',
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (automation_id, event_id)
);

CREATE INDEX growth_automation_runs_project_idx ON growth_automation_runs (project_id, status, created_at DESC);

CREATE TABLE growth_audit_events (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX growth_audit_events_project_idx ON growth_audit_events (project_id, created_at DESC);
