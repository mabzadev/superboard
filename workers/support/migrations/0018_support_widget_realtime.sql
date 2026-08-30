PRAGMA foreign_keys = ON;

ALTER TABLE support_realtime_tickets
  ADD COLUMN actor_kind TEXT NOT NULL DEFAULT 'agent'
  CHECK (actor_kind IN ('user', 'agent'));

CREATE INDEX IF NOT EXISTS idx_support_realtime_tickets_actor
  ON support_realtime_tickets(project_id, actor_kind, actor_id, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_widget_key_hash
  ON support_provider_endpoints(json_extract(settings_json, '$.widget_key_hash'))
  WHERE provider = 'widget'
    AND json_extract(settings_json, '$.widget_key_hash') IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_attachment_uploads (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  uploader_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, conversation_id, uploader_hash, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_support_attachment_uploads_expiry
  ON support_attachment_uploads(expires_at, project_id);
