ALTER TABLE links ADD COLUMN data_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data_json));
ALTER TABLE links ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json));
ALTER TABLE links ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1));
ALTER TABLE links ADD COLUMN use_project_defaults INTEGER NOT NULL DEFAULT 0 CHECK(use_project_defaults IN (0,1));
CREATE TABLE IF NOT EXISTS link_default_redirects (
 project_id INTEGER PRIMARY KEY,
 configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
