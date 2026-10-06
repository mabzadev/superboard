CREATE TABLE IF NOT EXISTS installer_grant_locks (
	id TEXT PRIMARY KEY,
	ticket TEXT NOT NULL,
	expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS installer_installations (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL,
	account_id TEXT NOT NULL,
	grant_id TEXT NOT NULL,
	environment TEXT NOT NULL CHECK(environment IN ('development', 'production')),
	target_name TEXT NOT NULL,
	automatic_updates INTEGER NOT NULL DEFAULT 1,
	status TEXT NOT NULL DEFAULT 'queued',
	desired_revision TEXT NOT NULL,
	deployed_revision TEXT,
	run_id TEXT,
	run_revision TEXT,
	lease_hash TEXT,
	lease_expires INTEGER,
	github_run_id TEXT,
	error_code TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE(account_id, target_name)
);
CREATE INDEX IF NOT EXISTS idx_installer_installations_owner ON installer_installations(owner_id);
CREATE INDEX IF NOT EXISTS idx_installer_installations_grant ON installer_installations(grant_id);
CREATE INDEX IF NOT EXISTS idx_installer_installations_status ON installer_installations(status, automatic_updates);
