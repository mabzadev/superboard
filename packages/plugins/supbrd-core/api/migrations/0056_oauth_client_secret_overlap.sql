-- Permit a bounded overlap while the Dashboard Worker changes OAuth secrets.
-- The previous verifier is never returned by the API and expires automatically.
ALTER TABLE oauth_applications ADD COLUMN previous_secret TEXT;
ALTER TABLE oauth_applications ADD COLUMN previous_secret_expires_at DATETIME;
