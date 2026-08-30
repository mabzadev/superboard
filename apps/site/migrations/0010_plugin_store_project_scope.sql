PRAGMA foreign_keys = ON;

ALTER TABLE superboard_plugin_store_records
  ADD COLUMN project_ref TEXT NOT NULL DEFAULT 'legacy-unscoped';

UPDATE superboard_plugin_store_records
SET project_ref = substr(entity_id, 1, instr(entity_id, ':') - 1)
WHERE project_ref = 'legacy-unscoped'
  AND instr(entity_id, ':') > 1
  AND (
    substr(entity_id, 1, instr(entity_id, ':') - 1) GLOB '[0-9]*-test'
    OR substr(entity_id, 1, instr(entity_id, ':') - 1) GLOB '[0-9]*-prod'
  );

CREATE INDEX IF NOT EXISTS idx_superboard_plugin_store_project
ON superboard_plugin_store_records(
  instance_id,
  project_ref,
  plugin_id,
  store_id,
  entity_type,
  entity_id
);
