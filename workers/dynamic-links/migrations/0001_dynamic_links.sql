PRAGMA foreign_keys = ON;
CREATE TABLE links (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL, destination_url TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id,slug));
CREATE TABLE campaigns (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE redirect_rules (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, priority INTEGER NOT NULL, rule_json TEXT NOT NULL CHECK(json_valid(rule_json)));
CREATE TABLE audit_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, action TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
