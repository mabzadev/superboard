PRAGMA foreign_keys = ON;
CREATE TABLE offerings (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, placement TEXT NOT NULL, name TEXT NOT NULL, packages_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(packages_json)), priority INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, placement, id));
CREATE INDEX offerings_resolve ON offerings(project_id, placement, active, priority DESC);
CREATE TABLE entitlements (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(project_id, key));
CREATE TABLE purchases (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, financial_customer_id TEXT NOT NULL, product_id TEXT NOT NULL, status TEXT NOT NULL, purchased_at TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)));
CREATE INDEX purchases_customer ON purchases(project_id, financial_customer_id, purchased_at DESC);
CREATE TABLE audit_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, action TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
