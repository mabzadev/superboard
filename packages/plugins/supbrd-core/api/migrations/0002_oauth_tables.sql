-- Migration 0002: OAuth2 tables + missing columns

-- Table OAuth applications (équivalent Doorkeeper)
CREATE TABLE IF NOT EXISTS oauth_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  uid TEXT NOT NULL UNIQUE,
  secret TEXT NOT NULL,
  redirect_uri TEXT DEFAULT 'urn:ietf:wg:oauth:2.0:oob',
  scopes TEXT NOT NULL DEFAULT 'read write',
  confidential INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

-- Table OAuth access tokens
CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_owner_id INTEGER,
  application_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  refresh_token TEXT UNIQUE,
  expires_in INTEGER,
  revoked_at DATETIME,
  scopes TEXT DEFAULT 'read write',
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (resource_owner_id) REFERENCES users(id),
  FOREIGN KEY (application_id) REFERENCES oauth_applications(id)
);

-- Historical seed retained for migration ordering. The bootstrap rotation replaces
-- this disabled placeholder before any dashboard is exposed.
INSERT OR IGNORE INTO oauth_applications (name, uid, secret, redirect_uri, scopes)
VALUES (
  'Legacy Dashboard (disabled)',
  'legacy-dashboard-disabled',
  'DISABLED_ROTATE_VIA_BOOTSTRAP',
  'urn:ietf:wg:oauth:2.0:oob',
  'read write'
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_token ON oauth_access_tokens(token);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh ON oauth_access_tokens(refresh_token);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_owner ON oauth_access_tokens(resource_owner_id);
