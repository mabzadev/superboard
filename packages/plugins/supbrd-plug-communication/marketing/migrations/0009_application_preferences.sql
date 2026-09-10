PRAGMA foreign_keys = ON;

ALTER TABLE subscribers ADD COLUMN application_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_project_application_user
  ON subscribers(project_id, application_user_id)
  WHERE application_user_id IS NOT NULL;
