PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS superboard_plugin_installation_plans (
  plan_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('local', 'development', 'production')),
  status TEXT NOT NULL CHECK (status IN ('installing', 'installed', 'active', 'failed')),
  catalog_checksum TEXT NOT NULL,
  plugin_count INTEGER NOT NULL CHECK (plugin_count > 0),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  compensation_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (compensation_status IN ('not_required', 'completed', 'quarantined')),
  failure_json TEXT CHECK (failure_json IS NULL OR json_valid(failure_json)),
  UNIQUE(instance_id, target, plan_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_installation_plans_scope
  ON superboard_plugin_installation_plans(instance_id, target, created_at);

CREATE TABLE IF NOT EXISTS superboard_plugin_installation_items (
  plan_id TEXT NOT NULL
    REFERENCES superboard_plugin_installation_plans(plan_id),
  plugin_id TEXT NOT NULL,
  artifact_checksum TEXT NOT NULL
    REFERENCES superboard_plugin_manifest_artifacts(artifact_checksum),
  state TEXT NOT NULL CHECK (state IN ('staged', 'installed', 'active', 'failed')),
  derived_contract_json TEXT NOT NULL CHECK (json_valid(derived_contract_json)),
  derived_contract_checksum TEXT NOT NULL,
  health_status TEXT NOT NULL CHECK (health_status IN ('ready', 'unavailable')),
  PRIMARY KEY (plan_id, plugin_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_installation_items_artifact
  ON superboard_plugin_installation_items(artifact_checksum);

CREATE TABLE IF NOT EXISTS superboard_plugin_installation_steps (
  plan_id TEXT NOT NULL
    REFERENCES superboard_plugin_installation_plans(plan_id),
  plugin_id TEXT NOT NULL,
  step_name TEXT NOT NULL CHECK (
    step_name IN ('artifact_verified', 'publisher_verified', 'capabilities_approved',
                  'stores_provisioned', 'migration_graph_verified',
                  'worker_deployed_inactive', 'health_verified', 'release_contract_ready')
  ),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'compensated')),
  receipt_checksum TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (plan_id, plugin_id, step_name),
  FOREIGN KEY (plan_id, plugin_id)
    REFERENCES superboard_plugin_installation_items(plan_id, plugin_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_installation_steps_plan
  ON superboard_plugin_installation_steps(plan_id, plugin_id);

CREATE TABLE IF NOT EXISTS superboard_plugin_lifecycle (
  instance_id TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('local', 'development', 'production')),
  plugin_id TEXT NOT NULL,
  artifact_checksum TEXT NOT NULL
    REFERENCES superboard_plugin_manifest_artifacts(artifact_checksum),
  state TEXT NOT NULL CHECK (
    state IN ('available', 'staged', 'installed', 'active', 'draining',
              'disabled', 'quarantined', 'purged')
  ),
  plan_id TEXT REFERENCES superboard_plugin_installation_plans(plan_id),
  activated_release_id TEXT,
  state_changed_at TEXT NOT NULL,
  reason TEXT,
  PRIMARY KEY (instance_id, target, plugin_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_lifecycle_active_scope
  ON superboard_plugin_lifecycle(instance_id, target, state, plugin_id);
CREATE INDEX IF NOT EXISTS idx_plugin_lifecycle_artifact
  ON superboard_plugin_lifecycle(artifact_checksum);
CREATE INDEX IF NOT EXISTS idx_plugin_lifecycle_plan
  ON superboard_plugin_lifecycle(plan_id);

DROP TRIGGER IF EXISTS superboard_plugin_store_authority_insert_guard;
CREATE TRIGGER superboard_plugin_store_authority_insert_guard
BEFORE INSERT ON superboard_plugin_store_records
WHEN NOT EXISTS (
  SELECT 1 FROM superboard_plugin_lifecycle AS lifecycle
  JOIN superboard_plugin_manifest_artifacts AS artifact
    ON artifact.artifact_checksum = lifecycle.artifact_checksum
  JOIN json_each(artifact.manifest_json, '$.stores') AS store
  WHERE lifecycle.instance_id = NEW.instance_id
    AND lifecycle.plugin_id = NEW.plugin_id
    AND lifecycle.state = 'active'
    AND lifecycle.artifact_checksum = NEW.manifest_artifact_checksum
    AND json_extract(store.value, '$.store_id') = NEW.store_id
    AND json_extract(store.value, '$.authority') = NEW.plugin_id
)
BEGIN
  SELECT RAISE(ABORT, 'plugin Store write authority rejected');
END;

DROP TRIGGER IF EXISTS superboard_plugin_store_authority_update_guard;
CREATE TRIGGER superboard_plugin_store_authority_update_guard
BEFORE UPDATE ON superboard_plugin_store_records
WHEN NOT EXISTS (
  SELECT 1 FROM superboard_plugin_lifecycle AS lifecycle
  JOIN superboard_plugin_manifest_artifacts AS artifact
    ON artifact.artifact_checksum = lifecycle.artifact_checksum
  JOIN json_each(artifact.manifest_json, '$.stores') AS store
  WHERE lifecycle.instance_id = NEW.instance_id
    AND lifecycle.plugin_id = NEW.plugin_id
    AND lifecycle.state = 'active'
    AND lifecycle.artifact_checksum = NEW.manifest_artifact_checksum
    AND json_extract(store.value, '$.store_id') = NEW.store_id
    AND json_extract(store.value, '$.authority') = NEW.plugin_id
)
BEGIN
  SELECT RAISE(ABORT, 'plugin Store write authority rejected');
END;

CREATE TABLE IF NOT EXISTS superboard_plugin_lifecycle_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('local', 'development', 'production')),
  plugin_id TEXT NOT NULL,
  artifact_checksum TEXT NOT NULL,
  from_state TEXT CHECK (
    from_state IS NULL OR from_state IN ('available', 'staged', 'installed', 'active',
                                         'draining', 'disabled', 'quarantined', 'purged')
  ),
  to_state TEXT NOT NULL CHECK (
    to_state IN ('available', 'staged', 'installed', 'active', 'draining',
                 'disabled', 'quarantined', 'purged')
  ),
  plan_id TEXT REFERENCES superboard_plugin_installation_plans(plan_id),
  release_id TEXT,
  reason TEXT,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plugin_lifecycle_events_scope
  ON superboard_plugin_lifecycle_events(instance_id, target, plugin_id, event_id);
CREATE INDEX IF NOT EXISTS idx_plugin_lifecycle_events_plan
  ON superboard_plugin_lifecycle_events(plan_id);

CREATE TRIGGER IF NOT EXISTS superboard_plugin_lifecycle_events_immutable_update
BEFORE UPDATE ON superboard_plugin_lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'plugin lifecycle events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_lifecycle_events_immutable_delete
BEFORE DELETE ON superboard_plugin_lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'plugin lifecycle events are immutable');
END;

CREATE TABLE IF NOT EXISTS superboard_plugin_runtime_health (
  instance_id TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('local', 'development', 'production')),
  plugin_id TEXT NOT NULL,
  artifact_checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'unavailable')),
  evidence_checksum TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (instance_id, target, plugin_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_runtime_health_ready
  ON superboard_plugin_runtime_health(instance_id, target, status, expires_at);
