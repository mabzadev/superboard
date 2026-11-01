PRAGMA foreign_keys = ON;

-- Embeddable signup forms. Public submissions go through /public/v1/forms/:id.
CREATE TABLE IF NOT EXISTS marketing_signup_forms (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  settings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
  submission_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_marketing_signup_forms_project
  ON marketing_signup_forms(project_id, updated_at DESC);

-- Fixed-window submission counters per form and hashed client address.
CREATE TABLE IF NOT EXISTS marketing_form_rate_limits (
  form_id TEXT NOT NULL REFERENCES marketing_signup_forms(id) ON DELETE CASCADE,
  client_hash TEXT NOT NULL,
  window_start TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(form_id, client_hash, window_start)
);

CREATE INDEX IF NOT EXISTS idx_marketing_form_rate_limits_window
  ON marketing_form_rate_limits(window_start);
