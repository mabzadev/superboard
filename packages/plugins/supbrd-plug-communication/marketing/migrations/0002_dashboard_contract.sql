ALTER TABLE subscribers ADD COLUMN name TEXT;
-- SQLite does not allow a non-constant default when adding a column. New writes
-- always populate this value; existing subscribers remain valid and sort last.
ALTER TABLE subscribers ADD COLUMN created_at TEXT;
ALTER TABLE campaigns ADD COLUMN subject TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN sent_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN scheduled_at TEXT;
ALTER TABLE smtp_profiles ADD COLUMN public_config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(public_config_json));
CREATE TABLE email_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, campaign_id TEXT, event_type TEXT NOT NULL, occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX marketing_event_stats ON email_events(project_id, occurred_at, event_type);
