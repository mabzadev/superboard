CREATE TABLE IF NOT EXISTS marketing_email_profile_authority (
  project_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  last_cursor TEXT NOT NULL DEFAULT '',
  completed_at TEXT
);
CREATE TRIGGER IF NOT EXISTS marketing_smtp_profile_authority_insert
BEFORE INSERT ON smtp_profiles WHEN EXISTS (SELECT 1 FROM marketing_email_profile_authority WHERE project_id = NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'SMTP profile authority moved to Email'); END;
CREATE TRIGGER IF NOT EXISTS marketing_smtp_profile_authority_update
BEFORE UPDATE ON smtp_profiles WHEN EXISTS (SELECT 1 FROM marketing_email_profile_authority WHERE project_id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'SMTP profile authority moved to Email'); END;
CREATE TRIGGER IF NOT EXISTS marketing_smtp_profile_authority_delete
BEFORE DELETE ON smtp_profiles WHEN EXISTS (SELECT 1 FROM marketing_email_profile_authority WHERE project_id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'SMTP profile authority moved to Email'); END;
