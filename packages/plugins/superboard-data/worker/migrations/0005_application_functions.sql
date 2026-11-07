CREATE TABLE IF NOT EXISTS data_functions (
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  access TEXT NOT NULL DEFAULT 'authenticated' CHECK (access IN ('public','authenticated','service')),
  active_version INTEGER,
  timeout_ms INTEGER NOT NULL DEFAULT 30000 CHECK (timeout_ms BETWEEN 1000 AND 300000),
  vars_json TEXT NOT NULL DEFAULT '{}',
  secrets_ciphertext TEXT,
  secret_names_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, name)
);

CREATE TABLE IF NOT EXISTS data_function_versions (
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, name, version)
);

CREATE TABLE IF NOT EXISTS data_function_runs (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('http','schedule','test')),
  status INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok','error','timeout')),
  duration_ms INTEGER NOT NULL,
  logs_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  started_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_data_function_runs_name
  ON data_function_runs(project_id, name, started_at);
CREATE INDEX IF NOT EXISTS idx_data_function_runs_started ON data_function_runs(started_at);

CREATE TABLE IF NOT EXISTS data_function_schedules (
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_data_function_schedules_due
  ON data_function_schedules(enabled, next_run_at);
