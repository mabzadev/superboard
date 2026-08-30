PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS superboard_release_signing_keys (
  kid TEXT PRIMARY KEY,
  public_jwk TEXT NOT NULL CHECK (json_valid(public_jwk)),
  status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
  created_at TEXT NOT NULL,
  retired_at TEXT
);

CREATE TABLE IF NOT EXISTS superboard_front_release_candidates (
  candidate_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  release_id TEXT NOT NULL UNIQUE,
  release_json TEXT NOT NULL CHECK (json_valid(release_json)),
  content_checksum TEXT NOT NULL,
  validation_set_checksum TEXT NOT NULL,
  signing_kid TEXT NOT NULL REFERENCES superboard_release_signing_keys(kid),
  status TEXT NOT NULL CHECK (status IN ('validated', 'approved', 'activated', 'rejected', 'superseded')),
  approval_json TEXT CHECK (approval_json IS NULL OR json_valid(approval_json)),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  activated_at TEXT
);

CREATE INDEX IF NOT EXISTS superboard_front_candidates_instance_status
  ON superboard_front_release_candidates(instance_id, status, created_at);

CREATE TABLE IF NOT EXISTS superboard_front_active_releases (
  instance_id TEXT PRIMARY KEY,
  active_release_id TEXT NOT NULL REFERENCES superboard_front_release_candidates(release_id),
  previous_release_id TEXT,
  pointer_revision INTEGER NOT NULL CHECK (pointer_revision > 0),
  activation_id TEXT NOT NULL UNIQUE,
  activated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS superboard_front_activations (
  activation_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  active_release_id TEXT NOT NULL,
  previous_release_id TEXT,
  pointer_revision INTEGER NOT NULL,
  activated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS superboard_front_outbox (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  pointer_revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE TABLE IF NOT EXISTS superboard_dependency_health (
  instance_id TEXT NOT NULL,
  dependency_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'unavailable')),
  evidence_checksum TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (instance_id, dependency_id)
);

CREATE TRIGGER IF NOT EXISTS superboard_front_active_insert_receipt
AFTER INSERT ON superboard_front_active_releases
BEGIN
  INSERT INTO superboard_front_activations (
    activation_id, instance_id, active_release_id, previous_release_id, pointer_revision, activated_at
  ) VALUES (
    NEW.activation_id, NEW.instance_id, NEW.active_release_id, NEW.previous_release_id,
    NEW.pointer_revision, NEW.activated_at
  );
  UPDATE superboard_front_release_candidates
    SET status = 'activated', activated_at = NEW.activated_at
    WHERE release_id = NEW.active_release_id AND instance_id = NEW.instance_id;
  INSERT INTO superboard_front_outbox (
    event_type, instance_id, release_id, pointer_revision, payload_json, created_at
  ) VALUES (
    'front_release.activated', NEW.instance_id, NEW.active_release_id, NEW.pointer_revision,
    json_object(
      'activation_id', NEW.activation_id,
      'previous_release_id', NEW.previous_release_id,
      'pointer_revision', NEW.pointer_revision
    ),
    NEW.activated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS superboard_front_active_update_receipt
AFTER UPDATE ON superboard_front_active_releases
BEGIN
  INSERT INTO superboard_front_activations (
    activation_id, instance_id, active_release_id, previous_release_id, pointer_revision, activated_at
  ) VALUES (
    NEW.activation_id, NEW.instance_id, NEW.active_release_id, NEW.previous_release_id,
    NEW.pointer_revision, NEW.activated_at
  );
  UPDATE superboard_front_release_candidates
    SET status = 'activated', activated_at = NEW.activated_at
    WHERE release_id = NEW.active_release_id AND instance_id = NEW.instance_id;
  INSERT INTO superboard_front_outbox (
    event_type, instance_id, release_id, pointer_revision, payload_json, created_at
  ) VALUES (
    'front_release.activated', NEW.instance_id, NEW.active_release_id, NEW.pointer_revision,
    json_object(
      'activation_id', NEW.activation_id,
      'previous_release_id', NEW.previous_release_id,
      'pointer_revision', NEW.pointer_revision
    ),
    NEW.activated_at
  );
END;
