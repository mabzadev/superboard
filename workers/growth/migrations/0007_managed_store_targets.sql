ALTER TABLE growth_apps ADD COLUMN management_source TEXT
  CHECK (management_source IS NULL OR management_source = 'store_connection');

CREATE UNIQUE INDEX growth_apps_management_idx
  ON growth_apps (project_id, platform, management_source)
  WHERE management_source IS NOT NULL;
