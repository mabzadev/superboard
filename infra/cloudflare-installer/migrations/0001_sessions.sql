CREATE TABLE IF NOT EXISTS installer_sessions (
	id TEXT PRIMARY KEY,
	payload TEXT NOT NULL,
	expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_installer_sessions_expires ON installer_sessions (expires);
