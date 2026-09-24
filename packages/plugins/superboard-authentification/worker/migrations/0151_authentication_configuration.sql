CREATE TABLE IF NOT EXISTS identity_configuration (
  realm TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  values_json TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_configuration_history (
  realm TEXT NOT NULL,
  revision INTEGER NOT NULL,
  values_json TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (realm, revision)
);
