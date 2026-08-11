ALTER TABLE customers ADD COLUMN email TEXT;
ALTER TABLE customers ADD COLUMN name TEXT;
ALTER TABLE customers ADD COLUMN platform TEXT CHECK(platform IS NULL OR platform IN ('ios','android','web'));
ALTER TABLE customers ADD COLUMN country_code TEXT;
ALTER TABLE customers ADD COLUMN first_seen_at TEXT;
ALTER TABLE customers ADD COLUMN last_seen_at TEXT;
ALTER TABLE customers ADD COLUMN updated_at TEXT;
UPDATE customers SET first_seen_at=COALESCE(created_at,CURRENT_TIMESTAMP),last_seen_at=COALESCE(created_at,CURRENT_TIMESTAMP),updated_at=COALESCE(created_at,CURRENT_TIMESTAMP);
ALTER TABLE referrals ADD COLUMN invited_customer_id TEXT REFERENCES customers(id);
ALTER TABLE referrals ADD COLUMN source TEXT;
ALTER TABLE referrals ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','converted','rejected'));
ALTER TABLE referrals ADD COLUMN converted_at TEXT;
ALTER TABLE audit_events ADD COLUMN request_id TEXT;

CREATE TABLE access_keys (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, created_by TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX access_keys_project ON access_keys(project_id, created_at DESC);
CREATE TABLE sdk_configurations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, platform TEXT NOT NULL CHECK(platform IN ('ios','android','web')), status TEXT NOT NULL DEFAULT 'configured' CHECK(status IN ('configured','verified','error')), configuration_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(configuration_json)), verified_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, platform));
CREATE TABLE daily_metrics (project_id TEXT NOT NULL, metric_date TEXT NOT NULL, platform TEXT NOT NULL CHECK(platform IN ('ios','android','web')), active_customers INTEGER NOT NULL DEFAULT 0, new_customers INTEGER NOT NULL DEFAULT 0, referrals INTEGER NOT NULL DEFAULT 0, installs INTEGER NOT NULL DEFAULT 0, opens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(project_id, metric_date, platform));
CREATE TABLE idempotency_keys (project_id TEXT NOT NULL, key TEXT NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)), status_code INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(project_id,key));
