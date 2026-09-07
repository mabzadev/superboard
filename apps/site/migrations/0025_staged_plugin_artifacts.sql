CREATE TABLE IF NOT EXISTS superboard_plugin_staged_artifacts (
 instance_id TEXT NOT NULL,
 target TEXT NOT NULL,
 plugin_id TEXT NOT NULL,
 artifact_checksum TEXT NOT NULL REFERENCES superboard_plugin_manifest_artifacts(artifact_checksum),
 status TEXT NOT NULL CHECK(status IN ('ready','unavailable')),
 evidence_checksum TEXT NOT NULL,
 checked_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 plan_id TEXT NOT NULL REFERENCES superboard_plugin_installation_plans(plan_id),
 PRIMARY KEY(instance_id,target,plugin_id)
);
CREATE VIEW IF NOT EXISTS superboard_plugin_releasable_state AS
 SELECT lifecycle.instance_id,lifecycle.target,lifecycle.plugin_id,lifecycle.state,
  COALESCE(staged.artifact_checksum,lifecycle.artifact_checksum) AS artifact_checksum,
  COALESCE(staged.plan_id,lifecycle.plan_id) AS plan_id
 FROM superboard_plugin_lifecycle lifecycle
 LEFT JOIN superboard_plugin_staged_artifacts staged
  ON staged.instance_id=lifecycle.instance_id AND staged.target=lifecycle.target
  AND staged.plugin_id=lifecycle.plugin_id AND lifecycle.state='active';
CREATE VIEW IF NOT EXISTS superboard_plugin_releasable_health AS
 SELECT instance_id,target,plugin_id,artifact_checksum,status,evidence_checksum,checked_at,expires_at
 FROM superboard_plugin_staged_artifacts
 UNION ALL
 SELECT health.instance_id,health.target,health.plugin_id,health.artifact_checksum,health.status,health.evidence_checksum,health.checked_at,health.expires_at
 FROM superboard_plugin_runtime_health health
 WHERE NOT EXISTS (SELECT 1 FROM superboard_plugin_staged_artifacts staged
  WHERE staged.instance_id=health.instance_id AND staged.target=health.target AND staged.plugin_id=health.plugin_id);

DROP TRIGGER IF EXISTS superboard_plugin_release_reconciliation_insert_fresh_guard;
CREATE TRIGGER superboard_plugin_release_reconciliation_insert_fresh_guard
BEFORE INSERT ON superboard_front_active_releases
WHEN (EXISTS (
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
            SELECT 1 FROM superboard_plugin_releasable_state lifecycle
            JOIN superboard_plugin_releasable_health health
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
        SELECT 1 FROM superboard_plugin_releasable_state lifecycle
        WHERE lifecycle.instance_id = NEW.instance_id
          AND lifecycle.target = reconciliation.target
          AND lifecycle.state = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM json_each(reconciliation.plugin_lock_json) lock
            WHERE json_extract(lock.value, '$.plugin_id') = lifecycle.plugin_id
          )
      )
    )
)) AND NOT EXISTS (
SELECT 1 FROM superboard_plugin_compensations compensation
 JOIN superboard_managed_plugin_operations operation ON operation.operation_id = compensation.operation_id
 WHERE compensation.compensation_id = NEW.activation_id
 AND compensation.instance_id = NEW.instance_id AND compensation.target_release_id = NEW.active_release_id
 AND compensation.expected_pointer_revision + 1 = NEW.pointer_revision
 AND compensation.status = 'prepared' AND operation.status = 'running'
 AND compensation.owner_token = operation.owner_token AND compensation.snapshot_checksum = operation.snapshot_checksum
 AND operation.instance_id = NEW.instance_id AND operation.release_id = compensation.from_release_id
 AND operation.expires_at > NEW.activated_at
 AND json_extract(operation.snapshot_json, '$.superboard_front_active_releases[0].active_release_id') = NEW.active_release_id
)
BEGIN
  SELECT RAISE(ABORT, 'plugin lifecycle reconciliation is stale');
END;

DROP TRIGGER IF EXISTS superboard_plugin_release_reconciliation_update_fresh_guard;
CREATE TRIGGER superboard_plugin_release_reconciliation_update_fresh_guard
BEFORE UPDATE ON superboard_front_active_releases
WHEN (EXISTS (
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
            SELECT 1 FROM superboard_plugin_releasable_state lifecycle
            JOIN superboard_plugin_releasable_health health
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
        SELECT 1 FROM superboard_plugin_releasable_state lifecycle
        WHERE lifecycle.instance_id = NEW.instance_id
          AND lifecycle.target = reconciliation.target
          AND lifecycle.state = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM json_each(reconciliation.plugin_lock_json) lock
            WHERE json_extract(lock.value, '$.plugin_id') = lifecycle.plugin_id
          )
      )
    )
)) AND NOT EXISTS (
SELECT 1 FROM superboard_plugin_compensations compensation
 JOIN superboard_managed_plugin_operations operation ON operation.operation_id = compensation.operation_id
 WHERE compensation.compensation_id = NEW.activation_id
 AND compensation.instance_id = NEW.instance_id AND compensation.target_release_id = NEW.active_release_id
 AND compensation.expected_pointer_revision + 1 = NEW.pointer_revision
 AND compensation.status = 'prepared' AND operation.status = 'running'
 AND compensation.owner_token = operation.owner_token AND compensation.snapshot_checksum = operation.snapshot_checksum
 AND operation.instance_id = NEW.instance_id AND operation.release_id = compensation.from_release_id
 AND operation.expires_at > NEW.activated_at
 AND json_extract(operation.snapshot_json, '$.superboard_front_active_releases[0].active_release_id') = NEW.active_release_id
)
BEGIN
  SELECT RAISE(ABORT, 'plugin lifecycle reconciliation is stale');
