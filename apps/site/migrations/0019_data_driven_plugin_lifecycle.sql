PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS superboard_plugin_target_artifacts (
  instance_id TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('local', 'development', 'production')),
  artifact_checksum TEXT NOT NULL,
  plugin_ids_json TEXT NOT NULL CHECK (json_valid(plugin_ids_json)),
  registered_at TEXT NOT NULL,
  PRIMARY KEY (instance_id, target)
);

CREATE INDEX IF NOT EXISTS idx_plugin_target_artifacts_checksum
  ON superboard_plugin_target_artifacts(artifact_checksum);

CREATE TABLE IF NOT EXISTS superboard_plugin_installation_plans (
  plan_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('local', 'development', 'production')),
  target_artifact_checksum TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS superboard_plugin_release_reconciliations (
  instance_id TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('local', 'development', 'production')),
  release_id TEXT NOT NULL
    REFERENCES superboard_front_release_candidates(release_id),
  target_artifact_checksum TEXT NOT NULL,
  plugin_lock_json TEXT NOT NULL CHECK (json_valid(plugin_lock_json)),
  status TEXT NOT NULL CHECK (status IN ('prepared', 'applied')),
  prepared_at TEXT NOT NULL,
  applied_at TEXT,
  PRIMARY KEY (instance_id, target, release_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_release_reconciliations_release
  ON superboard_plugin_release_reconciliations(release_id);

CREATE TRIGGER IF NOT EXISTS superboard_plugin_release_reconciliation_insert_guard
BEFORE INSERT ON superboard_front_active_releases
WHEN EXISTS (
  SELECT 1 FROM superboard_plugin_lifecycle lifecycle
  WHERE lifecycle.instance_id = NEW.instance_id
)
AND NOT EXISTS (
  SELECT 1 FROM superboard_plugin_release_reconciliations reconciliation
  WHERE reconciliation.instance_id = NEW.instance_id
    AND reconciliation.release_id = NEW.active_release_id
    AND reconciliation.status = 'prepared'
)
BEGIN
  SELECT RAISE(ABORT, 'plugin lifecycle reconciliation is not prepared');
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_release_reconciliation_update_guard
BEFORE UPDATE ON superboard_front_active_releases
WHEN EXISTS (
  SELECT 1 FROM superboard_plugin_lifecycle lifecycle
  WHERE lifecycle.instance_id = NEW.instance_id
)
AND NOT EXISTS (
  SELECT 1 FROM superboard_plugin_release_reconciliations reconciliation
  WHERE reconciliation.instance_id = NEW.instance_id
    AND reconciliation.release_id = NEW.active_release_id
    AND reconciliation.status = 'prepared'
)
BEGIN
  SELECT RAISE(ABORT, 'plugin lifecycle reconciliation is not prepared');
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_release_reconciliation_insert_fresh_guard
BEFORE INSERT ON superboard_front_active_releases
WHEN EXISTS (
  SELECT 1 FROM superboard_plugin_release_reconciliations reconciliation
  WHERE reconciliation.instance_id = NEW.instance_id
    AND reconciliation.release_id = NEW.active_release_id
    AND reconciliation.status = 'prepared'
    AND (
      reconciliation.target_artifact_checksum <> COALESCE((
        SELECT target_artifact.artifact_checksum
        FROM superboard_plugin_target_artifacts target_artifact
        WHERE target_artifact.instance_id = reconciliation.instance_id
          AND target_artifact.target = reconciliation.target
      ), '')
      OR
      EXISTS (
        SELECT 1 FROM json_each(reconciliation.plugin_lock_json) lock
        WHERE json_extract(lock.value, '$.plugin_id') <> 'supbrd-core'
          AND NOT EXISTS (
            SELECT 1 FROM superboard_plugin_lifecycle lifecycle
            JOIN superboard_plugin_runtime_health health
              ON health.instance_id = lifecycle.instance_id
             AND health.target = lifecycle.target
             AND health.plugin_id = lifecycle.plugin_id
             AND health.artifact_checksum = lifecycle.artifact_checksum
            WHERE lifecycle.instance_id = NEW.instance_id
              AND lifecycle.target = reconciliation.target
              AND lifecycle.plugin_id = json_extract(lock.value, '$.plugin_id')
              AND lifecycle.artifact_checksum = json_extract(lock.value, '$.artifact_checksum')
              AND lifecycle.state IN ('installed', 'active')
              AND health.status = 'ready'
              AND health.expires_at > NEW.activated_at
          )
      )
      OR EXISTS (
        SELECT 1 FROM superboard_plugin_lifecycle lifecycle
        WHERE lifecycle.instance_id = NEW.instance_id
          AND lifecycle.target = reconciliation.target
          AND lifecycle.state = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM json_each(reconciliation.plugin_lock_json) lock
            WHERE json_extract(lock.value, '$.plugin_id') = lifecycle.plugin_id
          )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'plugin lifecycle reconciliation is stale');
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_release_reconciliation_update_fresh_guard
BEFORE UPDATE ON superboard_front_active_releases
WHEN EXISTS (
  SELECT 1 FROM superboard_plugin_release_reconciliations reconciliation
  WHERE reconciliation.instance_id = NEW.instance_id
    AND reconciliation.release_id = NEW.active_release_id
    AND reconciliation.status = 'prepared'
    AND (
      reconciliation.target_artifact_checksum <> COALESCE((
        SELECT target_artifact.artifact_checksum
        FROM superboard_plugin_target_artifacts target_artifact
        WHERE target_artifact.instance_id = reconciliation.instance_id
          AND target_artifact.target = reconciliation.target
      ), '')
      OR
      EXISTS (
        SELECT 1 FROM json_each(reconciliation.plugin_lock_json) lock
        WHERE json_extract(lock.value, '$.plugin_id') <> 'supbrd-core'
          AND NOT EXISTS (
            SELECT 1 FROM superboard_plugin_lifecycle lifecycle
            JOIN superboard_plugin_runtime_health health
              ON health.instance_id = lifecycle.instance_id
             AND health.target = lifecycle.target
             AND health.plugin_id = lifecycle.plugin_id
             AND health.artifact_checksum = lifecycle.artifact_checksum
            WHERE lifecycle.instance_id = NEW.instance_id
              AND lifecycle.target = reconciliation.target
              AND lifecycle.plugin_id = json_extract(lock.value, '$.plugin_id')
              AND lifecycle.artifact_checksum = json_extract(lock.value, '$.artifact_checksum')
              AND lifecycle.state IN ('installed', 'active')
              AND health.status = 'ready'
              AND health.expires_at > NEW.activated_at
          )
      )
      OR EXISTS (
        SELECT 1 FROM superboard_plugin_lifecycle lifecycle
        WHERE lifecycle.instance_id = NEW.instance_id
          AND lifecycle.target = reconciliation.target
          AND lifecycle.state = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM json_each(reconciliation.plugin_lock_json) lock
            WHERE json_extract(lock.value, '$.plugin_id') = lifecycle.plugin_id
          )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'plugin lifecycle reconciliation is stale');
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_release_reconciliation_apply
AFTER INSERT ON superboard_front_activations
BEGIN
  INSERT INTO superboard_plugin_lifecycle_events (
    instance_id, target, plugin_id, artifact_checksum, from_state, to_state,
    plan_id, release_id, reason, changed_at
  )
  SELECT lifecycle.instance_id, lifecycle.target, lifecycle.plugin_id,
         lifecycle.artifact_checksum, lifecycle.state,
         CASE WHEN lifecycle.state = 'draining' THEN 'disabled' ELSE 'active' END,
         lifecycle.plan_id, NEW.active_release_id, 'Front Release activation', NEW.activated_at
  FROM superboard_plugin_lifecycle lifecycle
  JOIN superboard_plugin_release_reconciliations reconciliation
    ON reconciliation.instance_id = lifecycle.instance_id
   AND reconciliation.target = lifecycle.target
   AND reconciliation.release_id = NEW.active_release_id
   AND reconciliation.status = 'prepared'
  WHERE lifecycle.instance_id = NEW.instance_id
    AND (
      (lifecycle.state = 'installed' AND EXISTS (
        SELECT 1 FROM json_each(reconciliation.plugin_lock_json) lock
        WHERE json_extract(lock.value, '$.plugin_id') = lifecycle.plugin_id
          AND json_extract(lock.value, '$.artifact_checksum') = lifecycle.artifact_checksum
      ))
      OR
      (lifecycle.state = 'draining' AND NOT EXISTS (
        SELECT 1 FROM json_each(reconciliation.plugin_lock_json) lock
        WHERE json_extract(lock.value, '$.plugin_id') = lifecycle.plugin_id
      ))
    );

  UPDATE superboard_plugin_lifecycle
  SET state = CASE WHEN superboard_plugin_lifecycle.state = 'draining' THEN 'disabled' ELSE 'active' END,
      activated_release_id = NEW.active_release_id,
      state_changed_at = NEW.activated_at,
      reason = 'Front Release activation'
  WHERE superboard_plugin_lifecycle.instance_id = NEW.instance_id
    AND EXISTS (
      SELECT 1 FROM superboard_plugin_release_reconciliations reconciliation
      WHERE reconciliation.instance_id = superboard_plugin_lifecycle.instance_id
        AND reconciliation.target = superboard_plugin_lifecycle.target
        AND reconciliation.release_id = NEW.active_release_id
        AND reconciliation.status = 'prepared'
        AND (
          (superboard_plugin_lifecycle.state IN ('installed', 'active') AND EXISTS (
            SELECT 1 FROM json_each(reconciliation.plugin_lock_json) lock
            WHERE json_extract(lock.value, '$.plugin_id') = superboard_plugin_lifecycle.plugin_id
              AND json_extract(lock.value, '$.artifact_checksum') = superboard_plugin_lifecycle.artifact_checksum
          ))
          OR
          (superboard_plugin_lifecycle.state = 'draining' AND NOT EXISTS (
            SELECT 1 FROM json_each(reconciliation.plugin_lock_json) lock
            WHERE json_extract(lock.value, '$.plugin_id') = superboard_plugin_lifecycle.plugin_id
          ))
        )
    );

  UPDATE superboard_plugin_installation_items
  SET state = 'active'
  WHERE EXISTS (
    SELECT 1 FROM superboard_plugin_lifecycle lifecycle
    WHERE lifecycle.plan_id = superboard_plugin_installation_items.plan_id
      AND lifecycle.plugin_id = superboard_plugin_installation_items.plugin_id
      AND lifecycle.state = 'active'
      AND lifecycle.activated_release_id = NEW.active_release_id
  );

  UPDATE superboard_plugin_installation_plans
  SET status = 'active', completed_at = NEW.activated_at
  WHERE superboard_plugin_installation_plans.status = 'installed'
    AND NOT EXISTS (
      SELECT 1 FROM superboard_plugin_installation_items item
      WHERE item.plan_id = superboard_plugin_installation_plans.plan_id AND item.state <> 'active'
    );

  INSERT INTO superboard_active_plugin_manifests
    (plugin_id, artifact_checksum, activated_at)
  SELECT lifecycle.plugin_id, lifecycle.artifact_checksum, NEW.activated_at
  FROM superboard_plugin_lifecycle lifecycle
  JOIN superboard_plugin_release_reconciliations reconciliation
    ON reconciliation.instance_id = lifecycle.instance_id
   AND reconciliation.target = lifecycle.target
   AND reconciliation.release_id = NEW.active_release_id
  WHERE lifecycle.instance_id = NEW.instance_id
    AND lifecycle.state = 'active'
    AND lifecycle.activated_release_id = NEW.active_release_id
  ON CONFLICT(plugin_id) DO UPDATE SET
    artifact_checksum = excluded.artifact_checksum,
    activated_at = excluded.activated_at;

  DELETE FROM superboard_active_plugin_manifests
  WHERE plugin_id IN (
    SELECT lifecycle.plugin_id
    FROM superboard_plugin_lifecycle lifecycle
    JOIN superboard_plugin_release_reconciliations reconciliation
      ON reconciliation.instance_id = lifecycle.instance_id
     AND reconciliation.target = lifecycle.target
     AND reconciliation.release_id = NEW.active_release_id
    WHERE lifecycle.instance_id = NEW.instance_id
      AND lifecycle.state IN ('disabled', 'quarantined', 'purged')
  );

  INSERT INTO superboard_dependency_health
    (instance_id, dependency_id, status, evidence_checksum, checked_at, expires_at)
  SELECT lifecycle.instance_id,
         'dependency.' || replace(lifecycle.plugin_id, '-', '_'),
         'ready', health.evidence_checksum, NEW.activated_at, health.expires_at
  FROM superboard_plugin_lifecycle lifecycle
  JOIN superboard_plugin_runtime_health health
    ON health.instance_id = lifecycle.instance_id
   AND health.target = lifecycle.target
   AND health.plugin_id = lifecycle.plugin_id
   AND health.artifact_checksum = lifecycle.artifact_checksum
  WHERE lifecycle.instance_id = NEW.instance_id
    AND lifecycle.state = 'active'
    AND lifecycle.activated_release_id = NEW.active_release_id
  ON CONFLICT(instance_id, dependency_id) DO UPDATE SET
    status = 'ready', evidence_checksum = excluded.evidence_checksum,
    checked_at = excluded.checked_at, expires_at = excluded.expires_at;

  UPDATE superboard_plugin_release_reconciliations
  SET status = 'applied', applied_at = NEW.activated_at
  WHERE instance_id = NEW.instance_id
    AND release_id = NEW.active_release_id
    AND status = 'prepared';
END;
