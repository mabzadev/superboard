CREATE TABLE IF NOT EXISTS email_studio_documents (
  project_id INTEGER NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('template', 'campaign', 'block')),
  resource_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  document_json TEXT NOT NULL CHECK (json_valid(document_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, resource_type, resource_id)
);
CREATE TABLE IF NOT EXISTS email_studio_versions (
  project_id INTEGER NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  document_json TEXT NOT NULL CHECK (json_valid(document_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, resource_type, resource_id, revision)
);
CREATE TABLE IF NOT EXISTS email_studio_deliveries (
  project_id INTEGER NOT NULL,
  delivery_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  locale TEXT,
  requested_locale TEXT,
  reason TEXT NOT NULL,
  revision INTEGER NOT NULL,
  subject TEXT,
  content_html TEXT,
  content_text TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, delivery_id)
);
CREATE INDEX IF NOT EXISTS idx_email_studio_deliveries_resource
  ON email_studio_deliveries(project_id, resource_id, created_at, delivery_id);
CREATE INDEX IF NOT EXISTS idx_email_studio_deliveries_locale
  ON email_studio_deliveries(project_id, locale, created_at, delivery_id);
CREATE TABLE IF NOT EXISTS email_studio_settings (
  project_id INTEGER PRIMARY KEY,
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json))
);
CREATE TABLE IF NOT EXISTS email_studio_contexts (
  project_id INTEGER NOT NULL,
  campaign_id TEXT NOT NULL,
  context_json TEXT NOT NULL CHECK (json_valid(context_json)),
  PRIMARY KEY(project_id, campaign_id)
);
