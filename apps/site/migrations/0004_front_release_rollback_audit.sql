PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS superboard_front_rollbacks (
  rollback_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  from_release_id TEXT NOT NULL,
  target_release_id TEXT NOT NULL,
  pointer_revision INTEGER NOT NULL,
  rolled_back_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_superboard_front_rollbacks_instance
  ON superboard_front_rollbacks(instance_id);
CREATE INDEX IF NOT EXISTS idx_superboard_front_rollbacks_from_release
  ON superboard_front_rollbacks(from_release_id);
CREATE INDEX IF NOT EXISTS idx_superboard_front_rollbacks_target_release
  ON superboard_front_rollbacks(target_release_id);

CREATE TRIGGER IF NOT EXISTS superboard_front_pointer_rollback_receipt
AFTER UPDATE ON superboard_front_active_releases
WHEN OLD.previous_release_id IS NOT NULL
 AND NEW.active_release_id = OLD.previous_release_id
BEGIN
  INSERT INTO superboard_front_rollbacks (
    rollback_id, instance_id, from_release_id, target_release_id,
    pointer_revision, rolled_back_at
  ) VALUES (
    NEW.activation_id, NEW.instance_id, OLD.active_release_id,
    NEW.active_release_id, NEW.pointer_revision, NEW.activated_at
  );
  INSERT INTO superboard_front_outbox (
    event_type, instance_id, release_id, pointer_revision, payload_json, created_at
  ) VALUES (
    'front_release.rolled_back', NEW.instance_id, NEW.active_release_id,
    NEW.pointer_revision,
    json_object(
      'rollback_id', NEW.activation_id,
      'from_release_id', OLD.active_release_id,
      'target_release_id', NEW.active_release_id,
      'pointer_revision', NEW.pointer_revision
    ),
    NEW.activated_at
  );
END;
