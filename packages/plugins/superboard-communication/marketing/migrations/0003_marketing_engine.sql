PRAGMA foreign_keys = ON;

ALTER TABLE subscribers ADD COLUMN consent_status TEXT NOT NULL DEFAULT 'confirmed'
  CHECK (consent_status IN ('pending', 'confirmed', 'revoked'));
ALTER TABLE subscribers ADD COLUMN consent_source TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE subscribers ADD COLUMN optin_token_hash TEXT;
ALTER TABLE subscribers ADD COLUMN consented_at TEXT;
ALTER TABLE subscribers ADD COLUMN unsubscribed_at TEXT;
ALTER TABLE subscribers ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_subscribers_project_status
  ON subscribers(project_id, status, consent_status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_optin_token
  ON subscribers(optin_token_hash) WHERE optin_token_hash IS NOT NULL;

ALTER TABLE campaigns ADD COLUMN template_id TEXT;
ALTER TABLE campaigns ADD COLUMN content_html TEXT;
ALTER TABLE campaigns ADD COLUMN content_text TEXT;
ALTER TABLE campaigns ADD COLUMN list_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(list_ids_json));
ALTER TABLE campaigns ADD COLUMN segment_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(segment_ids_json));
ALTER TABLE campaigns ADD COLUMN smtp_profile_id TEXT;
ALTER TABLE campaigns ADD COLUMN started_at TEXT;
ALTER TABLE campaigns ADD COLUMN paused_at TEXT;
ALTER TABLE campaigns ADD COLUMN cancelled_at TEXT;
ALTER TABLE campaigns ADD COLUMN finished_at TEXT;
ALTER TABLE campaigns ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_campaigns_project_status_schedule
  ON campaigns(project_id, status, scheduled_at);

ALTER TABLE smtp_profiles ADD COLUMN priority INTEGER NOT NULL DEFAULT 100 CHECK (priority > 0);
ALTER TABLE smtp_profiles ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));
ALTER TABLE smtp_profiles ADD COLUMN last_tested_at TEXT;
ALTER TABLE smtp_profiles ADD COLUMN last_test_status TEXT CHECK (last_test_status IS NULL OR last_test_status IN ('success', 'failed'));
ALTER TABLE smtp_profiles ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_smtp_profiles_project_priority
  ON smtp_profiles(project_id, enabled, priority);

ALTER TABLE audit_events ADD COLUMN actor_id TEXT;
ALTER TABLE audit_events ADD COLUMN request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_marketing_audit_project_created
  ON audit_events(project_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS marketing_audit_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'marketing audit events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS marketing_audit_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'marketing audit events are immutable');
END;

CREATE TABLE IF NOT EXISTS subscriber_lists (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  optin_mode TEXT NOT NULL DEFAULT 'single' CHECK (optin_mode IN ('single', 'double')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS subscriber_list_memberships (
  project_id INTEGER NOT NULL,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  list_id TEXT NOT NULL REFERENCES subscriber_lists(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'admin',
  subscribed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(project_id, subscriber_id, list_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriber_list_memberships_list
  ON subscriber_list_memberships(project_id, list_id, subscriber_id);

CREATE TABLE IF NOT EXISTS subscriber_segments (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  rules_json TEXT NOT NULL CHECK (json_valid(rules_json)),
  refreshed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS segment_memberships (
  project_id INTEGER NOT NULL,
  segment_id TEXT NOT NULL REFERENCES subscriber_segments(id) ON DELETE CASCADE,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  matched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(project_id, segment_id, subscriber_id)
);

CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  template_type TEXT NOT NULL CHECK (template_type IN ('campaign', 'transactional', 'system')),
  subject TEXT,
  content_html TEXT,
  content_markdown TEXT,
  content_text TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name, template_type)
);

CREATE TABLE IF NOT EXISTS marketing_media (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  smtp_profile_id TEXT REFERENCES smtp_profiles(id) ON DELETE SET NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'sending', 'sent', 'delivered', 'bounced', 'complained',
    'unsubscribed', 'suppressed', 'failed'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(campaign_id, subscriber_id)
);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_campaign_status
  ON email_deliveries(project_id, campaign_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_deliveries_provider_message
  ON email_deliveries(project_id, provider_message_id) WHERE provider_message_id IS NOT NULL;

ALTER TABLE email_events ADD COLUMN subscriber_id TEXT;
ALTER TABLE email_events ADD COLUMN delivery_id TEXT;
ALTER TABLE email_events ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json));

CREATE INDEX IF NOT EXISTS idx_email_events_campaign_time
  ON email_events(project_id, campaign_id, occurred_at, event_type);

CREATE TABLE IF NOT EXISTS smtp_attempts (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES email_deliveries(id) ON DELETE CASCADE,
  smtp_profile_id TEXT NOT NULL REFERENCES smtp_profiles(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS suppressions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('manual', 'unsubscribe', 'hard_bounce', 'complaint', 'privacy_delete')),
  source TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, email)
);

CREATE TABLE IF NOT EXISTS marketing_idempotency_keys (
  project_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  request_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('processing', 'completed')),
  response_status INTEGER,
  response_body TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  PRIMARY KEY(project_id, key)
);

CREATE INDEX IF NOT EXISTS idx_marketing_idempotency_created
  ON marketing_idempotency_keys(project_id, created_at);
