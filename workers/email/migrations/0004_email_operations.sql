ALTER TABLE email_dead_letters ADD COLUMN resolution TEXT
  CHECK (resolution IN ('replayed', 'discarded'));
ALTER TABLE email_dead_letters ADD COLUMN resolved_at TEXT;

CREATE INDEX IF NOT EXISTS idx_email_dead_letters_resolution
  ON email_dead_letters(resolution, resolved_at DESC);
