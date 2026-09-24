PRAGMA foreign_keys = OFF;

CREATE TABLE application_users_scoped (
  id TEXT PRIMARY KEY,
  project_id INTEGER,
  email TEXT,
  password_hash TEXT,
  name TEXT,
  is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1)),
  email_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  UNIQUE(project_id, id),
  UNIQUE(project_id, email)
);

CREATE TABLE application_identities_scoped (
  id TEXT PRIMARY KEY,
  project_id INTEGER,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('anonymous', 'google', 'apple')),
  subject_hash TEXT NOT NULL,
  provider_email TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, provider, subject_hash),
  FOREIGN KEY(project_id, user_id)
    REFERENCES application_users_scoped(project_id, id) ON DELETE CASCADE
);

CREATE TABLE application_sessions_scoped (
  id TEXT PRIMARY KEY,
  project_id INTEGER,
  user_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rotated_from_id TEXT,
  FOREIGN KEY(project_id, user_id)
    REFERENCES application_users_scoped(project_id, id) ON DELETE CASCADE
);

CREATE TABLE application_identity_tokens_scoped (
  id TEXT PRIMARY KEY,
  project_id INTEGER,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id, user_id)
    REFERENCES application_users_scoped(project_id, id) ON DELETE CASCADE
);

INSERT INTO application_users_scoped
  (id,email,password_hash,name,is_anonymous,email_verified_at,created_at,updated_at,deleted_at)
SELECT id,email,password_hash,name,is_anonymous,email_verified_at,created_at,updated_at,deleted_at
FROM application_users;

INSERT INTO application_identities_scoped
  (id,user_id,provider,subject_hash,provider_email,created_at)
SELECT id,user_id,provider,subject_hash,provider_email,created_at
FROM application_identities;

INSERT INTO application_sessions_scoped
  (id,user_id,refresh_token_hash,expires_at,revoked_at,created_at,rotated_from_id)
SELECT id,user_id,refresh_token_hash,expires_at,revoked_at,created_at,rotated_from_id
FROM application_sessions;

INSERT INTO application_identity_tokens_scoped
  (id,user_id,purpose,token_hash,expires_at,consumed_at,created_at)
SELECT id,user_id,purpose,token_hash,expires_at,consumed_at,created_at
FROM application_identity_tokens;

DROP TABLE application_identity_tokens;
DROP TABLE application_sessions;
DROP TABLE application_identities;
DROP TABLE application_users;

ALTER TABLE application_users_scoped RENAME TO application_users;
ALTER TABLE application_identities_scoped RENAME TO application_identities;
ALTER TABLE application_sessions_scoped RENAME TO application_sessions;
ALTER TABLE application_identity_tokens_scoped RENAME TO application_identity_tokens;

CREATE INDEX application_users_project_created_idx
  ON application_users(project_id, created_at DESC, id DESC);
CREATE INDEX application_identities_project_user_idx
  ON application_identities(project_id, user_id);
CREATE INDEX application_sessions_project_user_idx
  ON application_sessions(project_id, user_id, revoked_at, expires_at);
CREATE INDEX application_identity_tokens_project_user_idx
  ON application_identity_tokens(project_id, user_id, purpose);

CREATE TRIGGER application_users_project_required_insert
BEFORE INSERT ON application_users
WHEN NEW.project_id IS NULL OR NEW.project_id <= 0
BEGIN SELECT RAISE(ABORT, 'identity_project_required'); END;

CREATE TRIGGER application_users_project_required_update
BEFORE UPDATE OF project_id ON application_users
WHEN NEW.project_id IS NULL OR NEW.project_id <= 0
BEGIN SELECT RAISE(ABORT, 'identity_project_required'); END;

CREATE TRIGGER application_identities_project_required_insert
BEFORE INSERT ON application_identities
WHEN NEW.project_id IS NULL OR NEW.project_id <= 0
BEGIN SELECT RAISE(ABORT, 'identity_project_required'); END;

CREATE TRIGGER application_identities_project_required_update
BEFORE UPDATE OF project_id ON application_identities
WHEN NEW.project_id IS NULL OR NEW.project_id <= 0
BEGIN SELECT RAISE(ABORT, 'identity_project_required'); END;

CREATE TRIGGER application_sessions_project_required_insert
BEFORE INSERT ON application_sessions
WHEN NEW.project_id IS NULL OR NEW.project_id <= 0
BEGIN SELECT RAISE(ABORT, 'identity_project_required'); END;

CREATE TRIGGER application_sessions_project_required_update
BEFORE UPDATE OF project_id ON application_sessions
WHEN NEW.project_id IS NULL OR NEW.project_id <= 0
BEGIN SELECT RAISE(ABORT, 'identity_project_required'); END;

CREATE TRIGGER application_identity_tokens_project_required_insert
BEFORE INSERT ON application_identity_tokens
WHEN NEW.project_id IS NULL OR NEW.project_id <= 0
BEGIN SELECT RAISE(ABORT, 'identity_project_required'); END;

CREATE TRIGGER application_identity_tokens_project_required_update
BEFORE UPDATE OF project_id ON application_identity_tokens
WHEN NEW.project_id IS NULL OR NEW.project_id <= 0
BEGIN SELECT RAISE(ABORT, 'identity_project_required'); END;

PRAGMA foreign_keys = ON;
