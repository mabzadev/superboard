CREATE TABLE IF NOT EXISTS email_studio_published (
  project_id INTEGER NOT NULL,
  template_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  document_json TEXT NOT NULL CHECK(json_valid(document_json)),
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(project_id,template_id)
);
INSERT OR IGNORE INTO email_studio_published (project_id,template_id,revision,document_json)
SELECT project_id,resource_id,revision,document_json FROM (
  SELECT project_id,resource_id,revision,document_json,
    ROW_NUMBER() OVER (PARTITION BY project_id,resource_id ORDER BY revision DESC) AS position
  FROM email_studio_versions
  WHERE resource_type='template'
    AND json_extract(document_json,'$.locales.' || json_extract(document_json,'$.fallback_locale') || '.status')='approved'
    AND json_extract(document_json,'$.locales.' || json_extract(document_json,'$.fallback_locale') || '.source_revision')=json_extract(document_json,'$.source_revision')
) WHERE position=1;
