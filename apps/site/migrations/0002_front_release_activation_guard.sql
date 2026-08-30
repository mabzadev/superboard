CREATE TRIGGER IF NOT EXISTS superboard_front_active_insert_guard
BEFORE INSERT ON superboard_front_active_releases
WHEN NOT EXISTS (
  SELECT 1
  FROM superboard_front_release_candidates AS candidate
  WHERE candidate.instance_id = NEW.instance_id
    AND candidate.release_id = NEW.active_release_id
    AND candidate.status IN ('approved', 'activated')
    AND candidate.approval_json IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'front release is not approved for this instance');
END;

CREATE TRIGGER IF NOT EXISTS superboard_front_active_update_guard
BEFORE UPDATE ON superboard_front_active_releases
WHEN NOT EXISTS (
  SELECT 1
  FROM superboard_front_release_candidates AS candidate
  WHERE candidate.instance_id = NEW.instance_id
    AND candidate.release_id = NEW.active_release_id
    AND candidate.status IN ('approved', 'activated')
    AND candidate.approval_json IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'front release is not approved for this instance');
END;