END;

DROP TRIGGER IF EXISTS superboard_plugin_release_reconciliation_apply;
CREATE TRIGGER IF NOT EXISTS superboard_plugin_release_reconciliation_apply
AFTER INSERT ON superboard_front_activations
BEGIN

  INSERT INTO superboard_plugin_lifecycle_events(instance_id,target,plugin_id,artifact_checksum,from_state,to_state,plan_id,release_id,reason,changed_at)
  SELECT staged.instance_id,staged.target,staged.plugin_id,staged.artifact_checksum,'active','active',staged.plan_id,NEW.active_release_id,'Artifact upgrade from ' || lifecycle.artifact_checksum,NEW.activated_at
  FROM superboard_plugin_staged_artifacts staged JOIN superboard_plugin_lifecycle lifecycle
   ON lifecycle.instance_id=staged.instance_id AND lifecycle.target=staged.target AND lifecycle.plugin_id=staged.plugin_id
  WHERE staged.instance_id=NEW.instance_id AND EXISTS (
 SELECT 1 FROM superboard_plugin_release_reconciliations reconciliation, json_each(reconciliation.plugin_lock_json) lock
 WHERE reconciliation.instance_id=staged.instance_id AND reconciliation.target=staged.target
 AND reconciliation.release_id=NEW.active_release_id AND reconciliation.status='prepared'
 AND json_extract(lock.value,'$.plugin_id')=staged.plugin_id
 AND json_extract(lock.value,'$.artifact_checksum')=staged.artifact_checksum) AND lifecycle.artifact_checksum<>staged.artifact_checksum;

  UPDATE superboard_plugin_lifecycle
  SET artifact_checksum=(SELECT staged.artifact_checksum FROM superboard_plugin_staged_artifacts staged WHERE staged.instance_id=superboard_plugin_lifecycle.instance_id AND staged.target=superboard_plugin_lifecycle.target AND staged.plugin_id=superboard_plugin_lifecycle.plugin_id),
   plan_id=(SELECT staged.plan_id FROM superboard_plugin_staged_artifacts staged WHERE staged.instance_id=superboard_plugin_lifecycle.instance_id AND staged.target=superboard_plugin_lifecycle.target AND staged.plugin_id=superboard_plugin_lifecycle.plugin_id)
  WHERE state='active' AND EXISTS(SELECT 1 FROM superboard_plugin_staged_artifacts staged WHERE staged.instance_id=superboard_plugin_lifecycle.instance_id AND staged.target=superboard_plugin_lifecycle.target AND staged.plugin_id=superboard_plugin_lifecycle.plugin_id AND staged.instance_id=NEW.instance_id AND EXISTS (
 SELECT 1 FROM superboard_plugin_release_reconciliations reconciliation, json_each(reconciliation.plugin_lock_json) lock
 WHERE reconciliation.instance_id=staged.instance_id AND reconciliation.target=staged.target
 AND reconciliation.release_id=NEW.active_release_id AND reconciliation.status='prepared'
 AND json_extract(lock.value,'$.plugin_id')=staged.plugin_id
 AND json_extract(lock.value,'$.artifact_checksum')=staged.artifact_checksum));

  INSERT INTO superboard_plugin_runtime_health(instance_id,target,plugin_id,artifact_checksum,status,evidence_checksum,checked_at,expires_at)
  SELECT staged.instance_id,staged.target,staged.plugin_id,staged.artifact_checksum,staged.status,staged.evidence_checksum,staged.checked_at,staged.expires_at
  FROM superboard_plugin_staged_artifacts staged WHERE staged.instance_id=NEW.instance_id AND EXISTS (
 SELECT 1 FROM superboard_plugin_release_reconciliations reconciliation, json_each(reconciliation.plugin_lock_json) lock
 WHERE reconciliation.instance_id=staged.instance_id AND reconciliation.target=staged.target
 AND reconciliation.release_id=NEW.active_release_id AND reconciliation.status='prepared'
 AND json_extract(lock.value,'$.plugin_id')=staged.plugin_id
 AND json_extract(lock.value,'$.artifact_checksum')=staged.artifact_checksum)
  ON CONFLICT(instance_id,target,plugin_id) DO UPDATE SET artifact_checksum=excluded.artifact_checksum,status=excluded.status,evidence_checksum=excluded.evidence_checksum,checked_at=excluded.checked_at,expires_at=excluded.expires_at;
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

  DELETE FROM superboard_plugin_staged_artifacts
  WHERE instance_id=NEW.instance_id AND EXISTS(SELECT 1 FROM superboard_plugin_lifecycle lifecycle
   WHERE lifecycle.instance_id=superboard_plugin_staged_artifacts.instance_id AND lifecycle.target=superboard_plugin_staged_artifacts.target
   AND lifecycle.plugin_id=superboard_plugin_staged_artifacts.plugin_id AND lifecycle.artifact_checksum=superboard_plugin_staged_artifacts.artifact_checksum
   AND lifecycle.activated_release_id=NEW.active_release_id);
END;
