PRAGMA foreign_keys = ON;

-- Contact tags: lightweight labels operators assign by hand or by import.
CREATE TABLE IF NOT EXISTS subscriber_tags (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS subscriber_tag_assignments (
  project_id INTEGER NOT NULL,
  tag_id TEXT NOT NULL REFERENCES subscriber_tags(id) ON DELETE CASCADE,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(project_id, tag_id, subscriber_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriber_tag_assignments_subscriber
  ON subscriber_tag_assignments(project_id, subscriber_id, tag_id);

-- Project-level custom field definitions. Values stay in subscribers.attributes_json.
CREATE TABLE IF NOT EXISTS subscriber_field_definitions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'boolean', 'select')),
  options_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(options_json)),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, key)
);

-- Audience settings, starting with the customizable double opt-in email.
CREATE TABLE IF NOT EXISTS marketing_audience_settings (
  project_id INTEGER PRIMARY KEY,
  double_optin_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(double_optin_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Dynamic segment evaluation reads engagement and memberships per subscriber range.
CREATE INDEX IF NOT EXISTS idx_email_events_subscriber_activity
  ON email_events(project_id, event_type, subscriber_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_segment_memberships_subscriber
  ON segment_memberships(project_id, subscriber_id, segment_id);
CREATE INDEX IF NOT EXISTS idx_subscriber_segments_refreshed
  ON subscriber_segments(refreshed_at);
