PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_message_attachments (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  source_provider TEXT,
  source_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(message_id, position),
  UNIQUE(storage_key)
);

CREATE INDEX IF NOT EXISTS idx_support_message_attachments_message
  ON support_message_attachments(conversation_id, message_id, position);

INSERT OR IGNORE INTO support_message_attachments (
  id, project_id, conversation_id, message_id, storage_key, file_name,
  content_type, position, source_provider, source_id, created_at
)
SELECT
  message.id || ':attachment:0',
  conversation.project_id,
  message.conversation_id,
  message.id,
  message.attachment_key,
  COALESCE(message.attachment_name, 'attachment'),
  COALESCE(message.attachment_content_type, 'application/octet-stream'),
  0,
  'opengrow-legacy',
  message.id,
  message.created_at
FROM messages AS message
INNER JOIN conversations AS conversation ON conversation.id = message.conversation_id
WHERE message.attachment_key IS NOT NULL;
