PRAGMA foreign_keys = ON;
CREATE TABLE customers (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, external_id TEXT NOT NULL, attributes_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(attributes_json)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, external_id));
CREATE INDEX customers_project ON customers(project_id, created_at DESC);
CREATE TABLE referrals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, customer_id TEXT REFERENCES customers(id), code TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, code));
CREATE TABLE audit_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX app_audit_project ON audit_events(project_id, created_at DESC);
