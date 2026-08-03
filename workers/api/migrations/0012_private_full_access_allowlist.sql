CREATE TABLE IF NOT EXISTS registration_allowlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  realm TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  note TEXT,
  registration_count INTEGER NOT NULL DEFAULT 0,
  last_registered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(realm, email)
);

CREATE INDEX IF NOT EXISTS idx_registration_allowlist_realm_active
  ON registration_allowlist(realm, active);
