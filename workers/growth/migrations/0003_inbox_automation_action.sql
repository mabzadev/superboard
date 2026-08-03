CREATE TABLE growth_automations_before_inbox AS
SELECT * FROM growth_automations;

CREATE TABLE growth_automation_runs_before_inbox AS
SELECT * FROM growth_automation_runs;

DROP TABLE growth_automation_runs;
DROP TABLE growth_automations;

CREATE TABLE growth_automations (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('chat', 'push', 'in_app', 'inbox')),
  trigger_config_json TEXT NOT NULL DEFAULT '{}',
  action_config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO growth_automations (
  id, project_id, name, trigger_type, action_type, trigger_config_json,
  action_config_json, enabled, created_at, updated_at
)
SELECT
  id, project_id, name, trigger_type, action_type, trigger_config_json,
  action_config_json, enabled, created_at, updated_at
FROM growth_automations_before_inbox;

CREATE INDEX growth_automations_project_idx
  ON growth_automations (project_id, enabled, trigger_type);

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
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  next_attempt_at TEXT,
  delivered_at TEXT,
  UNIQUE (automation_id, event_id)
);

INSERT INTO growth_automation_runs (
  id, project_id, automation_id, event_id, status, action_payload_json,
  last_error, created_at, updated_at, attempt_count, claimed_at,
  next_attempt_at, delivered_at
)
SELECT
  id, project_id, automation_id, event_id, status, action_payload_json,
  last_error, created_at, updated_at, attempt_count, claimed_at,
  next_attempt_at, delivered_at
FROM growth_automation_runs_before_inbox;

CREATE INDEX growth_automation_runs_project_idx
  ON growth_automation_runs (project_id, status, created_at DESC);

CREATE INDEX growth_automation_runs_delivery_idx
  ON growth_automation_runs (status, next_attempt_at, claimed_at);

DROP TABLE growth_automation_runs_before_inbox;
DROP TABLE growth_automations_before_inbox;
