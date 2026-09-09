CREATE TABLE IF NOT EXISTS vocostar_runtime_identities (
	legacy_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	project_ref TEXT NOT NULL,
	subject TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	UNIQUE (project_ref, subject)
);

CREATE TRIGGER IF NOT EXISTS vocostar_runtime_identity_project_guard
BEFORE INSERT ON vocostar_runtime_identities
WHEN EXISTS (
	SELECT 1 FROM opengrow_custom_jobs
	WHERE user_id = NEW.legacy_user_id AND project_ref <> NEW.project_ref
)
BEGIN
	SELECT RAISE(ABORT, 'runtime_identity_project_conflict');
END;

CREATE TRIGGER IF NOT EXISTS vocostar_runtime_job_insert_guard
BEFORE INSERT ON opengrow_custom_jobs
WHEN EXISTS (
	SELECT 1 FROM vocostar_runtime_identities
	WHERE legacy_user_id = NEW.user_id AND project_ref <> NEW.project_ref
)
BEGIN
	SELECT RAISE(ABORT, 'runtime_identity_project_conflict');
END;

CREATE TRIGGER IF NOT EXISTS vocostar_runtime_job_update_guard
BEFORE UPDATE OF project_ref, user_id ON opengrow_custom_jobs
WHEN EXISTS (
	SELECT 1 FROM vocostar_runtime_identities
	WHERE legacy_user_id = NEW.user_id AND project_ref <> NEW.project_ref
)
BEGIN
	SELECT RAISE(ABORT, 'runtime_identity_project_conflict');
END;

INSERT OR IGNORE INTO vocostar_runtime_identities (legacy_user_id, project_ref, subject)
SELECT jobs.user_id, MIN(jobs.project_ref), jobs.user_id
FROM opengrow_custom_jobs AS jobs
JOIN users ON users.id = jobs.user_id
GROUP BY jobs.user_id
HAVING COUNT(DISTINCT jobs.project_ref) = 1;
