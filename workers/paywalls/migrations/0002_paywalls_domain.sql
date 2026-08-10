PRAGMA foreign_keys = ON;

ALTER TABLE paywalls ADD COLUMN identifier TEXT;
ALTER TABLE paywalls ADD COLUMN description TEXT;
ALTER TABLE paywalls ADD COLUMN archived_at TEXT;
ALTER TABLE paywalls ADD COLUMN updated_at TEXT;
CREATE UNIQUE INDEX paywalls_identifier ON paywalls(project_id, identifier) WHERE identifier IS NOT NULL;
CREATE INDEX paywalls_project ON paywalls(project_id, updated_at DESC);

ALTER TABLE paywall_versions ADD COLUMN project_id TEXT;
ALTER TABLE paywall_versions ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE paywall_versions ADD COLUMN changelog TEXT;
ALTER TABLE paywall_versions ADD COLUMN created_by TEXT;
ALTER TABLE paywall_versions ADD COLUMN published_at TEXT;
CREATE INDEX paywall_versions_project ON paywall_versions(project_id, paywall_id, version DESC);

ALTER TABLE placements ADD COLUMN paywall_id TEXT REFERENCES paywalls(id) ON DELETE CASCADE;
ALTER TABLE placements ADD COLUMN experience_id TEXT;
ALTER TABLE placements ADD COLUMN targeting_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(targeting_json));
ALTER TABLE placements ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE placements ADD COLUMN created_at TEXT;
ALTER TABLE placements ADD COLUMN updated_at TEXT;
CREATE INDEX paywall_placements_resolve ON placements(project_id, key, active, priority DESC);

CREATE TABLE experiences (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  paywall_id TEXT NOT NULL REFERENCES paywalls(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','running','paused','completed','archived')),
  traffic_percent INTEGER NOT NULL DEFAULT 100 CHECK(traffic_percent BETWEEN 0 AND 100),
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX experiences_project ON experiences(project_id, paywall_id, status);

CREATE TABLE variants (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES paywall_versions(id),
  key TEXT NOT NULL,
  weight INTEGER NOT NULL CHECK(weight BETWEEN 1 AND 10000),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(experience_id, key)
);
CREATE INDEX variants_experience ON variants(project_id, experience_id, active);

ALTER TABLE events ADD COLUMN paywall_id TEXT;
ALTER TABLE events ADD COLUMN version_id TEXT;
ALTER TABLE events ADD COLUMN experience_id TEXT;
ALTER TABLE events ADD COLUMN variant_id TEXT;
ALTER TABLE events ADD COLUMN platform TEXT;
ALTER TABLE events ADD COLUMN customer_id TEXT;
ALTER TABLE events ADD COLUMN session_id TEXT;
ALTER TABLE events ADD COLUMN revenue_micros INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN currency TEXT;
CREATE INDEX paywall_events_dimensions ON events(project_id, occurred_at, event_type, platform, version_id, experience_id, variant_id);

ALTER TABLE idempotency_keys ADD COLUMN method TEXT;
ALTER TABLE idempotency_keys ADD COLUMN path TEXT;
ALTER TABLE idempotency_keys ADD COLUMN request_hash TEXT;
ALTER TABLE idempotency_keys ADD COLUMN status_code INTEGER;

ALTER TABLE audit_events ADD COLUMN actor_id TEXT;
ALTER TABLE audit_events ADD COLUMN entity_type TEXT;
ALTER TABLE audit_events ADD COLUMN entity_id TEXT;
ALTER TABLE audit_events ADD COLUMN request_id TEXT;
ALTER TABLE audit_events ADD COLUMN occurred_at TEXT;
CREATE INDEX paywalls_audit_project ON audit_events(project_id, created_at DESC);
