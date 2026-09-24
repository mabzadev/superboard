PRAGMA foreign_keys = ON;
CREATE TABLE paywalls (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE paywall_versions (id TEXT PRIMARY KEY, paywall_id TEXT NOT NULL REFERENCES paywalls(id) ON DELETE CASCADE, version INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published','archived')), definition_json TEXT NOT NULL CHECK(json_valid(definition_json)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(paywall_id, version));
CREATE TABLE placements (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, key TEXT NOT NULL, active_version_id TEXT REFERENCES paywall_versions(id), active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)), UNIQUE(project_id, key));
CREATE TABLE events (id TEXT NOT NULL, project_id TEXT NOT NULL, placement TEXT NOT NULL, event_type TEXT NOT NULL, occurred_at TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)), PRIMARY KEY(project_id,id));
CREATE INDEX paywall_events_stats ON events(project_id, occurred_at, placement, event_type);
CREATE TABLE idempotency_keys (project_id TEXT NOT NULL, key TEXT NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(project_id,key));
CREATE TABLE audit_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, action TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
