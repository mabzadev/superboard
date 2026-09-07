CREATE TABLE IF NOT EXISTS superboard_managed_plugin_operations (
 operation_id TEXT PRIMARY KEY,
 instance_id TEXT NOT NULL,
 target TEXT NOT NULL,
 plugin_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('enable', 'disable')),
 status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
 owner_token TEXT NOT NULL,
 snapshot_json TEXT,
 snapshot_checksum TEXT,
 release_id TEXT,
 response_status INTEGER,
 response_json TEXT,
 recovery_error TEXT,
 started_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_superboard_managed_plugin_operations_running
 ON superboard_managed_plugin_operations(instance_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_superboard_managed_plugin_operations_instance
 ON superboard_managed_plugin_operations(instance_id, started_at);

CREATE TABLE IF NOT EXISTS superboard_plugin_compensations (
 compensation_id TEXT PRIMARY KEY,
 owner_token TEXT NOT NULL,
 operation_id TEXT NOT NULL REFERENCES superboard_managed_plugin_operations(operation_id),
 instance_id TEXT NOT NULL,
 from_release_id TEXT NOT NULL,
 target_release_id TEXT,
 expected_pointer_revision INTEGER NOT NULL,
 snapshot_checksum TEXT NOT NULL,
 operator_id TEXT NOT NULL,
 authorization_receipt_id TEXT NOT NULL REFERENCES superboard_operator_reauthentication_receipts(receipt_id),
 reason TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('prepared', 'completed', 'recovery_required')),
 created_at TEXT NOT NULL,
 completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_superboard_plugin_compensations_operation
 ON superboard_plugin_compensations(operation_id);

CREATE TRIGGER IF NOT EXISTS superboard_managed_plugin_activation_insert_guard
BEFORE INSERT ON superboard_front_active_releases
WHEN (EXISTS (
 SELECT 1 FROM superboard_managed_plugin_operations operation
 WHERE operation.instance_id = NEW.instance_id AND operation.status = 'running'
 AND (NEW.activation_id <> 'plugin:' || operation.operation_id
  OR NEW.active_release_id <> COALESCE(operation.release_id, '')
  OR operation.expires_at <= NEW.activated_at OR operation.recovery_error IS NOT NULL
  OR EXISTS(SELECT 1 FROM superboard_plugin_compensations compensation WHERE compensation.operation_id = operation.operation_id))
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
 SELECT RAISE(ABORT, 'managed plugin operation owns instance activation');
END;

CREATE TRIGGER IF NOT EXISTS superboard_managed_plugin_activation_update_guard
BEFORE UPDATE ON superboard_front_active_releases
WHEN (EXISTS (
 SELECT 1 FROM superboard_managed_plugin_operations operation
 WHERE operation.instance_id = NEW.instance_id AND operation.status = 'running'
 AND (NEW.activation_id <> 'plugin:' || operation.operation_id
  OR NEW.active_release_id <> COALESCE(operation.release_id, '')
  OR operation.expires_at <= NEW.activated_at OR operation.recovery_error IS NOT NULL
  OR EXISTS(SELECT 1 FROM superboard_plugin_compensations compensation WHERE compensation.operation_id = operation.operation_id))
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
 SELECT RAISE(ABORT, 'managed plugin operation owns instance activation');
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_command_active_insert_guard
BEFORE INSERT ON superboard_plugin_command_operations
WHEN NEW.plugin_id <> 'supbrd-core' AND NOT EXISTS (
 SELECT 1 FROM superboard_plugin_lifecycle
 WHERE instance_id = NEW.instance_id AND plugin_id = NEW.plugin_id AND state = 'active'
)
BEGIN
 SELECT RAISE(ABORT, 'plugin manifest not active');
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_lease_active_insert_guard
BEFORE INSERT ON superboard_worker_execution_leases
WHEN NOT EXISTS (
 SELECT 1 FROM superboard_plugin_lifecycle
 WHERE plugin_id = NEW.plugin_id AND state = 'active'
)
BEGIN
 SELECT RAISE(ABORT, 'plugin manifest not active');
END;


DROP TRIGGER IF EXISTS superboard_plugin_release_reconciliation_insert_guard;
CREATE TRIGGER superboard_plugin_release_reconciliation_insert_guard
BEFORE INSERT ON superboard_front_active_releases
WHEN (EXISTS (
  SELECT 1 FROM superboard_plugin_lifecycle lifecycle
  WHERE lifecycle.instance_id = NEW.instance_id
)
AND NOT EXISTS (
  SELECT 1 FROM superboard_plugin_release_reconciliations reconciliation
  WHERE reconciliation.instance_id = NEW.instance_id
    AND reconciliation.release_id = NEW.active_release_id
    AND reconciliation.status = 'prepared'
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
  SELECT RAISE(ABORT, 'plugin lifecycle reconciliation is not prepared');
END;

DROP TRIGGER IF EXISTS superboard_plugin_release_reconciliation_update_guard;
CREATE TRIGGER superboard_plugin_release_reconciliation_update_guard
BEFORE UPDATE ON superboard_front_active_releases
WHEN (EXISTS (
  SELECT 1 FROM superboard_plugin_lifecycle lifecycle
  WHERE lifecycle.instance_id = NEW.instance_id
)
AND NOT EXISTS (
  SELECT 1 FROM superboard_plugin_release_reconciliations reconciliation
  WHERE reconciliation.instance_id = NEW.instance_id
    AND reconciliation.release_id = NEW.active_release_id
    AND reconciliation.status = 'prepared'
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
  SELECT RAISE(ABORT, 'plugin lifecycle reconciliation is not prepared');
END;

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
