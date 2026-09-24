CREATE TABLE IF NOT EXISTS email_studio_frequency (
  project_id INTEGER NOT NULL,
  recipient_email TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  next_allowed_at TEXT NOT NULL,
  PRIMARY KEY(project_id, recipient_email)
);
CREATE INDEX IF NOT EXISTS idx_email_studio_frequency_delivery
  ON email_studio_frequency(project_id, delivery_id);
