CREATE TABLE IF NOT EXISTS support_dead_letters (
  id TEXT PRIMARY KEY,
  source_queue TEXT NOT NULL,
  message_id TEXT NOT NULL,
  job_type TEXT,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL,
  replayable INTEGER NOT NULL DEFAULT 0 CHECK (replayable IN (0, 1)),
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'quarantined' CHECK (status IN ('quarantined', 'discarded')),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source_queue, message_id)
);

CREATE INDEX IF NOT EXISTS support_dead_letters_status_received
  ON support_dead_letters(status, received_at DESC);
