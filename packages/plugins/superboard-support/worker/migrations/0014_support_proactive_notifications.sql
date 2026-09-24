PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_campaigns (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  inbox_id TEXT NOT NULL REFERENCES support_inboxes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  campaign_type TEXT NOT NULL CHECK (campaign_type IN ('one_off', 'ongoing')),
  message TEXT NOT NULL,
  audience_json TEXT NOT NULL CHECK (json_valid(audience_json)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed')),
  scheduled_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_support_campaigns_schedule
  ON support_campaigns(project_id, status, scheduled_at);

CREATE TABLE IF NOT EXISTS support_campaign_deliveries (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES support_campaigns(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES support_contacts(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  endpoint_id TEXT REFERENCES support_provider_endpoints(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'cancelled')),
  provider_reference TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(campaign_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_support_campaign_deliveries_status
  ON support_campaign_deliveries(project_id, campaign_id, status);

CREATE TABLE IF NOT EXISTS support_notification_preferences (
  project_id INTEGER NOT NULL,
  membership_id TEXT NOT NULL REFERENCES support_memberships(id) ON DELETE CASCADE,
  email_enabled INTEGER NOT NULL DEFAULT 1 CHECK (email_enabled IN (0, 1)),
  push_enabled INTEGER NOT NULL DEFAULT 1 CHECK (push_enabled IN (0, 1)),
  browser_enabled INTEGER NOT NULL DEFAULT 1 CHECK (browser_enabled IN (0, 1)),
  in_app_enabled INTEGER NOT NULL DEFAULT 1 CHECK (in_app_enabled IN (0, 1)),
  audio_enabled INTEGER NOT NULL DEFAULT 1 CHECK (audio_enabled IN (0, 1)),
  muted_event_types_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(muted_event_types_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(project_id, membership_id)
);

ALTER TABLE support_agent_notifications ADD COLUMN snoozed_until TEXT;
ALTER TABLE support_agent_notifications ADD COLUMN deleted_at TEXT;

INSERT OR IGNORE INTO support_campaigns (
  id, project_id, inbox_id, name, campaign_type, message, audience_json, status, scheduled_at, created_by
)
SELECT entity.id, entity.project_id,
  json_extract(entity.configuration_json, '$.inbox_id'), entity.name,
  COALESCE(json_extract(entity.configuration_json, '$.campaign_type'), 'one_off'),
  json_extract(entity.configuration_json, '$.message'),
  COALESCE(json_extract(entity.configuration_json, '$.audience'), '{}'),
  CASE WHEN entity.enabled = 1 THEN 'draft' ELSE 'cancelled' END,
  json_extract(entity.configuration_json, '$.scheduled_at'),
  COALESCE(entity.created_by, 'system')
FROM support_configuration_entities entity
WHERE entity.entity_type = 'campaign'
  AND EXISTS (SELECT 1 FROM support_inboxes inbox WHERE inbox.id = json_extract(entity.configuration_json, '$.inbox_id'))
  AND json_type(entity.configuration_json, '$.message') = 'text';
