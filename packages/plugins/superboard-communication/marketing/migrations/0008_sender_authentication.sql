ALTER TABLE smtp_profiles ADD COLUMN dkim_selector TEXT;
ALTER TABLE smtp_profiles ADD COLUMN authentication_status TEXT NOT NULL DEFAULT 'unverified'
  CHECK (authentication_status IN ('unverified', 'verified', 'failed'));
ALTER TABLE smtp_profiles ADD COLUMN spf_status TEXT;
ALTER TABLE smtp_profiles ADD COLUMN dkim_status TEXT;
ALTER TABLE smtp_profiles ADD COLUMN dmarc_status TEXT;
ALTER TABLE smtp_profiles ADD COLUMN authentication_checked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_smtp_profiles_sender_readiness
  ON smtp_profiles(project_id, enabled, authentication_status, priority);
